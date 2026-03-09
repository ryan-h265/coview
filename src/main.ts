import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  desktopCapturer,
  dialog,
  globalShortcut,
  nativeImage,
  shell,
  systemPreferences,
} from "electron";
import type { OpenDialogOptions } from "electron";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import {
  appendInProgressRecordingChunk,
  createInProgressRecordingSession,
  discardInProgressRecordingSession,
  finalizeInProgressRecordingSession,
  getRecoverableRecordingSession,
  isMeaningfulCapture,
  listRecoverableRecordingSessions,
} from "./recordingSessions";
import {
  cleanupLibraryDirectory,
  copyLibraryContents,
  ensureLibraryManifest,
  isDirectoryEmpty,
  verifyLibraryCopy,
} from "./libraryStorage";
import { createMonotonicUlid } from "./ulid";
import {
  buildTranscriptTextFromSegments,
  createTranscriptSegmentsArtifact,
  parseWhisperCliTranscriptJson,
  parseWhisperPythonTranscriptJson,
  readTranscriptSegmentsArtifact,
  type TranscriptSegment,
} from "./transcriptSegments";
import {
  clampTelemetryTailLines as clampTelemetryTailLinesHelper,
  getEffectiveSettings as getEffectiveSettingsHelper,
  getEffectiveTranscriptionOptions as getEffectiveTranscriptionOptionsHelper,
  parseTranscriptionSetupStatus,
  sanitizeIsoDateTime,
  sanitizeTranscriptionModel,
} from "./settingsUtils";
import {
  buildMarkdownExport,
  buildPreviewText,
  buildRecordingFileStem,
  buildSearchText,
  buildSummary,
  buildTextExport,
  computeArtifacts as computeArtifactsHelper,
  expandQueryTokens,
  extractKeywords,
  extractTopics,
  formatExportTimestamp,
  getDisambiguatedPathIfNeeded,
  getMimeTypeForFile,
  getRecordingDurationMs,
  getTranscriptSnippet,
  keywordScore,
  sanitizeFileComponent,
  sanitizeSessionTitle,
  sanitizeTranscriptText,
  semanticScore,
  toSearchTokens,
  toTokenFrequency,
} from "./sessionUtils";
import { registerMainIpcHandlers } from "./mainIpcHandlers";

const execFileAsync = promisify(execFile);

type CaptureSourceType = "screen" | "window";
type AudioMode = "system" | "mic" | "both";
type HotkeyAction = "start-stop" | "pause-resume" | "auto-toggle";
type ProcessingStatus = "queued" | "processing" | "done" | "failed";
type SaveProcessingStatus = ProcessingStatus | "disabled" | "dropped";
type SessionSearchMode = "keyword" | "semantic" | "both";
type SessionExportFormat = "md" | "txt" | "json";
type TelemetryLevel = "info" | "warn" | "error";
type TranscriptionProvider = "auto" | "local-whisper-cli" | "local-whisper-python";
type TranscriptionJobKind = "initial" | "retranscribe";
type TranscriptionSetupStatus = "pending" | "dismissed" | "completed";
type CommandSource = "bundled" | "system";

interface HotkeySettings {
  startStop: string;
  pauseResume: string;
  autoToggle: string;
}

interface TranscriptionSetupState {
  status?: TranscriptionSetupStatus;
  completedAt?: string;
  dismissedAt?: string;
  modelPath?: string;
  modelId?: string;
}

interface AppSettings {
  storageDir?: string;
  autoRecordEnabled?: boolean;
  aiProcessingEnabled?: boolean;
  inactivityTimeoutMinutes?: number;
  hotkeys?: Partial<HotkeySettings>;
  transcriptionDefaults?: Partial<TranscriptionRequestOptions>;
  transcriptionSetup?: Partial<TranscriptionSetupState>;
}

interface EffectiveSettings {
  storageDir: string;
  autoRecordEnabled: boolean;
  aiProcessingEnabled: boolean;
  inactivityTimeoutMinutes: number;
  hotkeys: HotkeySettings;
  transcriptionDefaults: EffectiveTranscriptionRequestOptions;
  transcriptionSetup: Required<Pick<TranscriptionSetupState, "status">> &
    Omit<TranscriptionSetupState, "status">;
}

interface SaveRecordingMetadata {
  title?: string;
  sourceName?: string;
  startedAt?: string;
  endedAt?: string;
  screenMode?: CaptureSourceType;
  audioMode?: AudioMode;
  autoTriggered?: boolean;
  stopReason?: string;
}

interface BeginRecordingSessionPayload {
  mimeType: string;
  metadata?: SaveRecordingMetadata;
}

interface AppendRecordingChunkPayload {
  recordingSessionId: string;
  data: ArrayBuffer;
}

interface FinishRecordingSessionPayload {
  recordingSessionId: string;
  mimeType: string;
  metadata: SaveRecordingMetadata;
}

interface SaveRecordingResult {
  mediaPath: string | null;
  metadataPath: string | null;
  bytesWritten: number;
  processingJobId: string | null;
  processingStatus: SaveProcessingStatus;
  droppedEmpty: boolean;
}

interface TranscriptionRequestOptions {
  provider?: TranscriptionProvider;
  model?: string;
  language?: string;
}

interface EffectiveTranscriptionRequestOptions {
  provider: TranscriptionProvider;
  model?: string;
  language: string;
}

interface TranscriptionDiagnostics {
  checkedAt: string;
  whisperCli: {
    available: boolean;
    commandPath?: string;
    source?: CommandSource;
    modelPath?: string;
    modelExists: boolean;
    ready: boolean;
  };
  whisperPython: {
    available: boolean;
    commandPath?: string;
    ready: boolean;
  };
  ffmpeg: {
    available: boolean;
    commandPath?: string;
  };
  autoStrategy: {
    attemptOrder: string[];
    firstReadyProvider?: string;
    ready: boolean;
    summary: string;
  };
  managedModelDirectory: string;
  setupStatus: TranscriptionSetupStatus;
}

interface TranscriptionTestResult {
  sessionId: string;
  provider: string;
  model: string;
  language: string;
  transcriptChars: number;
  previewText: string;
  elapsedMs: number;
  testedAt: string;
}

interface ProcessingJobRecord {
  id: string;
  sessionId: string;
  mediaPath: string;
  metadataPath: string;
  transcriptPath: string;
  transcriptSegmentsPath: string;
  analysisPath: string;
  title: string;
  status: ProcessingStatus;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  errorMessage?: string;
  jobKind?: TranscriptionJobKind;
  requestedProvider?: TranscriptionProvider;
  requestedModel?: string;
  requestedLanguage?: string;
  transcriptProvider?: string;
  transcriptModel?: string;
  transcriptLanguage?: string;
  transcriptChars?: number;
  durationMs?: number;
  providerLatencyMs?: number;
  summaryPreview?: string;
}

interface ProcessingJobView {
  id: string;
  sessionId: string;
  title: string;
  status: ProcessingStatus;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  errorMessage?: string;
  jobKind?: TranscriptionJobKind;
  requestedProvider?: TranscriptionProvider;
  requestedModel?: string;
  requestedLanguage?: string;
  transcriptProvider?: string;
  transcriptModel?: string;
  transcriptLanguage?: string;
  transcriptChars?: number;
  durationMs?: number;
  providerLatencyMs?: number;
  summaryPreview?: string;
}

interface TranscriptResult {
  text: string;
  provider: string;
  model: string;
  language: string;
  segments: TranscriptSegment[];
}

interface WhisperModelSpec {
  id: string;
  displayName: string;
  description: string;
  fileName: string;
  language: string;
  url: string;
  sizeLabel: string;
  memoryLabel: string;
  speedLabel: string;
  accuracyLabel: string;
  sizeBytes: number;
  multilingual: boolean;
  recommended?: boolean;
  priority: number;
}

interface CommandResolution {
  path: string | null;
  source: CommandSource | null;
  env?: NodeJS.ProcessEnv;
}

interface WhisperModelView {
  id: string;
  displayName: string;
  description: string;
  sizeLabel: string;
  memoryLabel: string;
  speedLabel: string;
  accuracyLabel: string;
  multilingual: boolean;
  recommended: boolean;
  installed: boolean;
  active: boolean;
  managedPath: string;
  language: string;
  priority: number;
}

interface WhisperModelLibraryView {
  runtimeAvailable: boolean;
  runtimeSource?: CommandSource;
  managedModelDirectory: string;
  configuredModelPath?: string;
  aiProcessingEnabled: boolean;
  setupStatus: TranscriptionSetupStatus;
  models: WhisperModelView[];
  customModel?: {
    path: string;
    exists: boolean;
    active: boolean;
  };
}

interface WhisperModelDownloadProgress {
  modelId: string;
  status: "downloading" | "completed" | "failed";
  downloadedBytes: number;
  totalBytes?: number;
  message?: string;
}

interface SessionIndexEntry {
  id: string;
  title: string;
  sourceName?: string;
  startedAt: string;
  endedAt?: string;
  createdAt: string;
  updatedAt: string;
  mediaPath: string;
  metadataPath: string;
  transcriptPath?: string;
  transcriptSegmentsPath?: string;
  analysisPath?: string;
  processingStatus: string;
  screenMode?: CaptureSourceType;
  audioMode?: AudioMode;
  autoTriggered?: boolean;
  stopReason?: string;
  transcriptProvider?: string;
  transcriptModel?: string;
  transcriptLanguage?: string;
  transcriptSegments: TranscriptSegment[];
  transcriptText: string;
  summary: string;
  topics: string[];
  keywords: string[];
  searchText: string;
  searchTokenFrequency: Map<string, number>;
}

interface SessionSummaryView {
  id: string;
  title: string;
  sourceName?: string;
  startedAt: string;
  endedAt?: string;
  processingStatus: string;
  summary: string;
  topics: string[];
  keywords: string[];
  transcriptSnippet: string;
  updatedAt: string;
}

interface SessionDetailView extends SessionSummaryView {
  mediaPath: string;
  metadataPath: string;
  transcriptPath?: string;
  transcriptSegmentsPath?: string;
  analysisPath?: string;
  transcriptSegments: TranscriptSegment[];
  transcriptText: string;
  screenMode?: CaptureSourceType;
  audioMode?: AudioMode;
  autoTriggered?: boolean;
  stopReason?: string;
  transcriptProvider?: string;
  transcriptModel?: string;
  transcriptLanguage?: string;
}

interface SessionSearchResultView extends SessionSummaryView {
  score: number;
  matchType: SessionSearchMode;
}

interface SessionUpdatePatch {
  title?: string;
  transcriptText?: string;
  summary?: string;
  topics?: string[];
  keywords?: string[];
}

const SETTINGS_FILENAME = "settings.json";
const PROCESSING_JOBS_FILENAME = "processing-jobs.json";
const TRANSCRIPT_SEGMENTS_FILENAME_SUFFIX = ".transcript.segments.json";
const SCREEN_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
const DEFAULT_HOTKEYS: HotkeySettings = {
  startStop: "CommandOrControl+Shift+R",
  pauseResume: "CommandOrControl+Shift+P",
  autoToggle: "CommandOrControl+Shift+A",
};
const DEFAULT_AUTO_RECORD_ENABLED = true;
const DEFAULT_AI_PROCESSING_ENABLED = false;
const DEFAULT_INACTIVITY_TIMEOUT_MINUTES = 60;
const MIN_INACTIVITY_TIMEOUT_MINUTES = 1;
const MAX_INACTIVITY_TIMEOUT_MINUTES = 1440;
const CALL_HINT_PATTERN = /\b(huddle|call|calling|in huddle|join huddle)\b/i;
const WHISPER_MODEL_PATH = process.env.COVIEW_WHISPER_MODEL?.trim() || undefined;
const FFMPEG_TIMEOUT_MS = 3 * 60 * 1000;
const WHISPER_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_EXEC_BUFFER = 16 * 1024 * 1024;
const TRANSCRIPT_SNIPPET_CHARS = 220;
const SESSION_SUMMARY_PREVIEW_CHARS = 260;
const DEFAULT_TRANSCRIPTION_LANGUAGE = "en";
const DEFAULT_SESSION_SUMMARY =
  "Processing completed, but no summary text is available yet.";
const DEFAULT_AI_DISABLED_SESSION_SUMMARY = "Local processing is disabled for this recording.";
const DEFAULT_EXPORT_DIRECTORY = "exports";
const PROCESSING_HISTORY_LIMIT = 5;
const TELEMETRY_DIRECTORY = "logs";
const TELEMETRY_FILENAME = "coview.log";
const TELEMETRY_MAX_BYTES = 2 * 1024 * 1024;
const TELEMETRY_ARCHIVE_COUNT = 3;
const TELEMETRY_EVENT_MAX_CHARS = 120;
const TELEMETRY_DEFAULT_TAIL_LINES = 120;
const TELEMETRY_MAX_TAIL_LINES = 1000;
const WHISPER_RUNTIME_DIRECTORY = "whisper-runtime";
const WHISPER_MANAGED_MODELS_DIRECTORY = "models";
const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * 1024 * 1024;
const WHISPER_MODEL_CATALOG: Record<string, WhisperModelSpec> = {
  "tiny.en": {
    id: "tiny.en",
    displayName: "Tiny English",
    description: "Fastest startup and lowest download size. Best for quick notes on smaller machines.",
    fileName: "ggml-tiny.en.bin",
    language: "en",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
    sizeLabel: "75 MiB",
    memoryLabel: "~273 MB RAM",
    speedLabel: "Fastest",
    accuracyLabel: "Basic",
    sizeBytes: 75 * MEBIBYTE,
    multilingual: false,
    priority: 10,
  },
  "base.en": {
    id: "base.en",
    displayName: "Recommended English model",
    description: "Balanced accuracy and download size for first-time setup.",
    fileName: "ggml-base.en.bin",
    language: "en",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
    sizeLabel: "142 MiB",
    memoryLabel: "~388 MB RAM",
    speedLabel: "Fast",
    accuracyLabel: "Balanced",
    sizeBytes: 142 * MEBIBYTE,
    multilingual: false,
    recommended: true,
    priority: 20,
  },
  "small.en": {
    id: "small.en",
    displayName: "Small English",
    description: "More accurate, but slower and larger than the recommended model.",
    fileName: "ggml-small.en.bin",
    language: "en",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
    sizeLabel: "466 MiB",
    memoryLabel: "~852 MB RAM",
    speedLabel: "Medium",
    accuracyLabel: "High",
    sizeBytes: 466 * MEBIBYTE,
    multilingual: false,
    priority: 30,
  },
  "medium.en": {
    id: "medium.en",
    displayName: "Medium English",
    description: "High accuracy for longer recordings, with a much larger download and memory footprint.",
    fileName: "ggml-medium.en.bin",
    language: "en",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin",
    sizeLabel: "1.5 GiB",
    memoryLabel: "~2.1 GB RAM",
    speedLabel: "Slow",
    accuracyLabel: "Highest",
    sizeBytes: Math.round(1.5 * GIBIBYTE),
    multilingual: false,
    priority: 40,
  },
  base: {
    id: "base",
    displayName: "Base Multilingual",
    description: "Balanced multilingual model for mixed-language calls.",
    fileName: "ggml-base.bin",
    language: "auto",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
    sizeLabel: "142 MiB",
    memoryLabel: "~388 MB RAM",
    speedLabel: "Fast",
    accuracyLabel: "Balanced",
    sizeBytes: 142 * MEBIBYTE,
    multilingual: true,
    priority: 50,
  },
  small: {
    id: "small",
    displayName: "Small Multilingual",
    description: "Higher accuracy multilingual model when you need language flexibility.",
    fileName: "ggml-small.bin",
    language: "auto",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
    sizeLabel: "466 MiB",
    memoryLabel: "~852 MB RAM",
    speedLabel: "Medium",
    accuracyLabel: "High",
    sizeBytes: 466 * MEBIBYTE,
    multilingual: true,
    priority: 60,
  },
};

