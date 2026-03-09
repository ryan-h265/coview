export type CaptureSourceType = "screen" | "window";
export type AudioMode = "system" | "mic" | "both";
export type HotkeyAction = "start-stop" | "pause-resume" | "auto-toggle";
export type ProcessingStatus = "queued" | "processing" | "done" | "failed";
export type SaveProcessingStatus = ProcessingStatus | "disabled" | "dropped";
export type SessionSearchMode = "keyword" | "semantic" | "both";
export type SessionExportFormat = "md" | "txt" | "json";
export type TranscriptionProvider = "auto" | "local-whisper-cli" | "local-whisper-python";
export type TranscriptionJobKind = "initial" | "retranscribe";
export type TranscriptionSetupStatus = "pending" | "dismissed" | "completed";
export type CommandSource = "bundled" | "system";

export interface PermissionStatusPayload {
  microphone: string;
  screen: string;
  platform: string;
}

export interface CaptureSourcePayload {
  id: string;
  name: string;
}

export interface TranscriptionSetupStatePayload {
  status: TranscriptionSetupStatus;
  completedAt?: string;
  dismissedAt?: string;
  modelPath?: string;
  modelId?: string;
}

export interface RecordingSessionMetadataPayload {
  title?: string;
  sourceName?: string;
  startedAt?: string;
  endedAt?: string;
  screenMode?: CaptureSourceType;
  audioMode?: AudioMode;
  autoTriggered?: boolean;
  stopReason?: string;
}

export interface TranscriptionRequestOptionsPayload {
  provider?: TranscriptionProvider;
  model?: string;
  language?: string;
}

export interface SettingsPayload {
  storageDir: string;
  autoRecordEnabled: boolean;
  aiProcessingEnabled: boolean;
  inactivityTimeoutMinutes: number;
  hotkeys: {
    startStop: string;
    pauseResume: string;
    autoToggle: string;
  };
  transcriptionDefaults: {
    provider: TranscriptionProvider;
    model?: string;
    language: string;
  };
  transcriptionSetup: TranscriptionSetupStatePayload;
}

export interface SettingsUpdatePayload {
  storageDir?: string;
  autoRecordEnabled?: boolean;
  aiProcessingEnabled?: boolean;
  inactivityTimeoutMinutes?: number;
  hotkeys?: Partial<SettingsPayload["hotkeys"]>;
  transcriptionDefaults?: Partial<SettingsPayload["transcriptionDefaults"]>;
  transcriptionSetup?: Partial<SettingsPayload["transcriptionSetup"]>;
}

export interface SlackActivitySignalPayload {
  isRunning: boolean;
  callHintActive: boolean;
  callHints: string[];
  windowTitles: string[];
  checkedAt: string;
}