const QUERY_SYNONYMS: Record<string, string[]> = {
  setup: ["configure", "configuration", "install", "installation", "onboarding"],
  configure: ["setup", "configuration", "configure"],
  config: ["configuration", "settings", "setup"],
  bug: ["issue", "error", "defect", "problem"],
  fix: ["resolve", "patch", "solution", "workaround"],
  deploy: ["deployment", "release", "rollout", "ship"],
  auth: ["authentication", "authorization", "login", "oauth"],
  api: ["endpoint", "service", "integration"],
  database: ["db", "postgres", "mysql", "schema", "migration"],
  infra: ["infrastructure", "kubernetes", "docker", "cloud"],
  performance: ["latency", "slow", "optimize", "optimization"],
};

const STOPWORDS = new Set([
  "a",
  "about",
  "above",
  "after",
  "again",
  "against",
  "all",
  "also",
  "am",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "doing",
  "down",
  "during",
  "each",
  "few",
  "for",
  "from",
  "further",
  "had",
  "has",
  "have",
  "having",
  "he",
  "her",
  "here",
  "hers",
  "herself",
  "him",
  "himself",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "itself",
  "just",
  "let",
  "me",
  "more",
  "most",
  "my",
  "myself",
  "no",
  "nor",
  "not",
  "now",
  "of",
  "off",
  "on",
  "once",
  "only",
  "or",
  "other",
  "our",
  "ours",
  "ourselves",
  "out",
  "over",
  "own",
  "same",
  "she",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "themselves",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "too",
  "under",
  "until",
  "up",
  "very",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "will",
  "with",
  "you",
  "your",
  "yours",
  "yourself",
  "yourselves",
]);

let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let activeHotkeys: HotkeySettings = { ...DEFAULT_HOTKEYS };

let processingJobs: ProcessingJobRecord[] = [];
let processingJobsLoaded = false;
let processingLoopPromise: Promise<void> | null = null;
const commandResolutionCache = new Map<string, CommandResolution>();
let activeWhisperModelInstallId: string | null = null;
let telemetryWriteChain: Promise<void> = Promise.resolve();
let sessionIndexCache: SessionIndexEntry[] | null = null;
const sessionWriteLocks = new Map<string, Promise<void>>();
const recordingSessionWriteLocks = new Map<string, Promise<void>>();
const inProgressRecordingStorageDirs = new Map<string, string>();

async function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const previous = sessionWriteLocks.get(sessionId) ?? Promise.resolve();
  let releaseFn: () => void;
  const next = new Promise<void>((resolve) => { releaseFn = resolve; });
  sessionWriteLocks.set(sessionId, next);
  await previous;
  try {
    return await fn();
  } finally {
    releaseFn!();
    if (sessionWriteLocks.get(sessionId) === next) {
      sessionWriteLocks.delete(sessionId);
    }
  }
}

async function withRecordingSessionLock<T>(recordingSessionId: string, fn: () => Promise<T>): Promise<T> {
  const previous = recordingSessionWriteLocks.get(recordingSessionId) ?? Promise.resolve();
  let releaseFn: () => void;
  const next = new Promise<void>((resolve) => { releaseFn = resolve; });
  recordingSessionWriteLocks.set(recordingSessionId, next);
  await previous;
  try {
    return await fn();
  } finally {
    releaseFn!();
    if (recordingSessionWriteLocks.get(recordingSessionId) === next) {
      recordingSessionWriteLocks.delete(recordingSessionId);
    }
  }
}

function invalidateSessionIndexCache(): void {
  sessionIndexCache = null;
}
const hasSingleInstanceLock = app.requestSingleInstanceLock();

function nowIso(): string {
  return new Date().toISOString();
}

function getSettingsPath(): string {
  return path.join(app.getPath("userData"), SETTINGS_FILENAME);
}

function getProcessingJobsPath(): string {
  return path.join(app.getPath("userData"), PROCESSING_JOBS_FILENAME);
}

function getTelemetryDirPath(): string {
  const baseDir = app.isReady() ? app.getPath("userData") : path.join(os.homedir(), ".coview");
  return path.join(baseDir, TELEMETRY_DIRECTORY);
}

function getTelemetryFilePath(): string {
  return path.join(getTelemetryDirPath(), TELEMETRY_FILENAME);
}

function getManagedWhisperModelsDir(): string {
  const baseDir = app.isReady() ? app.getPath("userData") : path.join(os.homedir(), ".coview");
  return path.join(baseDir, WHISPER_MANAGED_MODELS_DIRECTORY);
}

function getManagedWhisperModelPath(modelSpec: WhisperModelSpec): string {
  return path.join(getManagedWhisperModelsDir(), modelSpec.fileName);
}

function emitWhisperModelDownloadProgress(progress: WhisperModelDownloadProgress): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("transcription:model-download-progress", progress);
}

function getWhisperRuntimeLabel(): string {
  return `${process.platform}-${process.arch}`;
}

function getWhisperRuntimeLabels(): string[] {
  const labels = [getWhisperRuntimeLabel()];
  if (process.platform === "darwin") {
    labels.push("darwin-universal");
  }
  return labels;
}

function getWhisperCliExecutableName(): string {
  return process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
}

function prependEnvEntries(existingValue: string | undefined, values: string[]): string | undefined {
  const normalizedPrefix = values
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => path.resolve(entry));
  const uniquePrefix = Array.from(new Set(normalizedPrefix));
  const existingEntries = (existingValue ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const combined = uniquePrefix.concat(existingEntries.filter((entry) => !uniquePrefix.includes(entry)));
  return combined.length > 0 ? combined.join(path.delimiter) : undefined;
}

function buildBundledCommandEnv(binDirs: string[], libraryDirs: string[]): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const pathValue = prependEnvEntries(env.PATH, binDirs);
  const ldLibraryPath = prependEnvEntries(env.LD_LIBRARY_PATH, libraryDirs);
  const dyldLibraryPath = prependEnvEntries(env.DYLD_LIBRARY_PATH, libraryDirs);

  if (pathValue) {
    env.PATH = pathValue;
  }
  if (ldLibraryPath) {
    env.LD_LIBRARY_PATH = ldLibraryPath;
  }
  if (dyldLibraryPath) {
    env.DYLD_LIBRARY_PATH = dyldLibraryPath;
  }

  return env;
}

function resolveBundledWhisperCliCommand(): CommandResolution | null {
  const executableName = getWhisperCliExecutableName();

  const candidates: Array<{
    commandPath: string;
    env: NodeJS.ProcessEnv;
  }> = [];

  for (const runtimeLabel of getWhisperRuntimeLabels()) {
    const packagedRuntimeDir = path.join(process.resourcesPath, WHISPER_RUNTIME_DIRECTORY, runtimeLabel);
    const stagedRuntimeDir = path.join(app.getAppPath(), "build", WHISPER_RUNTIME_DIRECTORY, runtimeLabel);
    candidates.push(
      {
        commandPath: path.join(packagedRuntimeDir, executableName),
        env: buildBundledCommandEnv([packagedRuntimeDir], [packagedRuntimeDir]),
      },
      {
        commandPath: path.join(stagedRuntimeDir, executableName),
        env: buildBundledCommandEnv([stagedRuntimeDir], [stagedRuntimeDir]),
      },
    );
  }

  for (const candidate of candidates) {
    if (existsSync(candidate.commandPath)) {
      return {
        path: candidate.commandPath,
        source: "bundled",
        env: candidate.env,
      };
    }
  }

  return null;
}

function resolveConfiguredWhisperModelPath(
  options?: Partial<EffectiveTranscriptionRequestOptions>,
): string | undefined {
  const candidate = sanitizeTranscriptionModel(options?.model) ?? WHISPER_MODEL_PATH;
  return candidate && candidate.length > 0 ? candidate : undefined;
}

function inferWhisperModelLanguageFromPath(modelPath: string): string | undefined {
  const fileName = path.basename(modelPath).toLowerCase();
  if (fileName.includes(".en.")) {
    return "en";
  }
  if (fileName.startsWith("ggml-") && fileName.endsWith(".bin")) {
    return "auto";
  }
  return undefined;
}

function buildWhisperModelView(
  modelSpec: WhisperModelSpec,
  configuredModelPath: string | undefined,
): WhisperModelView {
  const managedPath = getManagedWhisperModelPath(modelSpec);
  const installed = existsSync(managedPath);
  const active = Boolean(
    configuredModelPath &&
      path.resolve(configuredModelPath) === path.resolve(managedPath),
  );

  return {
    id: modelSpec.id,
    displayName: modelSpec.displayName,
    description: modelSpec.description,
    sizeLabel: modelSpec.sizeLabel,
    memoryLabel: modelSpec.memoryLabel,
    speedLabel: modelSpec.speedLabel,
    accuracyLabel: modelSpec.accuracyLabel,
    multilingual: modelSpec.multilingual,
    recommended: Boolean(modelSpec.recommended),
    installed,
    active,
    managedPath,
    language: modelSpec.language,
    priority: modelSpec.priority,
  };
}

async function listWhisperModels(forceRefresh = false): Promise<WhisperModelLibraryView> {
  const settings = getEffectiveSettings(await readSettings());
  const whisperCliCommand = await resolveCommandContext("whisper-cli", forceRefresh);
  const configuredModelPath = resolveConfiguredWhisperModelPath(settings.transcriptionDefaults);
  const models = Object.values(WHISPER_MODEL_CATALOG)
    .map((modelSpec) => buildWhisperModelView(modelSpec, configuredModelPath))
    .sort((left, right) => left.priority - right.priority);

  const customModel =
    configuredModelPath && !models.some((model) => model.active)
      ? {
          path: configuredModelPath,
          exists: existsSync(configuredModelPath),
          active: true,
        }
      : undefined;

  return {
    runtimeAvailable: Boolean(whisperCliCommand?.path),
    runtimeSource: whisperCliCommand?.source ?? undefined,
    managedModelDirectory: getManagedWhisperModelsDir(),
    configuredModelPath,
    aiProcessingEnabled: settings.aiProcessingEnabled,
    setupStatus: settings.transcriptionSetup.status,
    models,
    customModel,
  };
}

async function activateWhisperModel(modelId: string): Promise<EffectiveSettings> {
  const modelSpec = WHISPER_MODEL_CATALOG[modelId];
  if (!modelSpec) {
    throw new Error("Unsupported whisper model selection");
  }

  const managedPath = getManagedWhisperModelPath(modelSpec);
  if (!existsSync(managedPath)) {
    throw new Error("Install this model before using it.");
  }

  return updateSettingsPatch({
    aiProcessingEnabled: true,
    transcriptionDefaults: {
      provider: "auto",
      model: managedPath,
      language: modelSpec.language,
    },
    transcriptionSetup: {
      status: "completed",
      modelId: modelSpec.id,
      modelPath: managedPath,
    },
  });
}

async function activateCustomWhisperModel(modelPath: string): Promise<EffectiveSettings> {
  if (!existsSync(modelPath)) {
    throw new Error("Selected model file was not found.");
  }

  const currentSettings = app.isReady()
    ? getEffectiveSettings(await readSettings())
    : null;
  const fallbackLanguage = currentSettings?.transcriptionDefaults.language ?? DEFAULT_TRANSCRIPTION_LANGUAGE;
  const inferredLanguage = inferWhisperModelLanguageFromPath(modelPath) ?? fallbackLanguage;

  return updateSettingsPatch({
    aiProcessingEnabled: true,
    transcriptionDefaults: {
      provider: "auto",
      model: modelPath,
      language: inferredLanguage,
    },
    transcriptionSetup: {
      status: "completed",
      modelId: "custom",
      modelPath,
    },
  });
}

async function removeWhisperModel(modelId: string): Promise<{
  removed: true;
  settings: EffectiveSettings;
}> {
  const modelSpec = WHISPER_MODEL_CATALOG[modelId];
  if (!modelSpec) {
    throw new Error("Unsupported whisper model selection");
  }

  const managedPath = getManagedWhisperModelPath(modelSpec);
  const currentSettings = getEffectiveSettings(await readSettings());
  const configuredModelPath = resolveConfiguredWhisperModelPath(currentSettings.transcriptionDefaults);
  const removingActive = Boolean(
    configuredModelPath &&
      path.resolve(configuredModelPath) === path.resolve(managedPath),
  );

  await rm(managedPath, { force: true });
  logInfo("transcription.model_removed", {
    modelId,
    modelPath: managedPath,
    removingActive,
  });

  if (!removingActive) {
    return {
      removed: true,
      settings: currentSettings,
    };
  }

  const fallbackSpec = Object.values(WHISPER_MODEL_CATALOG).find((candidate) => {
    if (candidate.id === modelSpec.id) {
      return false;
    }
    return existsSync(getManagedWhisperModelPath(candidate));
  });

  if (fallbackSpec) {
    return {
      removed: true,
      settings: await activateWhisperModel(fallbackSpec.id),
    };
  }

  return {
    removed: true,
    settings: await updateSettingsPatch({
      aiProcessingEnabled: false,
      transcriptionDefaults: {
        provider: "auto",
        model: undefined,
      },
      transcriptionSetup: {
        status: "pending",
        modelId: undefined,
        modelPath: undefined,
      },
    }),
  };
}

function serializeTelemetryContext(value: unknown, depth = 0): unknown {
  if (depth > 3) {
    return "[max-depth]";
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (typeof value === "string") {
    if (value.length > 4000) {
      return `${value.slice(0, 3997)}...`;
    }
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 32).map((entry) => serializeTelemetryContext(entry, depth + 1));
  }

  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(source).slice(0, 40)) {
      output[key] = serializeTelemetryContext(entry, depth + 1);
    }
    return output;
  }

  if (typeof value === "undefined") {
    return undefined;
  }

  return String(value);
}

async function rotateTelemetryFileIfNeeded(logPath: string): Promise<void> {
  let logSize = 0;
  try {
    logSize = (await stat(logPath)).size;
  } catch {
    return;
  }

  if (logSize < TELEMETRY_MAX_BYTES) {
    return;
  }

  const oldestArchivePath = `${logPath}.${TELEMETRY_ARCHIVE_COUNT}`;
  await rm(oldestArchivePath, { force: true }).catch(() => undefined);

  for (let index = TELEMETRY_ARCHIVE_COUNT - 1; index >= 1; index -= 1) {
    const source = `${logPath}.${index}`;
    const target = `${logPath}.${index + 1}`;
    if (!existsSync(source)) {
      continue;
    }
    await rename(source, target).catch(() => undefined);
  }

  await rename(logPath, `${logPath}.1`).catch(() => undefined);
}

function writeTelemetry(level: TelemetryLevel, event: string, context?: unknown): void {
  const eventName = event.trim().slice(0, TELEMETRY_EVENT_MAX_CHARS) || "event";
  const entry: Record<string, unknown> = {
    at: nowIso(),
    level,
    event: eventName,
  };
  if (typeof context !== "undefined") {
    entry.context = serializeTelemetryContext(context);
  }

  const line = `${JSON.stringify(entry)}\n`;
  telemetryWriteChain = telemetryWriteChain
    .then(async () => {
      const telemetryFilePath = getTelemetryFilePath();
      await mkdir(path.dirname(telemetryFilePath), { recursive: true });
      await rotateTelemetryFileIfNeeded(telemetryFilePath);
      await appendFile(telemetryFilePath, line, "utf8");
    })
    .catch(() => undefined);
}

function logInfo(event: string, context?: unknown): void {
  writeTelemetry("info", event, context);
}

function logWarn(event: string, context?: unknown): void {
  writeTelemetry("warn", event, context);
}

function logError(event: string, context?: unknown): void {
  writeTelemetry("error", event, context);
}

async function flushTelemetryWrites(): Promise<void> {
  await telemetryWriteChain.catch(() => undefined);
}