export interface ProcessingJobPayload {
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

export interface TranscriptionDiagnosticsPayload {
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

export interface TranscriptionTestResultPayload {
  sessionId: string;
  provider: string;
  model: string;
  language: string;
  transcriptChars: number;
  previewText: string;
  elapsedMs: number;
  testedAt: string;
}

export interface WhisperModelPayload {
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

export interface WhisperModelLibraryPayload {
  runtimeAvailable: boolean;
  runtimeSource?: CommandSource;
  managedModelDirectory: string;
  configuredModelPath?: string;
  aiProcessingEnabled: boolean;
  setupStatus: TranscriptionSetupStatus;
  models: WhisperModelPayload[];
  customModel?: {
    path: string;
    exists: boolean;
    active: boolean;
  };
}

export interface WhisperModelDownloadProgressPayload {
  modelId: string;
  status: "downloading" | "completed" | "failed";
  downloadedBytes: number;
  totalBytes?: number;
  message?: string;
}

export interface DownloadTranscriptionModelPayload {
  modelId?: string;
}

export interface DownloadTranscriptionModelResult {
  modelId: string;
  displayName: string;
  description: string;
  modelPath: string;
  alreadyExisted: boolean;
  settings: SettingsPayload;
}

export interface ActivateTranscriptionModelPayload {
  modelId: string;
}

export interface ActivateCustomTranscriptionModelPayload {
  modelPath: string;
}

export interface RemoveTranscriptionModelPayload {
  modelId: string;
}

export interface RemoveTranscriptionModelResult {
  removed: true;
  settings: SettingsPayload;
}

export interface SessionSummaryPayload {
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

export interface SessionSearchResultPayload extends SessionSummaryPayload {
  score: number;
  matchType: SessionSearchMode;
}

export interface TranscriptSegmentPayload {
  startMs: number;
  endMs: number;
  text: string;
}

export interface SessionDetailPayload extends SessionSummaryPayload {
  mediaPath: string;
  metadataPath: string;
  transcriptPath?: string;
  transcriptSegmentsPath?: string;
  analysisPath?: string;
  transcriptSegments: TranscriptSegmentPayload[];
  transcriptText: string;
  screenMode?: CaptureSourceType;
  audioMode?: AudioMode;
  autoTriggered?: boolean;
  stopReason?: string;
  transcriptProvider?: string;
  transcriptModel?: string;
  transcriptLanguage?: string;
}

export interface SessionSearchPayload {
  query: string;
  mode?: SessionSearchMode;
}

export interface SessionUpdatePatchPayload {
  title?: string;
  transcriptText?: string;
  summary?: string;
  topics?: string[];
  keywords?: string[];
}

export interface SessionUpdatePayload {
  sessionId: string;
  patch: SessionUpdatePatchPayload;
}

export interface SessionTranscriptionPayload {
  sessionId: string;
  options?: TranscriptionRequestOptionsPayload;
}

export interface SessionExportPayload {
  sessionId: string;
  format: SessionExportFormat;
}

export interface SessionExportResult {
  exportPath: string;
}

export interface SessionMediaPlaybackPayload {
  mediaPath: string;
  mediaUrl: string;
}

export interface OpenSessionMediaResultPayload {
  opened: true;
  mediaPath: string;
}

export interface DeleteSessionResultPayload {
  deleted: true;
  removedPaths: string[];
  removedJobs: number;
}

export interface StorageMigrationPayload {
  nextStorageDir: string;
  mode: "move" | "empty";
}

export interface StorageMigrationResultPayload {
  storageDir: string;
  previousStorageDir: string;
  mode: "move" | "empty";
  copiedEntries: number;
  verification: {
    expectedFiles: number;
    verifiedFiles: number;
  };
}

export interface BeginRecordingSessionPayload {
  mimeType: string;
  metadata?: RecordingSessionMetadataPayload;
}

export interface BeginRecordingSessionResult {
  recordingSessionId: string;
}

export interface AppendRecordingChunkPayload {
  recordingSessionId: string;
  data: ArrayBuffer;
}

export interface AppendRecordingChunkResult {
  bytesWritten: number;
  chunkCount: number;
}

export interface FinishRecordingSessionPayload {
  recordingSessionId: string;
  mimeType: string;
  metadata: RecordingSessionMetadataPayload;
}

export interface FinishRecordingSessionResult {
  mediaPath: string | null;
  metadataPath: string | null;
  bytesWritten: number;
  processingJobId: string | null;
  processingStatus: SaveProcessingStatus;
  droppedEmpty: boolean;
}

export interface CancelRecordingSessionResultPayload {
  cancelled: true;
}

export interface DeleteLibraryResultPayload {
  removed: true;
}

export const IPC_CHANNELS = {
  hotkeyAction: "hotkey:action",
  permissions: {
    getStatus: "permissions:get-status",
    requestMicrophone: "permissions:request-microphone",
    openScreenSettings: "permissions:open-screen-settings",
  },
  capture: {
    listSources: "capture:list-sources",
  },
  settings: {
    get: "settings:get",
    update: "settings:update",
  },
  telemetry: {
    getLogPath: "telemetry:get-log-path",
    getLogTail: "telemetry:get-log-tail",
    openLogDir: "telemetry:open-log-dir",
  },
  slack: {
    getActivitySignal: "slack:get-activity-signal",
  },
  processing: {
    listJobs: "processing:list-jobs",
    retryJob: "processing:retry-job",
    jobsUpdated: "processing:jobs-updated",
  },
  transcription: {
    getDiagnostics: "transcription:get-diagnostics",
    listModels: "transcription:list-models",
    downloadModel: "transcription:download-model",
    chooseModelFile: "transcription:choose-model-file",
    activateModel: "transcription:activate-model",
    activateCustomModel: "transcription:activate-custom-model",
    removeModel: "transcription:remove-model",
    modelDownloadProgress: "transcription:model-download-progress",
    testSession: "transcription:test-session",
  },
  sessions: {
    list: "sessions:list",
    search: "sessions:search",
    getDetail: "sessions:get-detail",
    updateDetail: "sessions:update-detail",
    retranscribe: "sessions:retranscribe",
    export: "sessions:export",
    openMedia: "sessions:open-media",
    getMediaPlayback: "sessions:get-media-playback",
    delete: "sessions:delete",
  },
  storage: {
    getDir: "storage:get-dir",
    setDir: "storage:set-dir",
    chooseDir: "storage:choose-dir",
    migrateLibrary: "storage:migrate-library",
    cleanupLibrary: "storage:cleanup-library",
  },
  recording: {
    beginSession: "recording:begin-session",
    appendChunk: "recording:append-chunk",
    finishSession: "recording:finish-session",
    cancelSession: "recording:cancel-session",
  },
} as const;

export interface CoviewApi {
  getPermissionStatus: () => Promise<PermissionStatusPayload>;
  requestMicrophonePermission: () => Promise<boolean | "probe-renderer">;
  openScreenPermissionSettings: () => Promise<boolean>;
  listCaptureSources: (sourceType: CaptureSourceType) => Promise<CaptureSourcePayload[]>;
  getSettings: () => Promise<SettingsPayload>;
  updateSettings: (patch: SettingsUpdatePayload) => Promise<SettingsPayload>;
  getTelemetryLogPath: () => Promise<string>;
  getTelemetryLogTail: (maxLines?: number) => Promise<string[]>;
  openTelemetryLogDir: () => Promise<boolean>;
  getSlackActivitySignal: () => Promise<SlackActivitySignalPayload>;
  onHotkeyAction: (callback: (action: HotkeyAction) => void) => () => void;
  listProcessingJobs: () => Promise<ProcessingJobPayload[]>;
  retryProcessingJob: (jobId: string) => Promise<ProcessingJobPayload>;
  getTranscriptionDiagnostics: () => Promise<TranscriptionDiagnosticsPayload>;
  listTranscriptionModels: () => Promise<WhisperModelLibraryPayload>;
  downloadRecommendedTranscriptionModel: (
    payload?: DownloadTranscriptionModelPayload,
  ) => Promise<DownloadTranscriptionModelResult>;
  chooseTranscriptionModelFile: () => Promise<string | null>;
  activateTranscriptionModel: (payload: ActivateTranscriptionModelPayload) => Promise<SettingsPayload>;
  activateCustomTranscriptionModel: (
    payload: ActivateCustomTranscriptionModelPayload,
  ) => Promise<SettingsPayload>;
  removeTranscriptionModel: (
    payload: RemoveTranscriptionModelPayload,
  ) => Promise<RemoveTranscriptionModelResult>;
  onTranscriptionModelDownloadProgress: (
    callback: (progress: WhisperModelDownloadProgressPayload) => void,
  ) => () => void;
  testSessionTranscription: (
    payload: SessionTranscriptionPayload,
  ) => Promise<TranscriptionTestResultPayload>;
  onProcessingJobsUpdated: (callback: (jobs: ProcessingJobPayload[]) => void) => () => void;
  listSessions: () => Promise<SessionSummaryPayload[]>;
  searchSessions: (payload: SessionSearchPayload) => Promise<SessionSearchResultPayload[]>;
  getSessionDetail: (sessionId: string) => Promise<SessionDetailPayload | null>;
  updateSessionDetail: (payload: SessionUpdatePayload) => Promise<SessionDetailPayload>;
  retranscribeSession: (payload: SessionTranscriptionPayload) => Promise<ProcessingJobPayload>;
  exportSession: (payload: SessionExportPayload) => Promise<SessionExportResult>;
  openSessionMedia: (sessionId: string) => Promise<OpenSessionMediaResultPayload>;
  getSessionMediaPlayback: (sessionId: string) => Promise<SessionMediaPlaybackPayload>;
  deleteSession: (sessionId: string) => Promise<DeleteSessionResultPayload>;
  getStorageDir: () => Promise<string>;
  setStorageDir: (storageDir: string) => Promise<string>;
  chooseStorageDir: () => Promise<string | null>;
  migrateLibraryStorage: (
    payload: StorageMigrationPayload,
  ) => Promise<StorageMigrationResultPayload>;
  cleanupLibraryStorage: (storageDir: string) => Promise<DeleteLibraryResultPayload>;
  beginRecordingSession: (
    payload: BeginRecordingSessionPayload,
  ) => Promise<BeginRecordingSessionResult>;
  appendRecordingChunk: (
    payload: AppendRecordingChunkPayload,
  ) => Promise<AppendRecordingChunkResult>;
  finishRecordingSession: (
    payload: FinishRecordingSessionPayload,
  ) => Promise<FinishRecordingSessionResult>;
  cancelRecordingSession: (
    recordingSessionId: string,
  ) => Promise<CancelRecordingSessionResultPayload>;
}