async function readTelemetryTail(maxLines: number): Promise<string[]> {
  const logPath = getTelemetryFilePath();
  if (!existsSync(logPath)) {
    return [];
  }

  try {
    const raw = await readFile(logPath, "utf8");
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

function getDefaultStorageDir(): string {
  if (process.platform === "darwin") {
    return path.join(app.getPath("videos"), "Coview", "recordings");
  }
  return path.join(app.getPath("documents"), "Coview", "recordings");
}

function getLegacyDarwinDefaultStorageDir(): string {
  return path.join(app.getPath("documents"), "Coview", "recordings");
}

function isSamePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function ensureStorageDirReady(
  storageDir: string,
  options: { allowLegacyDarwinFallback?: boolean } = {},
): Promise<string> {
  try {
    await mkdir(storageDir, { recursive: true });
    await ensureLibraryManifest(storageDir);
    return storageDir;
  } catch (error) {
    if (
      options.allowLegacyDarwinFallback &&
      process.platform === "darwin" &&
      isSamePath(storageDir, getLegacyDarwinDefaultStorageDir())
    ) {
      const fallbackStorageDir = getDefaultStorageDir();
      if (!isSamePath(storageDir, fallbackStorageDir)) {
        try {
          await mkdir(fallbackStorageDir, { recursive: true });
          await ensureLibraryManifest(fallbackStorageDir);
          logWarn("storage.default_dir_fallback", {
            storageDir,
            fallbackStorageDir,
            error,
          });
          return fallbackStorageDir;
        } catch (fallbackError) {
          logError("storage.default_dir_fallback_failed", {
            storageDir,
            fallbackStorageDir,
            error,
            fallbackError,
          });
        }
      }
    }

    const platformHint =
      process.platform === "darwin"
        ? " Grant macOS Files and Folders access, or choose another library in Settings."
        : " Choose another library in Settings.";
    throw new Error(
      `Active library is not writable: ${storageDir}.${platformHint} Original error: ${toErrorMessage(error)}`,
    );
  }
}

async function resolveUsableEffectiveSettings(
  effectiveSettings: EffectiveSettings,
  options: { allowLegacyDarwinFallback?: boolean } = {},
): Promise<EffectiveSettings> {
  const storageDir = await ensureStorageDirReady(effectiveSettings.storageDir, options);
  if (isSamePath(storageDir, effectiveSettings.storageDir)) {
    return effectiveSettings;
  }
  return {
    ...effectiveSettings,
    storageDir,
  };
}

async function getUsableEffectiveSettings(
  options: { allowLegacyDarwinFallback?: boolean } = {},
): Promise<EffectiveSettings> {
  const effectiveSettings = await resolveUsableEffectiveSettings(
    getEffectiveSettings(await readSettings()),
    options,
  );
  const storedSettings = await readSettings();
  if (storedSettings.storageDir && isSamePath(storedSettings.storageDir, effectiveSettings.storageDir)) {
    return effectiveSettings;
  }
  if (
    !storedSettings.storageDir &&
    isSamePath(getDefaultStorageDir(), effectiveSettings.storageDir)
  ) {
    return effectiveSettings;
  }
  await persistEffectiveSettings(effectiveSettings);
  return effectiveSettings;
}

function clampTelemetryTailLines(value: unknown): number {
  return clampTelemetryTailLinesHelper(
    value,
    TELEMETRY_DEFAULT_TAIL_LINES,
    TELEMETRY_MAX_TAIL_LINES,
  );
}

function getEffectiveTranscriptionOptions(
  raw: Partial<TranscriptionRequestOptions> | undefined,
): EffectiveTranscriptionRequestOptions {
  return getEffectiveTranscriptionOptionsHelper(raw, DEFAULT_TRANSCRIPTION_LANGUAGE);
}

function getEffectiveSettings(raw: AppSettings): EffectiveSettings {
  return getEffectiveSettingsHelper(raw, {
    defaultStorageDir: getDefaultStorageDir(),
    defaultAutoRecordEnabled: DEFAULT_AUTO_RECORD_ENABLED,
    defaultAiProcessingEnabled: DEFAULT_AI_PROCESSING_ENABLED,
    defaultInactivityTimeoutMinutes: DEFAULT_INACTIVITY_TIMEOUT_MINUTES,
    minInactivityTimeoutMinutes: MIN_INACTIVITY_TIMEOUT_MINUTES,
    maxInactivityTimeoutMinutes: MAX_INACTIVITY_TIMEOUT_MINUTES,
    defaultTranscriptionLanguage: DEFAULT_TRANSCRIPTION_LANGUAGE,
    defaultHotkeys: DEFAULT_HOTKEYS,
  });
}

async function readSettings(): Promise<AppSettings> {
  const settingsPath = getSettingsPath();
  if (!existsSync(settingsPath)) {
    return {};
  }

  try {
    const raw = await readFile(settingsPath, "utf8");
    return JSON.parse(raw) as AppSettings;
  } catch {
    return {};
  }
}

async function writeSettings(settings: AppSettings): Promise<void> {
  const settingsPath = getSettingsPath();
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf8");
}

async function persistEffectiveSettings(settings: EffectiveSettings): Promise<void> {
  await writeSettings({
    storageDir: settings.storageDir,
    autoRecordEnabled: settings.autoRecordEnabled,
    aiProcessingEnabled: settings.aiProcessingEnabled,
    inactivityTimeoutMinutes: settings.inactivityTimeoutMinutes,
    hotkeys: settings.hotkeys,
    transcriptionDefaults: settings.transcriptionDefaults,
    transcriptionSetup: settings.transcriptionSetup,
  });
}

async function getResolvedStorageDir(): Promise<string> {
  return (await getUsableEffectiveSettings({ allowLegacyDarwinFallback: true })).storageDir;
}

async function resolveRecordingSessionStorageDir(recordingSessionId: string): Promise<string> {
  const storageDir = inProgressRecordingStorageDirs.get(recordingSessionId);
  if (storageDir) {
    return storageDir;
  }
  return getResolvedStorageDir();
}

async function beginRecordingSession(payload: BeginRecordingSessionPayload): Promise<{ recordingSessionId: string }> {
  if (!payload || typeof payload.mimeType !== "string" || payload.mimeType.trim().length === 0) {
    throw new Error("Invalid recording session payload.");
  }

  const effectiveSettings = await getUsableEffectiveSettings({ allowLegacyDarwinFallback: true });
  const storageDir = effectiveSettings.storageDir;

  const recordingSessionId = randomUUID();
  const startedAt = payload.metadata?.startedAt ?? nowIso();
  await createInProgressRecordingSession({
    storageDir,
    recordingId: recordingSessionId,
    mimeType: payload.mimeType,
    startedAt,
    aiProcessingEnabled: effectiveSettings.aiProcessingEnabled,
    metadata: {
      ...(payload.metadata ?? {}),
      startedAt,
    },
  });

  inProgressRecordingStorageDirs.set(recordingSessionId, storageDir);
  logInfo("recording.session_started", {
    recordingSessionId,
    storageDir,
    mimeType: payload.mimeType,
    aiProcessingEnabled: effectiveSettings.aiProcessingEnabled,
  });
  return { recordingSessionId };
}

async function appendRecordingSessionChunk(payload: AppendRecordingChunkPayload): Promise<{
  bytesWritten: number;
  chunkCount: number;
}> {
  if (!payload || typeof payload.recordingSessionId !== "string") {
    throw new Error("Invalid recording chunk payload.");
  }

  const storageDir = await resolveRecordingSessionStorageDir(payload.recordingSessionId);
  return withRecordingSessionLock(payload.recordingSessionId, async () => {
    const manifest = await appendInProgressRecordingChunk({
      storageDir,
      recordingId: payload.recordingSessionId,
      data: payload.data,
    });
    inProgressRecordingStorageDirs.set(payload.recordingSessionId, storageDir);
    return {
      bytesWritten: manifest.byteLength,
      chunkCount: manifest.chunkCount,
    };
  });
}

async function completeRecordingSession(params: {
  recordingSessionId: string;
  mimeType: string;
  metadata?: SaveRecordingMetadata;
  recovered?: boolean;
  storageDir?: string;
}): Promise<SaveRecordingResult> {
  const storageDir = params.storageDir ?? (await resolveRecordingSessionStorageDir(params.recordingSessionId));
  return withRecordingSessionLock(params.recordingSessionId, async () => {
    const recoverable = await getRecoverableRecordingSession(storageDir, params.recordingSessionId);
    if (!recoverable) {
      throw new Error("In-progress recording session was not found.");
    }

    const mergedMetadata = {
      ...recoverable.metadata,
      ...(params.metadata ?? {}),
    } as Record<string, unknown>;

    const startedAt = parseString(mergedMetadata.startedAt, recoverable.startedAt);
    const endedAt = parseString(mergedMetadata.endedAt, recoverable.updatedAt || nowIso());
    const durationMs = getRecordingDurationMs(startedAt, endedAt);

    if (!recoverable.mediaPath || !isMeaningfulCapture({ byteLength: recoverable.byteLength, durationMs })) {
      await discardInProgressRecordingSession(storageDir, params.recordingSessionId);
      inProgressRecordingStorageDirs.delete(params.recordingSessionId);
      logInfo("recording.session_dropped_empty", {
        recordingSessionId: params.recordingSessionId,
        storageDir,
        bytesWritten: recoverable.byteLength,
        durationMs,
      });
      return {
        mediaPath: null,
        metadataPath: null,
        bytesWritten: recoverable.byteLength,
        processingJobId: null,
        processingStatus: "dropped",
        droppedEmpty: true,
      };
    }

    const sessionId = createMonotonicUlid();
    const sourceName = parseString(mergedMetadata.sourceName, recoverable.id);
    const rawTitle = parseString(mergedMetadata.title, sourceName || "recording");
    const fileStem = buildRecordingFileStem(startedAt, rawTitle, sessionId);
    const extension = getExtensionForMimeType(params.mimeType || recoverable.manifest?.mimeType || "");
    const mediaFilename = `${fileStem}.${extension}`;
    const metadataFilename = `${fileStem}.json`;
    const metadataCreatedAt = recoverable.manifest?.createdAt ?? nowIso();
    const updatedAt = nowIso();

    const finalMetadata: Record<string, unknown> = {
      id: sessionId,
      createdAt: metadataCreatedAt,
      updatedAt,
      mimeType: params.mimeType || recoverable.manifest?.mimeType || "application/octet-stream",
      mediaFilename,
      ...recoverable.metadata,
      ...mergedMetadata,
      startedAt,
      endedAt,
    };

    if (params.recovered) {
      finalMetadata.recoveryState = "recovered";
      finalMetadata.recoveredAt = updatedAt;
      if (parseString(finalMetadata.stopReason).length === 0) {
        finalMetadata.stopReason = "recovered-after-crash";
      }
    }

    if (!recoverable.aiProcessingEnabled) {
      finalMetadata.processing = {
        status: "disabled",
        updatedAt,
        reason: "ai-processing-disabled",
      };
    }

    const result = await finalizeInProgressRecordingSession({
      storageDir,
      recordingId: params.recordingSessionId,
      mediaFilename,
      metadataFilename,
      finalMetadata,
    });

    inProgressRecordingStorageDirs.delete(params.recordingSessionId);

    let processingJobId: string | null = null;
    let processingStatus: SaveProcessingStatus = "disabled";
    if (recoverable.aiProcessingEnabled) {
      const job = await enqueueProcessingJob({
        sessionId,
        mediaPath: result.mediaPath,
        metadataPath: result.metadataPath,
        title: rawTitle,
        transcription: getEffectiveSettings(await readSettings()).transcriptionDefaults,
      });
      processingJobId = job.id;
      processingStatus = job.status;
    }

    invalidateSessionIndexCache();

    logInfo(params.recovered ? "recording.session_recovered" : "recording.session_saved", {
      recordingSessionId: params.recordingSessionId,
      sessionId,
      mediaPath: result.mediaPath,
      metadataPath: result.metadataPath,
      bytesWritten: result.bytesWritten,
      durationMs,
      processingJobId,
      processingStatus,
    });

    return {
      mediaPath: result.mediaPath,
      metadataPath: result.metadataPath,
      bytesWritten: result.bytesWritten,
      processingJobId,
      processingStatus,
      droppedEmpty: false,
    };
  });
}

async function cancelRecordingSession(recordingSessionId: string): Promise<{ cancelled: true }> {
  const storageDir = await resolveRecordingSessionStorageDir(recordingSessionId);
  await withRecordingSessionLock(recordingSessionId, async () => {
    await discardInProgressRecordingSession(storageDir, recordingSessionId);
  });
  inProgressRecordingStorageDirs.delete(recordingSessionId);
  logInfo("recording.session_cancelled", {
    recordingSessionId,
    storageDir,
  });
  return { cancelled: true };
}

function getExtensionForMimeType(mimeType: string): string {
  if (mimeType.includes("webm")) {
    return "webm";
  }
  if (mimeType.includes("mp4")) {
    return "mp4";
  }
  return "bin";
}

function getAppAssetPath(filename: string): string {
  return path.join(__dirname, "assets", "icons", filename);
}

function loadAppIconAsset(filename: string): Electron.NativeImage | null {
  const iconPath = getAppAssetPath(filename);
  if (!existsSync(iconPath)) {
    return null;
  }

  const image = nativeImage.createFromPath(iconPath);
  return image.isEmpty() ? null : image;
}

function loadAppAssetDataUrl(filename: string, mimeType: string): string | null {
  const assetPath = getAppAssetPath(filename);
  if (!existsSync(assetPath)) {
    return null;
  }
  return `data:${mimeType};base64,${readFileSync(assetPath).toString("base64")}`;
}

function createDarwinTrayIcon(): Electron.NativeImage | null {
  const oneXDataUrl = loadAppAssetDataUrl("coview_tray_template_18x18.png", "image/png");
  const twoXDataUrl = loadAppAssetDataUrl("coview_tray_template_36x36.png", "image/png");
  if (oneXDataUrl && twoXDataUrl) {
    const image = nativeImage.createEmpty();
    image.addRepresentation({ scaleFactor: 1, dataURL: oneXDataUrl });
    image.addRepresentation({ scaleFactor: 2, dataURL: twoXDataUrl });
    if (!image.isEmpty()) {
      image.setTemplateImage(true);
      return image;
    }
  }

  const svgDataUrl = loadAppAssetDataUrl("coview_tray_template.svg", "image/svg+xml");
  if (!svgDataUrl) {
    return null;
  }

  const image = nativeImage.createFromDataURL(svgDataUrl).resize({ width: 18, height: 18 });
  if (image.isEmpty()) {
    return null;
  }

  image.setTemplateImage(true);
  return image;
}

function createTrayIcon(): Electron.NativeImage {
  if (process.platform === "darwin") {
    const image = createDarwinTrayIcon();
    if (image) {
      return image;
    }
  }

  if (process.platform !== "darwin") {
    const image = loadAppIconAsset("coview_32.png");
    if (image) {
      return image.resize({ width: 18, height: 18 });
    }
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
      <rect x="2" y="2" width="14" height="14" rx="3" fill="#111111" />
      <circle cx="9" cy="9" r="2.25" fill="#ffffff" />
    </svg>
  `;
  const image = nativeImage
    .createFromDataURL(`data:image/svg+xml,${encodeURIComponent(svg)}`)
    .resize({ width: 18, height: 18 });
  if (process.platform === "darwin") {
    image.setTemplateImage(true);
  }
  return image;
}

function showMainWindow(): void {
  if (!mainWindow) {
    return;
  }
  mainWindow.show();
  mainWindow.focus();
}

function toggleMainWindow(): void {
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isVisible()) {
    mainWindow.hide();
    return;
  }
  showMainWindow();
}

async function createMainWindow(): Promise<void> {
  const windowIcon = process.platform === "darwin" ? null : loadAppIconAsset("coview_512.png");
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    ...(windowIcon ? { icon: windowIcon } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  await mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }
    event.preventDefault();
    mainWindow?.hide();
  });
}

function createTray(): void {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("Coview");

  tray.on("click", () => {
    toggleMainWindow();
  });

  const menu = Menu.buildFromTemplate([
    {
      label: "Open Coview",
      click: () => showMainWindow(),
    },
    {
      type: "separator",
    },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
}

async function getPermissionStatus(): Promise<{
  microphone: string;
  screen: string;
  platform: string;
}> {
  if (process.platform === "darwin") {
    return {
      microphone: systemPreferences.getMediaAccessStatus("microphone"),
      screen: systemPreferences.getMediaAccessStatus("screen"),
      platform: "darwin",
    };
  }

  // On Linux, probe screen capture availability via desktopCapturer.
  // Mic probing happens in the renderer via getUserMedia.
  let screenStatus = "unknown";
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 0, height: 0 },
    });
    screenStatus = sources.length > 0 ? "available" : "no-sources";
  } catch {
    screenStatus = "unavailable";
  }

  return { microphone: "probe-renderer", screen: screenStatus, platform: process.platform };
}

function sendHotkeyAction(action: HotkeyAction): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("hotkey:action", action);
}

function tryRegisterHotkeys(hotkeys: HotkeySettings): Array<keyof HotkeySettings> {
  globalShortcut.unregisterAll();
  const failed: Array<keyof HotkeySettings> = [];

  const registrations: Array<{
    key: keyof HotkeySettings;
    accelerator: string;
    action: HotkeyAction;
  }> = [
    {
      key: "startStop",
      accelerator: hotkeys.startStop,
      action: "start-stop",
    },
    {
      key: "pauseResume",
      accelerator: hotkeys.pauseResume,
      action: "pause-resume",
    },
    {
      key: "autoToggle",
      accelerator: hotkeys.autoToggle,
      action: "auto-toggle",
    },
  ];

  for (const registration of registrations) {
    const ok = globalShortcut.register(registration.accelerator, () => {
      sendHotkeyAction(registration.action);
    });
    if (!ok) {
      failed.push(registration.key);
    }
  }

  return failed;
}

function registerGlobalHotkeys(hotkeys: HotkeySettings): void {
  const previousHotkeys = { ...activeHotkeys };
  const failures = tryRegisterHotkeys(hotkeys);
  if (failures.length > 0) {
    tryRegisterHotkeys(previousHotkeys);
    logError("hotkeys.register_failed", {
      failures,
      requested: hotkeys,
      revertedTo: previousHotkeys,
    });
    throw new Error(`Failed to register hotkeys: ${failures.join(", ")}`);
  }
  activeHotkeys = { ...hotkeys };
  logInfo("hotkeys.registered", {
    startStop: hotkeys.startStop,
    pauseResume: hotkeys.pauseResume,
    autoToggle: hotkeys.autoToggle,
  });
}

async function isSlackProcessRunning(): Promise<boolean> {
  if (process.platform !== "darwin") {
    return false;
  }

  try {
    await execFileAsync("pgrep", ["-x", "Slack"]);
    return true;
  } catch {
    return false;
  }
}

async function getSlackWindowTitles(): Promise<string[]> {
  if (process.platform !== "darwin") {
    return [];
  }

  const script = `
tell application "System Events"
  if exists process "Slack" then
    try
      set windowNames to name of windows of process "Slack"
      return windowNames
    on error
      return ""
    end try
  else
    return ""
  end if
end tell
  `;

  try {
    const { stdout } = await execFileAsync("osascript", ["-e", script], {
      timeout: 2000,
      maxBuffer: MAX_EXEC_BUFFER,
    });
    const normalized = stdout.trim();
    if (normalized.length === 0) {
      return [];
    }
    return normalized
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  } catch {
    return [];
  }
}

async function getSlackActivitySignal(): Promise<{
  isRunning: boolean;
  callHintActive: boolean;
  callHints: string[];
  windowTitles: string[];
  checkedAt: string;
}> {
  const isRunning = await isSlackProcessRunning();
  if (!isRunning) {
    return {
      isRunning: false,
      callHintActive: false,
      callHints: [],
      windowTitles: [],
      checkedAt: nowIso(),
    };
  }

  const windowTitles = await getSlackWindowTitles();
  const callHints = windowTitles.filter((title) => CALL_HINT_PATTERN.test(title));

  return {
    isRunning: true,
    callHintActive: callHints.length > 0,
    callHints,
    windowTitles,
    checkedAt: nowIso(),
  };
}

function toJobView(job: ProcessingJobRecord): ProcessingJobView {
  return {
    id: job.id,
    sessionId: job.sessionId,
    title: job.title,
    status: job.status,
    attemptCount: job.attemptCount,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    failedAt: job.failedAt,
    errorMessage: job.errorMessage,
    jobKind: job.jobKind,
    requestedProvider: job.requestedProvider,
    requestedModel: job.requestedModel,
    requestedLanguage: job.requestedLanguage,
    transcriptProvider: job.transcriptProvider,
    transcriptModel: job.transcriptModel,
    transcriptLanguage: job.transcriptLanguage,
    transcriptChars: job.transcriptChars,
    durationMs: job.durationMs,
    providerLatencyMs: job.providerLatencyMs,
    summaryPreview: job.summaryPreview,
  };
}

function listJobsForRenderer(): ProcessingJobView[] {
  return [...processingJobs]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((job) => toJobView(job));
}

function publishJobsToRenderer(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("processing:jobs-updated", listJobsForRenderer());
}

function getStemFromPath(filePath: string): string {
  return path.parse(filePath).name;
}

function computeArtifacts(mediaPath: string): {
  transcriptPath: string;
  transcriptSegmentsPath: string;
  analysisPath: string;
} {
  return computeArtifactsHelper(mediaPath, TRANSCRIPT_SEGMENTS_FILENAME_SUFFIX);
}

function isPathInside(parentDir: string, candidatePath: string): boolean {
  const parent = path.resolve(parentDir);
  const candidate = path.resolve(candidatePath);
  if (candidate === parent) {
    return true;
  }
  return candidate.startsWith(`${parent}${path.sep}`);
}

function safeReadJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {}
  return {};
}

async function writeProcessingJobsStore(): Promise<void> {
  const jobsPath = getProcessingJobsPath();
  await mkdir(path.dirname(jobsPath), { recursive: true });
  await writeFile(jobsPath, JSON.stringify(processingJobs, null, 2), "utf8");
}

async function loadProcessingJobsStore(): Promise<void> {
  if (processingJobsLoaded) {
    return;
  }

  const jobsPath = getProcessingJobsPath();
  if (!existsSync(jobsPath)) {
    processingJobs = [];
    processingJobsLoaded = true;
    return;
  }

  try {
    const raw = await readFile(jobsPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      processingJobs = parsed
        .filter((item) => item && typeof item === "object")
        .map((item) => item as ProcessingJobRecord);
    } else {
      processingJobs = [];
    }
  } catch {
    processingJobs = [];
  }

  let changed = false;
  for (const job of processingJobs) {
    if (!job.transcriptSegmentsPath) {
      job.transcriptSegmentsPath = computeArtifacts(job.mediaPath).transcriptSegmentsPath;
      changed = true;
    }
    if (job.status === "processing") {
      job.status = "queued";
      job.updatedAt = nowIso();
      job.errorMessage = "Recovered after app restart";
      changed = true;
    }
  }

  if (changed) {
    await writeProcessingJobsStore();
  }
  processingJobsLoaded = true;
}

async function updateSessionMetadata(
  metadataPath: string,
  update: (existing: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  let existing: Record<string, unknown> = {};
  if (existsSync(metadataPath)) {
    try {
      existing = safeReadJsonObject(await readFile(metadataPath, "utf8"));
    } catch {
      existing = {};
    }
  }

  const next = update(existing);
  await writeFile(metadataPath, JSON.stringify(next, null, 2), "utf8");
}

async function resolveSessionMediaPath(
  storageDir: string,
  sessionId: string,
  mediaFilenameCandidate: string,
): Promise<string | null> {
  if (mediaFilenameCandidate.length > 0) {
    const candidatePath = path.join(storageDir, mediaFilenameCandidate);
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  const fallbackCandidates = [
    `${sessionId}.webm`,
    `${sessionId}.mp4`,
    `${sessionId}.m4a`,
    `${sessionId}.wav`,
  ];
  for (const candidate of fallbackCandidates) {
    const candidatePath = path.join(storageDir, candidate);
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

function resolveTranscriptPath(
  storageDir: string,
  sessionId: string,
  mediaPath: string,
  metadataObject: Record<string, unknown>,
): string | undefined {
  const fromMetadata = parseString(metadataObject.transcriptPath);
  if (fromMetadata.length > 0 && existsSync(fromMetadata)) {
    return fromMetadata;
  }

  const artifactPaths = computeArtifacts(mediaPath);
  const candidates = [
    artifactPaths.transcriptPath,
    path.join(storageDir, `${sessionId}.transcript.txt`),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function resolveTranscriptSegmentsPath(
  storageDir: string,
  sessionId: string,
  mediaPath: string,
  metadataObject: Record<string, unknown>,
): string | undefined {
  const fromMetadata = parseString(metadataObject.transcriptSegmentsPath);
  if (fromMetadata.length > 0 && existsSync(fromMetadata)) {
    return fromMetadata;
  }

  const artifactPaths = computeArtifacts(mediaPath);
  const candidates = [
    artifactPaths.transcriptSegmentsPath,
    path.join(storageDir, `${sessionId}${TRANSCRIPT_SEGMENTS_FILENAME_SUFFIX}`),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function resolveAnalysisPath(
  storageDir: string,
  sessionId: string,
  mediaPath: string,
  metadataObject: Record<string, unknown>,
): string | undefined {
  const fromMetadata = parseString(metadataObject.analysisPath);
  if (fromMetadata.length > 0 && existsSync(fromMetadata)) {
    return fromMetadata;
  }

  const artifactPaths = computeArtifacts(mediaPath);
  const candidates = [
    artifactPaths.analysisPath,
    path.join(storageDir, `${sessionId}.analysis.json`),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function loadSessionEntryFromMetadataFile(
  storageDir: string,
  metadataFilename: string,
): Promise<SessionIndexEntry | null> {
  const metadataPath = path.join(storageDir, metadataFilename);
  let metadataObject: Record<string, unknown> = {};

  try {
    const raw = await readFile(metadataPath, "utf8");
    metadataObject = safeReadJsonObject(raw);
  } catch {
    return null;
  }

  const stem = getStemFromPath(metadataFilename);
  const sessionId = parseString(metadataObject.id, stem);
  const mediaFilename = parseString(metadataObject.mediaFilename);
  const mediaPath = await resolveSessionMediaPath(storageDir, sessionId, mediaFilename);
  if (!mediaPath) {
    return null;
  }

  const transcriptPath = resolveTranscriptPath(storageDir, sessionId, mediaPath, metadataObject);
  const transcriptSegmentsPath = resolveTranscriptSegmentsPath(
    storageDir,
    sessionId,
    mediaPath,
    metadataObject,
  );
  const analysisPath = resolveAnalysisPath(storageDir, sessionId, mediaPath, metadataObject);

  let transcriptText = "";
  if (transcriptPath && existsSync(transcriptPath)) {
    try {
      transcriptText = sanitizeTranscriptText(await readFile(transcriptPath, "utf8"));
    } catch {
      transcriptText = "";
    }
  }

  let transcriptSegments: TranscriptSegment[] = [];
  if (transcriptSegmentsPath && existsSync(transcriptSegmentsPath)) {
    try {
      transcriptSegments = readTranscriptSegmentsArtifact(
        await readFile(transcriptSegmentsPath, "utf8"),
      ).segments;
    } catch {
      transcriptSegments = [];
    }
  }
  if (transcriptText.length === 0 && transcriptSegments.length > 0) {
    transcriptText = buildTranscriptTextFromSegments(transcriptSegments);
  }

  const processingObject =
    metadataObject.processing && typeof metadataObject.processing === "object"
      ? (metadataObject.processing as Record<string, unknown>)
      : {};
  const processingStatus = parseString(processingObject.status, "unknown");

  let summary =
    processingStatus === "disabled" ? DEFAULT_AI_DISABLED_SESSION_SUMMARY : DEFAULT_SESSION_SUMMARY;
  let topics: string[] = [];
  let keywords: string[] = [];
  let transcriptProvider = parseString(processingObject.provider) || undefined;
  let transcriptModel = parseString(processingObject.model) || undefined;
  let transcriptLanguage = parseString(processingObject.language) || undefined;
  if (analysisPath && existsSync(analysisPath)) {
    try {
      const analysisObject = safeReadJsonObject(await readFile(analysisPath, "utf8"));
      const candidateSummary = parseString(analysisObject.summary);
      if (candidateSummary.length > 0) {
        summary = candidateSummary;
      }
      topics = parseStringArray(analysisObject.topics);
      keywords = parseStringArray(analysisObject.keywords);
      transcriptProvider = parseString(analysisObject.provider, transcriptProvider ?? "") || undefined;
      transcriptModel = parseString(analysisObject.model, transcriptModel ?? "") || undefined;
      transcriptLanguage =
        parseString(analysisObject.language, transcriptLanguage ?? "") || undefined;
    } catch {
      summary = DEFAULT_SESSION_SUMMARY;
      topics = [];
      keywords = [];
    }
  } else if (transcriptText.length > 0) {
    summary = buildSummary(transcriptText, extractTopics(transcriptText, 3));
    topics = extractTopics(transcriptText, 5);
    keywords = extractKeywords(transcriptText, 8);
  }

  const createdAt = ensureIsoDate(parseString(metadataObject.createdAt, nowIso()), nowIso());
  const startedAt = ensureIsoDate(parseString(metadataObject.startedAt, createdAt), createdAt);
  const endedAtRaw = parseString(metadataObject.endedAt);
  const endedAt =
    endedAtRaw.length > 0 ? ensureIsoDate(endedAtRaw, ensureIsoDate(endedAtRaw, startedAt)) : undefined;
  const updatedAtRaw = parseString(metadataObject.updatedAt, createdAt);
  const updatedAt = ensureIsoDate(updatedAtRaw, createdAt);

  const sourceName = parseString(metadataObject.sourceName);
  const title = sanitizeSessionTitle(
    parseString(metadataObject.title, sourceName || sessionId),
    sourceName || sessionId,
  );

  const searchText = buildSearchText([
    title,
    sourceName,
    summary,
    topics.join(" "),
    keywords.join(" "),
    transcriptText,
  ]);

  return {
    id: sessionId,
    title,
    sourceName: sourceName.length > 0 ? sourceName : undefined,
    startedAt,
    endedAt,
    createdAt,
    updatedAt,
    mediaPath,
    metadataPath,
    transcriptPath,
    transcriptSegmentsPath,
    analysisPath,
    processingStatus,
    screenMode: parseScreenMode(metadataObject.screenMode),
    audioMode: parseAudioMode(metadataObject.audioMode),
    autoTriggered: parseBoolean(metadataObject.autoTriggered),
    stopReason: parseString(metadataObject.stopReason) || undefined,
    transcriptProvider,
    transcriptModel,
    transcriptLanguage,
    transcriptSegments,
    transcriptText,
    summary,
    topics,
    keywords,
    searchText,
    searchTokenFrequency: toTokenFrequency(toSearchTokens(searchText)),
  };
}

async function loadSessionIndex(): Promise<SessionIndexEntry[]> {
  if (sessionIndexCache) {
    return sessionIndexCache;
  }

  const storageDir = await getResolvedStorageDir();
  const entries = await readdir(storageDir, {
    withFileTypes: true,
  });

  const metadataFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(".json"))
    .filter((name) => !name.endsWith(".analysis.json"))
    .filter((name) => !name.endsWith(TRANSCRIPT_SEGMENTS_FILENAME_SUFFIX));

  const sessions: SessionIndexEntry[] = [];
  for (const metadataFilename of metadataFiles) {
    const session = await loadSessionEntryFromMetadataFile(storageDir, metadataFilename);
    if (session) {
      sessions.push(session);
    }
  }

  sessions.sort((left, right) => {
    const leftKey = left.startedAt || left.createdAt;
    const rightKey = right.startedAt || right.createdAt;
    if (leftKey === rightKey) {
      return right.updatedAt.localeCompare(left.updatedAt);
    }
    return rightKey.localeCompare(leftKey);
  });

  sessionIndexCache = sessions;
  return sessions;
}

async function findSessionById(sessionId: string): Promise<SessionIndexEntry | null> {
  const sessions = await loadSessionIndex();
  return sessions.find((session) => session.id === sessionId) ?? null;
}

function toSearchResultView(
  session: SessionIndexEntry,
  score: number,
  matchType: SessionSearchMode,
): SessionSearchResultView {
  return {
    ...toSessionSummaryView(session),
    score,
    matchType,
  };
}

function parseString(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value;
  }
  return fallback;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item) => typeof item === "string")
    .map((item) => (item as string).trim())
    .filter((item) => item.length > 0);
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  return undefined;
}

function parseAudioMode(value: unknown): AudioMode | undefined {
  if (value === "system" || value === "mic" || value === "both") {
    return value;
  }
  return undefined;
}

function parseScreenMode(value: unknown): CaptureSourceType | undefined {
  if (value === "screen" || value === "window") {
    return value;
  }
  return undefined;
}

function ensureIsoDate(value: string, fallback: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }
  return date.toISOString();
}

function toSessionSummaryView(session: SessionIndexEntry): SessionSummaryView {
  return {
    id: session.id,
    title: session.title,
    sourceName: session.sourceName,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    processingStatus: session.processingStatus,
    summary: session.summary,
    topics: session.topics,
    keywords: session.keywords,
    transcriptSnippet: getTranscriptSnippet(session.transcriptText),
    updatedAt: session.updatedAt,
  };
}

function toSessionDetailView(session: SessionIndexEntry): SessionDetailView {
  return {
    ...toSessionSummaryView(session),
    mediaPath: session.mediaPath,
    metadataPath: session.metadataPath,
    transcriptPath: session.transcriptPath,
    transcriptSegmentsPath: session.transcriptSegmentsPath,
    analysisPath: session.analysisPath,
    transcriptSegments: session.transcriptSegments,
    transcriptText: session.transcriptText,
    screenMode: session.screenMode,
    audioMode: session.audioMode,
    autoTriggered: session.autoTriggered,
    stopReason: session.stopReason,
    transcriptProvider: session.transcriptProvider,
    transcriptModel: session.transcriptModel,
    transcriptLanguage: session.transcriptLanguage,
  };
}

async function commandExists(command: string): Promise<boolean> {
  const resolution = await resolveCommandContext(command);
  return Boolean(resolution?.path);
}

async function resolveCommandContext(
  command: string,
  forceRefresh = false,
): Promise<CommandResolution | null> {
  if (!forceRefresh && commandResolutionCache.has(command)) {
    return commandResolutionCache.get(command) ?? null;
  }

  if (command === "whisper-cli") {
    const bundledWhisper = resolveBundledWhisperCliCommand();
    if (bundledWhisper) {
      commandResolutionCache.set(command, bundledWhisper);
      return bundledWhisper;
    }
  }

  try {
    const { stdout } = await execFileAsync("which", [command], {
      timeout: 1500,
      maxBuffer: MAX_EXEC_BUFFER,
    });
    const resolved = stdout.trim().split(/\r?\n/)[0]?.trim() ?? "";
    const commandResolution: CommandResolution = {
      path: resolved.length > 0 ? resolved : null,
      source: resolved.length > 0 ? "system" : null,
    };
    commandResolutionCache.set(command, commandResolution);
    return commandResolution;
  } catch {
    const missingResolution: CommandResolution = {
      path: null,
      source: null,
    };
    commandResolutionCache.set(command, missingResolution);
    return missingResolution;
  }
}

async function resolveCommandPath(command: string, forceRefresh = false): Promise<string | null> {
  const commandResolution = await resolveCommandContext(command, forceRefresh);
  return commandResolution?.path ?? null;
}

function getCommandExecutionEnv(commandResolution: CommandResolution | null): NodeJS.ProcessEnv | undefined {
  if (!commandResolution?.env) {
    return undefined;
  }
  return commandResolution.env;
}

async function maybeConvertToWav(inputPath: string, tempDir: string): Promise<string> {
  const ffmpegCommand = await resolveCommandContext("ffmpeg");
  if (!ffmpegCommand?.path) {
    return inputPath;
  }

  const outputPath = path.join(tempDir, "audio.wav");
  try {
    await execFileAsync(
      ffmpegCommand.path,
      ["-y", "-i", inputPath, "-ac", "1", "-ar", "16000", "-vn", outputPath],
      {
        timeout: FFMPEG_TIMEOUT_MS,
        maxBuffer: MAX_EXEC_BUFFER,
        env: getCommandExecutionEnv(ffmpegCommand),
      },
    );
    return outputPath;
  } catch {
    return inputPath;
  }
}

async function transcribeWithWhisperCli(
  mediaPath: string,
  tempDir: string,
  options: EffectiveTranscriptionRequestOptions,
): Promise<TranscriptResult> {
  const whisperCliCommand = await resolveCommandContext("whisper-cli");
  if (!whisperCliCommand?.path) {
    throw new Error("whisper-cli not found");
  }
  const modelPath = resolveConfiguredWhisperModelPath(options);
  if (!modelPath) {
    throw new Error("No local whisper model is configured");
  }
  if (!existsSync(modelPath)) {
    throw new Error(`Configured whisper model was not found at ${modelPath}`);
  }

  const inputPath = await maybeConvertToWav(mediaPath, tempDir);
  const outputPrefix = path.join(tempDir, "whisper_cli_output");

  await execFileAsync(
    whisperCliCommand.path,
    ["-m", modelPath, "-f", inputPath, "-l", options.language, "-oj", "-of", outputPrefix, "-np"],
    {
      timeout: WHISPER_TIMEOUT_MS,
      maxBuffer: MAX_EXEC_BUFFER,
      env: getCommandExecutionEnv(whisperCliCommand),
    },
  );

  const transcriptPath = `${outputPrefix}.json`;
  if (!existsSync(transcriptPath)) {
    throw new Error("whisper-cli finished without JSON transcript output");
  }

  const transcript = parseWhisperCliTranscriptJson(await readFile(transcriptPath, "utf8"));

  return {
    text: transcript.text,
    provider: "local-whisper-cli",
    model: path.basename(modelPath),
    language: transcript.language ?? options.language,
    segments: transcript.segments,
  };
}

async function transcribeWithWhisperPython(
  mediaPath: string,
  tempDir: string,
  options: EffectiveTranscriptionRequestOptions,
): Promise<TranscriptResult> {
  const whisperCommand = await resolveCommandContext("whisper");
  if (!whisperCommand?.path) {
    throw new Error("python whisper command not found");
  }

  const args = [mediaPath, "--task", "transcribe", "--output_format", "json", "--output_dir", tempDir];
  if (options.language !== "auto") {
    args.push("--language", options.language);
  }
  if (options.model) {
    args.push("--model", options.model);
  }

  await execFileAsync(
    whisperCommand.path,
    args,
    {
      timeout: WHISPER_TIMEOUT_MS,
      maxBuffer: MAX_EXEC_BUFFER,
      env: getCommandExecutionEnv(whisperCommand),
    },
  );

  const baseName = getStemFromPath(mediaPath);
  const transcriptPath = path.join(tempDir, `${baseName}.json`);
  if (!existsSync(transcriptPath)) {
    throw new Error("python whisper finished without JSON transcript output");
  }

  const transcript = parseWhisperPythonTranscriptJson(await readFile(transcriptPath, "utf8"));

  return {
    text: transcript.text,
    provider: "local-whisper-python",
    model: options.model ?? "openai-whisper",
    language: transcript.language ?? options.language,
    segments: transcript.segments,
  };
}

async function transcribeRecording(
  mediaPath: string,
  options?: Partial<TranscriptionRequestOptions>,
): Promise<TranscriptResult> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "coview-transcribe-"));
  const errors: string[] = [];
  const effectiveOptions = getEffectiveTranscriptionOptions(options);

  try {
    const attempts =
      effectiveOptions.provider === "auto"
        ? [
            {
              label: "local-whisper-cli",
              run: () => transcribeWithWhisperCli(mediaPath, tempDir, effectiveOptions),
            },
            {
              label: "local-whisper-python",
              run: () => transcribeWithWhisperPython(mediaPath, tempDir, effectiveOptions),
            },
          ]
        : [
            {
              label: effectiveOptions.provider,
              run: () => {
                if (effectiveOptions.provider === "local-whisper-cli") {
                  return transcribeWithWhisperCli(mediaPath, tempDir, effectiveOptions);
                }
                if (effectiveOptions.provider === "local-whisper-python") {
                  return transcribeWithWhisperPython(mediaPath, tempDir, effectiveOptions);
                }
                throw new Error(`Unsupported transcription provider: ${effectiveOptions.provider}`);
              },
            },
          ];

    for (const attempt of attempts) {
      try {
        return await attempt.run();
      } catch (error) {
        errors.push(`${attempt.label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }

  throw new Error(`Transcription failed. Attempts: ${errors.join(" | ")}`);
}

async function getTranscriptionDiagnostics(forceRefresh = true): Promise<TranscriptionDiagnostics> {
  const settings = getEffectiveSettings(await readSettings());
  const whisperCliCommand = await resolveCommandContext("whisper-cli", forceRefresh);
  const whisperPythonCommand = await resolveCommandContext("whisper", forceRefresh);
  const ffmpegCommand = await resolveCommandContext("ffmpeg", forceRefresh);
  const modelPath = resolveConfiguredWhisperModelPath(settings.transcriptionDefaults);
  const modelExists = modelPath ? existsSync(modelPath) : false;
  const whisperCliReady = Boolean(whisperCliCommand?.path) && modelExists;
  const whisperPythonReady = Boolean(whisperPythonCommand?.path);

  const attemptOrder: string[] = [];
  if (whisperCliReady) {
    attemptOrder.push("local-whisper-cli");
  } else if (whisperCliCommand?.path && !modelExists) {
    attemptOrder.push("local-whisper-cli (missing model)");
  }
  if (whisperPythonReady) {
    attemptOrder.push("local-whisper-python");
  }

  const firstReadyProvider = whisperCliReady
    ? "local-whisper-cli"
    : whisperPythonReady
      ? "local-whisper-python"
      : undefined;

  const summary = firstReadyProvider
    ? `Auto will start with ${firstReadyProvider}.`
    : "No transcription provider is currently ready. Run Guided Setup in Settings to install a local model.";

  return {
    checkedAt: nowIso(),
    whisperCli: {
      available: Boolean(whisperCliCommand?.path),
      commandPath: whisperCliCommand?.path ?? undefined,
      source: whisperCliCommand?.source ?? undefined,
      modelPath,
      modelExists,
      ready: whisperCliReady,
    },
    whisperPython: {
      available: Boolean(whisperPythonCommand?.path),
      commandPath: whisperPythonCommand?.path ?? undefined,
      ready: whisperPythonReady,
    },
    ffmpeg: {
      available: Boolean(ffmpegCommand?.path),
      commandPath: ffmpegCommand?.path ?? undefined,
    },
    autoStrategy: {
      attemptOrder,
      firstReadyProvider,
      ready: Boolean(firstReadyProvider),
      summary,
    },
    managedModelDirectory: getManagedWhisperModelsDir(),
    setupStatus: settings.transcriptionSetup.status,
  };
}

async function chooseTranscriptionModelFile(): Promise<string | null> {
  const options: OpenDialogOptions = {
    properties: ["openFile"],
    filters: [
      {
        name: "Whisper model",
        extensions: ["bin"],
      },
      {
        name: "All files",
        extensions: ["*"],
      },
    ],
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
}

async function installWhisperModel(modelId = "base.en"): Promise<{
  modelId: string;
  displayName: string;
  description: string;
  modelPath: string;
  alreadyExisted: boolean;
  settings: EffectiveSettings;
}> {
  const modelSpec = WHISPER_MODEL_CATALOG[modelId];
  if (!modelSpec) {
    throw new Error("Unsupported whisper model selection");
  }
  if (activeWhisperModelInstallId) {
    throw new Error("Another model download is already in progress.");
  }

  const whisperCliCommand = await resolveCommandContext("whisper-cli", true);
  if (!whisperCliCommand?.path) {
    throw new Error("No local whisper runtime is available to use a downloaded ggml model.");
  }

  const modelsDir = getManagedWhisperModelsDir();
  const targetPath = getManagedWhisperModelPath(modelSpec);
  const temporaryPath = `${targetPath}.download`;
  let alreadyExisted = existsSync(targetPath);

  await mkdir(modelsDir, { recursive: true });
  if (!alreadyExisted) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    activeWhisperModelInstallId = modelId;
    emitWhisperModelDownloadProgress({
      modelId,
      status: "downloading",
      downloadedBytes: 0,
      totalBytes: modelSpec.sizeBytes,
      message: `Downloading ${modelSpec.displayName}`,
    });

    try {
      const response = await fetch(modelSpec.url);
      if (!response.ok || !response.body) {
        throw new Error(`Download failed with status ${response.status}`);
      }
      const reader = response.body.getReader();
      const totalBytesHeader = Number.parseInt(response.headers.get("content-length") || "", 10);
      const totalBytes = Number.isFinite(totalBytesHeader) && totalBytesHeader > 0
        ? totalBytesHeader
        : modelSpec.sizeBytes;
      let downloadedBytes = 0;
      const stream = createWriteStream(temporaryPath);

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (!value || value.byteLength === 0) {
          continue;
        }
        downloadedBytes += value.byteLength;
        if (!stream.write(Buffer.from(value))) {
          await new Promise<void>((resolve, reject) => {
            stream.once("drain", resolve);
            stream.once("error", reject);
          });
        }
        emitWhisperModelDownloadProgress({
          modelId,
          status: "downloading",
          downloadedBytes,
          totalBytes,
          message: `Downloading ${modelSpec.displayName}`,
        });
      }

      await new Promise<void>((resolve, reject) => {
        stream.end(() => resolve());
        stream.once("error", reject);
      });
      await rename(temporaryPath, targetPath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      emitWhisperModelDownloadProgress({
        modelId,
        status: "failed",
        downloadedBytes: 0,
        totalBytes: modelSpec.sizeBytes,
        message: error instanceof Error ? error.message : "Download failed",
      });
      logError("transcription.model_download_failed", {
        modelId,
        modelPath: targetPath,
        error,
      });
      activeWhisperModelInstallId = null;
      throw error instanceof Error
        ? error
        : new Error(`Failed to download ${modelSpec.displayName}`);
    }
    activeWhisperModelInstallId = null;
    emitWhisperModelDownloadProgress({
      modelId,
      status: "completed",
      downloadedBytes: modelSpec.sizeBytes,
      totalBytes: modelSpec.sizeBytes,
      message: `${modelSpec.displayName} installed`,
    });
    alreadyExisted = false;
  }

  const settings = await activateWhisperModel(modelSpec.id);

  logInfo("transcription.model_installed", {
    modelId: modelSpec.id,
    modelPath: targetPath,
    alreadyExisted,
  });

  return {
    modelId: modelSpec.id,
    displayName: modelSpec.displayName,
    description: modelSpec.description,
    modelPath: targetPath,
    alreadyExisted,
    settings,
  };
}

async function runTranscriptionTest(
  sessionId: string,
  options?: Partial<TranscriptionRequestOptions>,
): Promise<TranscriptionTestResult> {
  const session = await findSessionById(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }
  if (!existsSync(session.mediaPath)) {
    throw new Error("Session recording file was not found.");
  }

  const startedAt = Date.now();
  const transcript = await transcribeRecording(session.mediaPath, options);
  const elapsedMs = Date.now() - startedAt;

  logInfo("transcription.test_completed", {
    sessionId,
    provider: transcript.provider,
    model: transcript.model,
    language: transcript.language,
    transcriptChars: transcript.text.length,
    elapsedMs,
  });

  return {
    sessionId,
    provider: transcript.provider,
    model: transcript.model,
    language: transcript.language,
    transcriptChars: transcript.text.length,
    previewText: buildPreviewText(transcript.text),
    elapsedMs,
    testedAt: nowIso(),
  };
}

function parseProcessingHistory(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => entry as Record<string, unknown>);
}

function buildProcessingAttemptSnapshot(job: ProcessingJobRecord): Record<string, unknown> {
  return {
    jobId: job.id,
    sessionId: job.sessionId,
    status: job.status,
    attemptCount: job.attemptCount,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    failedAt: job.failedAt,
    errorMessage: job.errorMessage,
    jobKind: job.jobKind,
    requestedProvider: job.requestedProvider,
    requestedModel: job.requestedModel,
    requestedLanguage: job.requestedLanguage,
    transcriptProvider: job.transcriptProvider,
    transcriptModel: job.transcriptModel,
    transcriptLanguage: job.transcriptLanguage,
    transcriptChars: job.transcriptChars,
    durationMs: job.durationMs,
    providerLatencyMs: job.providerLatencyMs,
    summaryPreview: job.summaryPreview,
  };
}

function mergeProcessingHistory(
  existingProcessing: Record<string, unknown>,
  currentAttempt: Record<string, unknown>,
): Record<string, unknown>[] {
  const existingHistory = parseProcessingHistory(existingProcessing.history);
  const currentJobId = parseString(currentAttempt.jobId);
  const currentAttemptCount =
    typeof currentAttempt.attemptCount === "number" ? currentAttempt.attemptCount : undefined;

  const filteredHistory = existingHistory.filter((entry) => {
    const entryJobId = parseString(entry.jobId);
    const entryAttemptCount =
      typeof entry.attemptCount === "number" ? entry.attemptCount : undefined;
    return entryJobId !== currentJobId || entryAttemptCount !== currentAttemptCount;
  });

  return [currentAttempt, ...filteredHistory].slice(0, PROCESSING_HISTORY_LIMIT);
}

async function runProcessingJob(job: ProcessingJobRecord): Promise<void> {
  const requestedOptions = getEffectiveTranscriptionOptions({
    provider: job.requestedProvider,
    model: job.requestedModel,
    language: job.requestedLanguage,
  });
  let recordingDurationMs: number | undefined;
  if (existsSync(job.metadataPath)) {
    try {
      const metadataObject = safeReadJsonObject(await readFile(job.metadataPath, "utf8"));
      const startedAt = parseString(metadataObject.startedAt);
      const endedAt = parseString(metadataObject.endedAt);
      if (startedAt.length > 0 && endedAt.length > 0) {
        recordingDurationMs = getRecordingDurationMs(startedAt, endedAt);
      }
    } catch {
      recordingDurationMs = undefined;
    }
  }
  job.status = "processing";
  job.attemptCount += 1;
  job.updatedAt = nowIso();
  job.startedAt = nowIso();
  job.completedAt = undefined;
  job.failedAt = undefined;
  job.errorMessage = undefined;
  job.durationMs = recordingDurationMs;
  job.providerLatencyMs = undefined;
  await writeProcessingJobsStore();
  publishJobsToRenderer();
  logInfo("processing.job_started", {
    jobId: job.id,
    sessionId: job.sessionId,
    attemptCount: job.attemptCount,
    jobKind: job.jobKind ?? "initial",
    requestedProvider: requestedOptions.provider,
    requestedModel: requestedOptions.model,
    requestedLanguage: requestedOptions.language,
  });

  await withSessionLock(job.sessionId, async () => {
    await updateSessionMetadata(job.metadataPath, (existing) => {
      const existingProcessing =
        existing.processing && typeof existing.processing === "object"
          ? (existing.processing as Record<string, unknown>)
          : {};
      return {
        ...existing,
        processing: {
          status: "processing",
          jobId: job.id,
          attemptCount: job.attemptCount,
          startedAt: job.startedAt,
          updatedAt: nowIso(),
          jobKind: job.jobKind ?? "initial",
          requestedProvider: requestedOptions.provider,
          requestedModel: requestedOptions.model,
          requestedLanguage: requestedOptions.language,
          durationMs: recordingDurationMs,
          history: parseProcessingHistory(existingProcessing.history),
        },
      };
    });
    invalidateSessionIndexCache();
  });

  try {
    const transcriptionStartedAt = Date.now();
    const transcript = await transcribeRecording(job.mediaPath, requestedOptions);
    const providerLatencyMs = Date.now() - transcriptionStartedAt;
    const topics = extractTopics(transcript.text, 5);
    const keywords = extractKeywords(transcript.text, 10);
    const summary = buildSummary(transcript.text, topics);
    const generatedAt = nowIso();

    job.status = "done";
    job.updatedAt = nowIso();
    job.completedAt = nowIso();
    job.failedAt = undefined;
    job.errorMessage = undefined;
    job.requestedProvider = requestedOptions.provider;
    job.requestedModel = requestedOptions.model;
    job.requestedLanguage = requestedOptions.language;
    job.jobKind = job.jobKind ?? "initial";
    job.transcriptProvider = transcript.provider;
    job.transcriptModel = transcript.model;
    job.transcriptLanguage = transcript.language;
    job.transcriptChars = transcript.text.length;
    job.providerLatencyMs = providerLatencyMs;
    job.summaryPreview = summary.slice(0, 240);
    const completedAttempt = buildProcessingAttemptSnapshot(job);

    await withSessionLock(job.sessionId, async () => {
      await writeFile(job.transcriptPath, `${transcript.text}\n`, "utf8");
      if (transcript.segments.length > 0) {
        await writeFile(
          job.transcriptSegmentsPath,
          JSON.stringify(
            createTranscriptSegmentsArtifact({
              generatedAt,
              provider: transcript.provider,
              model: transcript.model,
              language: transcript.language,
              segments: transcript.segments,
            }),
            null,
            2,
          ),
          "utf8",
        );
      } else {
        await rm(job.transcriptSegmentsPath, { force: true }).catch(() => undefined);
      }
      await writeFile(
        job.analysisPath,
        JSON.stringify(
          {
            generatedAt,
            sessionId: job.sessionId,
            provider: transcript.provider,
            model: transcript.model,
            language: transcript.language,
            summary,
            topics,
            keywords,
            transcriptChars: transcript.text.length,
            durationMs: recordingDurationMs,
            providerLatencyMs,
          },
          null,
          2,
        ),
        "utf8",
      );

      await updateSessionMetadata(job.metadataPath, (existing) => {
        const existingProcessing =
          existing.processing && typeof existing.processing === "object"
            ? (existing.processing as Record<string, unknown>)
            : {};
        return {
          ...existing,
          transcriptPath: job.transcriptPath,
          transcriptSegmentsPath:
            transcript.segments.length > 0 ? job.transcriptSegmentsPath : undefined,
          analysisPath: job.analysisPath,
          processing: {
            ...completedAttempt,
            history: mergeProcessingHistory(existingProcessing, completedAttempt),
          },
        };
      });
      invalidateSessionIndexCache();
    });

    logInfo("processing.job_done", {
      jobId: job.id,
      sessionId: job.sessionId,
      jobKind: job.jobKind,
      requestedProvider: requestedOptions.provider,
      requestedModel: requestedOptions.model,
      requestedLanguage: requestedOptions.language,
      provider: transcript.provider,
      model: transcript.model,
      language: transcript.language,
      transcriptChars: transcript.text.length,
      durationMs: recordingDurationMs,
      providerLatencyMs,
    });
  } catch (error) {
    job.status = "failed";
    job.updatedAt = nowIso();
    job.failedAt = nowIso();
    job.errorMessage = error instanceof Error ? error.message : String(error);
    job.requestedProvider = requestedOptions.provider;
    job.requestedModel = requestedOptions.model;
    job.requestedLanguage = requestedOptions.language;
    job.jobKind = job.jobKind ?? "initial";
    job.providerLatencyMs = undefined;
    const failedAttempt = buildProcessingAttemptSnapshot(job);

    await withSessionLock(job.sessionId, async () => {
      await updateSessionMetadata(job.metadataPath, (existing) => {
        const existingProcessing =
          existing.processing && typeof existing.processing === "object"
            ? (existing.processing as Record<string, unknown>)
            : {};
        return {
          ...existing,
          processing: {
            ...failedAttempt,
            history: mergeProcessingHistory(existingProcessing, failedAttempt),
          },
        };
      });
      invalidateSessionIndexCache();
    });

    logError("processing.job_failed", {
      jobId: job.id,
      sessionId: job.sessionId,
      jobKind: job.jobKind,
      requestedProvider: requestedOptions.provider,
      requestedModel: requestedOptions.model,
      requestedLanguage: requestedOptions.language,
      attemptCount: job.attemptCount,
      error: job.errorMessage,
      durationMs: recordingDurationMs,
    });
  }

  await writeProcessingJobsStore();
  publishJobsToRenderer();
}

async function runProcessingQueue(): Promise<void> {
  if (processingLoopPromise) {
    return processingLoopPromise;
  }

  processingLoopPromise = (async () => {
    await loadProcessingJobsStore();

    while (true) {
      const nextJob = processingJobs.find((job) => job.status === "queued");
      if (!nextJob) {
        break;
      }
      await runProcessingJob(nextJob);
    }
  })().finally(() => {
    processingLoopPromise = null;
  });

  return processingLoopPromise;
}

async function enqueueProcessingJob(params: {
  sessionId: string;
  mediaPath: string;
  metadataPath: string;
  title: string;
  jobKind?: TranscriptionJobKind;
  transcription?: Partial<TranscriptionRequestOptions>;
}): Promise<ProcessingJobRecord> {
  await loadProcessingJobsStore();

  const artifacts = computeArtifacts(params.mediaPath);
  const transcription = getEffectiveTranscriptionOptions(params.transcription);
  const job: ProcessingJobRecord = {
    id: randomUUID(),
    sessionId: params.sessionId,
    mediaPath: params.mediaPath,
    metadataPath: params.metadataPath,
    transcriptPath: artifacts.transcriptPath,
    transcriptSegmentsPath: artifacts.transcriptSegmentsPath,
    analysisPath: artifacts.analysisPath,
    title: params.title,
    status: "queued",
    attemptCount: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    jobKind: params.jobKind ?? "initial",
    requestedProvider: transcription.provider,
    requestedModel: transcription.model,
    requestedLanguage: transcription.language,
  };

  processingJobs.unshift(job);
  await writeProcessingJobsStore();
  publishJobsToRenderer();

  await updateSessionMetadata(params.metadataPath, (existing) => ({
    ...existing,
    processing: {
      status: "queued",
      jobId: job.id,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      jobKind: job.jobKind,
      requestedProvider: job.requestedProvider,
      requestedModel: job.requestedModel,
      requestedLanguage: job.requestedLanguage,
    },
  }));
  logInfo("processing.job_enqueued", {
    jobId: job.id,
    sessionId: job.sessionId,
    title: job.title,
    jobKind: job.jobKind,
    requestedProvider: job.requestedProvider,
    requestedModel: job.requestedModel,
    requestedLanguage: job.requestedLanguage,
  });

  void runProcessingQueue();
  return job;
}

async function retryProcessingJob(jobId: string): Promise<ProcessingJobView> {
  await loadProcessingJobsStore();
  const job = processingJobs.find((entry) => entry.id === jobId);
  if (!job) {
    throw new Error("Processing job not found");
  }
  if (job.status === "processing") {
    throw new Error("Cannot retry while job is already processing");
  }

  job.status = "queued";
  job.updatedAt = nowIso();
  job.errorMessage = undefined;
  job.failedAt = undefined;
  job.completedAt = undefined;

  await writeProcessingJobsStore();
  publishJobsToRenderer();
  logInfo("processing.job_requeued", {
    jobId: job.id,
    sessionId: job.sessionId,
    jobKind: job.jobKind,
    requestedProvider: job.requestedProvider,
    requestedModel: job.requestedModel,
    requestedLanguage: job.requestedLanguage,
    nextAttempt: job.attemptCount + 1,
  });
  void runProcessingQueue();
  return toJobView(job);
}

async function queueSessionRetranscription(
  sessionId: string,
  options?: Partial<TranscriptionRequestOptions>,
): Promise<ProcessingJobView> {
  const session = await findSessionById(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  await loadProcessingJobsStore();
  const blockingJob = processingJobs.find(
    (job) =>
      job.sessionId === sessionId && (job.status === "queued" || job.status === "processing"),
  );
  if (blockingJob) {
    throw new Error("A processing job is already queued or running for this session.");
  }

  const job = await enqueueProcessingJob({
    sessionId,
    mediaPath: session.mediaPath,
    metadataPath: session.metadataPath,
    title: session.title,
    jobKind: "retranscribe",
    transcription: options,
  });

  logInfo("processing.session_retranscribe_queued", {
    sessionId,
    jobId: job.id,
    requestedProvider: job.requestedProvider,
    requestedModel: job.requestedModel,
    requestedLanguage: job.requestedLanguage,
  });

  return toJobView(job);
}

async function listSessionsSummary(): Promise<SessionSummaryView[]> {
  const sessions = await loadSessionIndex();
  return sessions.map((session) => toSessionSummaryView(session));
}

async function searchSessions(
  query: string,
  mode: SessionSearchMode,
): Promise<SessionSearchResultView[]> {
  const trimmed = query.trim();
  const sessions = await loadSessionIndex();
  if (trimmed.length === 0) {
    return sessions.map((session) => toSearchResultView(session, 0, mode));
  }

  const rawTokens = toSearchTokens(trimmed);
  if (rawTokens.length === 0) {
    return [];
  }

  const queryTokens = mode === "semantic" || mode === "both" ? expandQueryTokens(rawTokens) : rawTokens;
  const queryFrequency = toTokenFrequency(queryTokens);

  const scored: Array<{
    session: SessionIndexEntry;
    score: number;
  }> = [];

  for (const session of sessions) {
    const kwScore = mode === "semantic" ? 0 : keywordScore(session, queryTokens);
    const semScore = mode === "keyword" ? 0 : semanticScore(session, queryFrequency) * 100;
    const score = kwScore + semScore;
    if (score > 0) {
      scored.push({
        session,
        score,
      });
    }
  }

  scored.sort((left, right) => {
    if (left.score === right.score) {
      return right.session.startedAt.localeCompare(left.session.startedAt);
    }
    return right.score - left.score;
  });

  return scored.map((entry) => toSearchResultView(entry.session, entry.score, mode));
}

async function getSessionDetail(sessionId: string): Promise<SessionDetailView> {
  const session = await findSessionById(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }
  return toSessionDetailView(session);
}

function normalizeTags(value: string[] | undefined): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .map((item) => item.trim())
    .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index)
    .slice(0, 24);
}

async function updateSessionDetail(
  sessionId: string,
  patch: SessionUpdatePatch,
): Promise<SessionDetailView> {
  return withSessionLock(sessionId, async () => {
    const existing = await findSessionById(sessionId);
    if (!existing) {
      throw new Error("Session not found");
    }

    const changedFields: string[] = [];

    const fallbackArtifacts = computeArtifacts(existing.mediaPath);
    const transcriptPath = existing.transcriptPath ?? fallbackArtifacts.transcriptPath;
    const transcriptSegmentsPath =
      existing.transcriptSegmentsPath ?? fallbackArtifacts.transcriptSegmentsPath;
    const analysisPath = existing.analysisPath ?? fallbackArtifacts.analysisPath;
    const existingTranscriptText = sanitizeTranscriptText(existing.transcriptText);
    let transcriptTextChanged = false;

    if (typeof patch.transcriptText === "string") {
      const cleanedTranscript = sanitizeTranscriptText(patch.transcriptText);
      transcriptTextChanged = cleanedTranscript !== existingTranscriptText;
      if (transcriptTextChanged) {
        await writeFile(transcriptPath, `${cleanedTranscript}\n`, "utf8");
        await rm(transcriptSegmentsPath, { force: true }).catch(() => undefined);
        changedFields.push("transcriptText");
      }
    }

    if (
      typeof patch.summary === "string" ||
      Array.isArray(patch.topics) ||
      Array.isArray(patch.keywords)
    ) {
      let analysisObject: Record<string, unknown> = {};
      if (existsSync(analysisPath)) {
        analysisObject = safeReadJsonObject(await readFile(analysisPath, "utf8"));
      }

      const nextSummary =
        typeof patch.summary === "string" ? patch.summary.trim() : parseString(analysisObject.summary, existing.summary);
      const nextTopics = normalizeTags(patch.topics) ?? parseStringArray(analysisObject.topics);
      const nextKeywords = normalizeTags(patch.keywords) ?? parseStringArray(analysisObject.keywords);

      const updatedAnalysis = {
        ...analysisObject,
        generatedAt: parseString(analysisObject.generatedAt, nowIso()),
        editedAt: nowIso(),
        sessionId,
        summary: nextSummary,
        topics: nextTopics,
        keywords: nextKeywords,
      };
      await writeFile(analysisPath, JSON.stringify(updatedAnalysis, null, 2), "utf8");
      if (typeof patch.summary === "string") {
        changedFields.push("summary");
      }
      if (Array.isArray(patch.topics)) {
        changedFields.push("topics");
      }
      if (Array.isArray(patch.keywords)) {
        changedFields.push("keywords");
      }
    }

    await updateSessionMetadata(existing.metadataPath, (metadata) => {
      const nextMetadata = {
        ...metadata,
        updatedAt: nowIso(),
        editedAt: nowIso(),
      } as Record<string, unknown>;

      if (typeof patch.title === "string") {
        nextMetadata.title = sanitizeSessionTitle(patch.title, existing.title);
        changedFields.push("title");
      }
      if (transcriptTextChanged) {
        nextMetadata.transcriptPath = transcriptPath;
        delete nextMetadata.transcriptSegmentsPath;
      }
      if (
        typeof patch.summary === "string" ||
        Array.isArray(patch.topics) ||
        Array.isArray(patch.keywords)
      ) {
        nextMetadata.analysisPath = analysisPath;
      }

      const processing =
        nextMetadata.processing && typeof nextMetadata.processing === "object"
          ? (nextMetadata.processing as Record<string, unknown>)
          : {};
      nextMetadata.processing = {
        ...processing,
        status: parseString(processing.status, "done"),
        updatedAt: nowIso(),
      };
      return nextMetadata;
    });

    invalidateSessionIndexCache();

    if (changedFields.length > 0) {
      logInfo("session.detail_updated", {
        sessionId,
        fields: [...new Set(changedFields)],
      });
    }

    return getSessionDetail(sessionId);
  });
}

async function exportSession(
  sessionId: string,
  format: SessionExportFormat,
): Promise<{ exportPath: string }> {
  const detail = await getSessionDetail(sessionId);
  const storageDir = await getResolvedStorageDir();
  const exportDir = path.join(storageDir, DEFAULT_EXPORT_DIRECTORY);
  await mkdir(exportDir, { recursive: true });

  const exportTimestamp = formatExportTimestamp(detail.startedAt || detail.updatedAt);
  const safeTitle = sanitizeFileComponent(detail.title || detail.id);
  const stem = `${exportTimestamp}_${safeTitle}`;
  const extension = format === "md" ? "md" : format === "txt" ? "txt" : "json";
  const exportPath = getDisambiguatedPathIfNeeded(path.join(exportDir, `${stem}.${extension}`));

  if (format === "md") {
    await writeFile(exportPath, buildMarkdownExport(detail), "utf8");
  } else if (format === "txt") {
    await writeFile(exportPath, buildTextExport(detail), "utf8");
  } else {
    await writeFile(
      exportPath,
      JSON.stringify(
        {
          exportedAt: nowIso(),
          session: detail,
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  logInfo("session.exported", {
    sessionId,
    format,
    exportPath,
  });

  return {
    exportPath,
  };
}

async function openSessionMedia(sessionId: string): Promise<{ opened: true; mediaPath: string }> {
  const detail = await getSessionDetail(sessionId);
  if (!existsSync(detail.mediaPath)) {
    throw new Error("Session recording file was not found.");
  }

  const errorMessage = await shell.openPath(detail.mediaPath);
  if (errorMessage) {
    throw new Error(`Failed to open recording: ${errorMessage}`);
  }

  logInfo("session.media_opened", {
    sessionId,
    mediaPath: detail.mediaPath,
  });

  return {
    opened: true,
    mediaPath: detail.mediaPath,
  };
}

async function getSessionMediaPlayback(
  sessionId: string,
): Promise<{ mediaPath: string; mediaUrl: string }> {
  const detail = await getSessionDetail(sessionId);
  if (!existsSync(detail.mediaPath)) {
    throw new Error("Session recording file was not found.");
  }

  const mediaUrl = pathToFileURL(detail.mediaPath).toString();
  return {
    mediaPath: detail.mediaPath,
    mediaUrl,
  };
}

async function deleteSession(
  sessionId: string,
): Promise<{ deleted: true; removedPaths: string[]; removedJobs: number }> {
  const detail = await getSessionDetail(sessionId);
  await loadProcessingJobsStore();

  const activeJob = processingJobs.find(
    (job) => job.sessionId === sessionId && job.status === "processing",
  );
  if (activeJob) {
    throw new Error("Cannot delete a session while processing is in progress.");
  }

  const removedJobs = processingJobs.filter((job) => job.sessionId === sessionId).length;
  if (removedJobs > 0) {
    processingJobs = processingJobs.filter((job) => job.sessionId !== sessionId);
    await writeProcessingJobsStore();
    publishJobsToRenderer();
  }

  const storageDir = await getResolvedStorageDir();
  const fallbackArtifacts = computeArtifacts(detail.mediaPath);
  const candidatePaths = new Set<string>([
    detail.mediaPath,
    detail.metadataPath,
    detail.transcriptPath ?? fallbackArtifacts.transcriptPath,
    detail.transcriptSegmentsPath ?? fallbackArtifacts.transcriptSegmentsPath,
    detail.analysisPath ?? fallbackArtifacts.analysisPath,
  ]);

  const removedPaths: string[] = [];
  for (const candidatePath of candidatePaths) {
    if (!candidatePath) {
      continue;
    }
    const resolvedPath = path.resolve(candidatePath);
    if (!isPathInside(storageDir, resolvedPath)) {
      continue;
    }
    if (!existsSync(resolvedPath)) {
      continue;
    }
    await rm(resolvedPath, { force: true });
    removedPaths.push(resolvedPath);
  }

  invalidateSessionIndexCache();

  logInfo("session.deleted", {
    sessionId,
    removedJobs,
    removedPaths,
  });

  return {
    deleted: true,
    removedPaths,
    removedJobs,
  };
}

async function updateSettingsPatch(patch: Partial<AppSettings>): Promise<EffectiveSettings> {
  const existingRaw = await readSettings();
  const merged: AppSettings = {
    ...existingRaw,
  };

  if (typeof patch.storageDir === "string") {
    merged.storageDir = patch.storageDir;
  }
  if (typeof patch.autoRecordEnabled === "boolean") {
    merged.autoRecordEnabled = patch.autoRecordEnabled;
  }
  if (typeof patch.aiProcessingEnabled === "boolean") {
    merged.aiProcessingEnabled = patch.aiProcessingEnabled;
  }
  if (typeof patch.inactivityTimeoutMinutes === "number") {
    merged.inactivityTimeoutMinutes = patch.inactivityTimeoutMinutes;
  }
  if (patch.hotkeys && typeof patch.hotkeys === "object") {
    merged.hotkeys = {
      ...(existingRaw.hotkeys ?? {}),
      ...patch.hotkeys,
    };
  }
  if (patch.transcriptionDefaults && typeof patch.transcriptionDefaults === "object") {
    merged.transcriptionDefaults = {
      ...(existingRaw.transcriptionDefaults ?? {}),
      ...patch.transcriptionDefaults,
    };
  }
  if (patch.transcriptionSetup && typeof patch.transcriptionSetup === "object") {
    const nextSetup: Partial<TranscriptionSetupState> = {
      ...(existingRaw.transcriptionSetup ?? {}),
      ...patch.transcriptionSetup,
    };
    const status = parseTranscriptionSetupStatus(nextSetup.status) ?? "pending";
    nextSetup.status = status;
    if (status === "completed") {
      nextSetup.completedAt = sanitizeIsoDateTime(nextSetup.completedAt) ?? nowIso();
      nextSetup.dismissedAt = undefined;
    } else if (status === "dismissed") {
      nextSetup.dismissedAt = sanitizeIsoDateTime(nextSetup.dismissedAt) ?? nowIso();
      nextSetup.completedAt = undefined;
    } else {
      nextSetup.completedAt = undefined;
      nextSetup.dismissedAt = undefined;
    }
    merged.transcriptionSetup = nextSetup;
  }

  const effective = await resolveUsableEffectiveSettings(getEffectiveSettings(merged), {
    allowLegacyDarwinFallback: typeof patch.storageDir !== "string",
  });

  if (patch.hotkeys) {
    registerGlobalHotkeys(effective.hotkeys);
  }

  await persistEffectiveSettings(effective);
  logInfo("settings.updated", {
    storageDir: effective.storageDir,
    autoRecordEnabled: effective.autoRecordEnabled,
    aiProcessingEnabled: effective.aiProcessingEnabled,
    inactivityTimeoutMinutes: effective.inactivityTimeoutMinutes,
    hotkeysUpdated: Boolean(patch.hotkeys),
    transcriptionDefaultsUpdated: Boolean(patch.transcriptionDefaults),
    transcriptionSetupUpdated: Boolean(patch.transcriptionSetup),
    aiProcessingUpdated: typeof patch.aiProcessingEnabled === "boolean",
    storageDirUpdated: typeof patch.storageDir === "string",
  });
  return effective;
}

function remapStorageRoot(candidatePath: string, oldStorageDir: string, nextStorageDir: string): string {
  const resolvedCandidate = path.resolve(candidatePath);
  if (!isPathInside(oldStorageDir, resolvedCandidate)) {
    return candidatePath;
  }
  return path.join(nextStorageDir, path.relative(oldStorageDir, resolvedCandidate));
}

async function rewriteMovedLibraryMetadataPaths(
  storageDir: string,
  previousStorageDir: string,
  nextStorageDir: string,
): Promise<void> {
  const entries = await readdir(storageDir, { withFileTypes: true });
  const metadataFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(".json"))
    .filter((name) => !name.endsWith(".analysis.json"))
    .filter((name) => !name.endsWith(TRANSCRIPT_SEGMENTS_FILENAME_SUFFIX))
    .filter((name) => name !== "library.json");

  for (const metadataFilename of metadataFiles) {
    const metadataPath = path.join(storageDir, metadataFilename);
    const metadataObject = safeReadJsonObject(await readFile(metadataPath, "utf8"));
    let changed = false;

    for (const key of ["transcriptPath", "transcriptSegmentsPath", "analysisPath"]) {
      const value = parseString(metadataObject[key]);
      if (value.length === 0) {
        continue;
      }
      const remapped = remapStorageRoot(value, previousStorageDir, nextStorageDir);
      if (remapped !== value) {
        metadataObject[key] = remapped;
        changed = true;
      }
    }

    if (changed) {
      await writeFile(metadataPath, JSON.stringify(metadataObject, null, 2), "utf8");
    }
  }
}

async function updateProcessingJobsForStorageChange(
  previousStorageDir: string,
  nextStorageDir: string,
  mode: "move" | "empty",
): Promise<void> {
  await loadProcessingJobsStore();

  if (mode === "move") {
    processingJobs = processingJobs.map((job) => ({
      ...job,
      mediaPath: remapStorageRoot(job.mediaPath, previousStorageDir, nextStorageDir),
      metadataPath: remapStorageRoot(job.metadataPath, previousStorageDir, nextStorageDir),
      transcriptPath: remapStorageRoot(job.transcriptPath, previousStorageDir, nextStorageDir),
      transcriptSegmentsPath: remapStorageRoot(
        job.transcriptSegmentsPath,
        previousStorageDir,
        nextStorageDir,
      ),
      analysisPath: remapStorageRoot(job.analysisPath, previousStorageDir, nextStorageDir),
    }));
  } else {
    processingJobs = processingJobs.filter(
      (job) =>
        !isPathInside(previousStorageDir, job.mediaPath) &&
        !isPathInside(previousStorageDir, job.metadataPath),
    );
  }

  await writeProcessingJobsStore();
  publishJobsToRenderer();
}

async function migrateLibraryStorage(params: {
  nextStorageDir: string;
  mode: "move" | "empty";
}): Promise<{
  storageDir: string;
  previousStorageDir: string;
  mode: "move" | "empty";
  copiedEntries: number;
  verification: {
    expectedFiles: number;
    verifiedFiles: number;
  };
}> {
  const previousStorageDir = await getResolvedStorageDir();
  const nextStorageDir = params.nextStorageDir.trim();
  if (nextStorageDir.length === 0) {
    throw new Error("Storage directory cannot be empty.");
  }

  if (path.resolve(previousStorageDir) === path.resolve(nextStorageDir)) {
    const updatedSettings = await updateSettingsPatch({ storageDir: nextStorageDir });
    invalidateSessionIndexCache();
    return {
      storageDir: updatedSettings.storageDir,
      previousStorageDir,
      mode: params.mode,
      copiedEntries: 0,
      verification: {
        expectedFiles: 0,
        verifiedFiles: 0,
      },
    };
  }

  if (!(await isDirectoryEmpty(nextStorageDir))) {
    throw new Error("Choose an empty directory for the active library.");
  }

  let copiedEntries = 0;
  let verification = {
    expectedFiles: 0,
    verifiedFiles: 0,
  };

  if (params.mode === "move") {
    const copyResult = await copyLibraryContents(previousStorageDir, nextStorageDir);
    copiedEntries = copyResult.copiedEntries;
    const copyVerification = await verifyLibraryCopy(previousStorageDir, nextStorageDir);
    if (copyVerification.mismatchedFiles.length > 0) {
      throw new Error(
        `Library verification failed for ${copyVerification.mismatchedFiles.length} file(s).`,
      );
    }
    verification = {
      expectedFiles: copyVerification.expectedFiles,
      verifiedFiles: copyVerification.verifiedFiles,
    };
    await rewriteMovedLibraryMetadataPaths(nextStorageDir, previousStorageDir, nextStorageDir);
  } else {
    await mkdir(nextStorageDir, { recursive: true });
  }

  await ensureLibraryManifest(nextStorageDir);
  await updateProcessingJobsForStorageChange(previousStorageDir, nextStorageDir, params.mode);

  const updatedSettings = await updateSettingsPatch({
    storageDir: nextStorageDir,
  });
  invalidateSessionIndexCache();
  logInfo("storage.library_changed", {
    previousStorageDir,
    nextStorageDir: updatedSettings.storageDir,
    mode: params.mode,
    copiedEntries,
    verification,
  });

  return {
    storageDir: updatedSettings.storageDir,
    previousStorageDir,
    mode: params.mode,
    copiedEntries,
    verification,
  };
}

async function cleanupInactiveLibrary(storageDir: string): Promise<{ removed: true }> {
  const activeStorageDir = await getResolvedStorageDir();
  if (path.resolve(storageDir) === path.resolve(activeStorageDir)) {
    throw new Error("Cannot remove the active library.");
  }
  await cleanupLibraryDirectory(storageDir);
  logInfo("storage.library_cleanup", {
    storageDir,
  });
  return { removed: true };
}

async function cleanupStaleTempDirs(): Promise<void> {
  const tmpDir = os.tmpdir();
  try {
    const entries = await readdir(tmpDir, { withFileTypes: true });
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("coview-transcribe-")) {
        continue;
      }
      const dirPath = path.join(tmpDir, entry.name);
      try {
        const dirStat = await stat(dirPath);
        if (dirStat.mtimeMs < oneHourAgo) {
          await rm(dirPath, { recursive: true, force: true });
          logInfo("cleanup.stale_temp_dir", { path: dirPath });
        }
      } catch {
        // Ignore individual dir errors
      }
    }
  } catch {
    // Ignore if tmpdir is unreadable
  }
}

async function recoverInProgressRecordings(storageDir: string): Promise<void> {
  const sessions = await listRecoverableRecordingSessions(storageDir);
  if (sessions.length === 0) {
    return;
  }

  logInfo("recording.recovery_scan_started", {
    storageDir,
    candidateCount: sessions.length,
  });

  for (const session of sessions) {
    if (session.manifest?.state === "cancelled") {
      await discardInProgressRecordingSession(storageDir, session.id).catch(() => undefined);
      continue;
    }

    try {
      await completeRecordingSession({
        recordingSessionId: session.id,
        storageDir,
        mimeType: session.manifest?.mimeType ?? getMimeTypeForFile(session.mediaFilename ?? ""),
        recovered: true,
        metadata: {
          ...session.metadata,
          startedAt: session.startedAt,
          endedAt: session.updatedAt,
          stopReason: parseString(session.metadata.stopReason, "recovered-after-crash"),
        },
      });
    } catch (error) {
      logError("recording.recovery_failed", {
        recordingSessionId: session.id,
        storageDir,
        error,
      });
    }
  }

  logInfo("recording.recovery_scan_complete", {
    storageDir,
    candidateCount: sessions.length,
  });
}

async function bootstrap(): Promise<void> {
  logInfo("app.bootstrap_start", {
    platform: process.platform,
    release: os.release(),
    node: process.versions.node,
    electron: process.versions.electron,
  });

  if (process.platform === "darwin") {
    const appIcon = loadAppIconAsset("coview_512.png");
    if (appIcon) {
      app.dock?.setIcon(appIcon);
    }
    app.dock?.hide();
  }

  registerMainIpcHandlers({
    screenSettingsUrl: SCREEN_SETTINGS_URL,
    getMainWindow: () => mainWindow,
    getPermissionStatus,
    getEffectiveSettings: async () => {
      return getUsableEffectiveSettings({ allowLegacyDarwinFallback: true });
    },
    updateSettingsPatch: async (patch) => updateSettingsPatch(patch),
    getTelemetryFilePath,
    getTelemetryDirPath,
    clampTelemetryTailLines,
    readTelemetryTail,
    logError,
    logWarn,
    logInfo,
    getSlackActivitySignal,
    loadProcessingJobsStore,
    listJobsForRenderer,
    retryProcessingJob,
    getTranscriptionDiagnostics,
    listWhisperModels,
    installWhisperModel,
    activateWhisperModel,
    activateCustomWhisperModel,
    removeWhisperModel,
    chooseTranscriptionModelFile,
    runTranscriptionTest,
    listSessionsSummary,
    searchSessions,
    getSessionDetail,
    updateSessionDetail,
    queueSessionRetranscription,
    exportSession,
    openSessionMedia,
    getSessionMediaPlayback,
    deleteSession,
    getResolvedStorageDir,
    invalidateSessionIndexCache,
    migrateLibraryStorage,
    cleanupInactiveLibrary,
    beginRecordingSession,
    appendRecordingSessionChunk,
    completeRecordingSession,
    cancelRecordingSession,
  });
  await createMainWindow();
  createTray();
  void cleanupStaleTempDirs();

  const settings = getEffectiveSettings(await readSettings());
  await persistEffectiveSettings(settings);
  registerGlobalHotkeys(settings.hotkeys);
  await loadProcessingJobsStore();
  const storageDir = await getResolvedStorageDir();
  await recoverInProgressRecordings(storageDir);
  showMainWindow();
  publishJobsToRenderer();
  void runProcessingQueue();
  logInfo("app.bootstrap_complete");
}

if (!hasSingleInstanceLock) {
  logWarn("app.single_instance_lock_denied");
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
    logInfo("app.second_instance");
  });

  app.on("before-quit", () => {
    isQuitting = true;
    logInfo("app.before_quit");
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    logInfo("app.will_quit");
    void flushTelemetryWrites();
  });

  app.whenReady().then(() => {
    logInfo("app.ready");
    void bootstrap().catch((error) => {
      logError("app.bootstrap_failed", { error });
    });
  });

  app.on("activate", () => {
    showMainWindow();
    logInfo("app.activate");
  });
}

process.on("unhandledRejection", (reason) => {
  logError("process.unhandled_rejection", { reason });
});

process.on("uncaughtException", (error) => {
  logError("process.uncaught_exception", { error });
});
