import {
  computeThumbnailCaptureTimes,
  escapeHtml,
  formatByteCount,
  formatCompactDateTime,
  formatConfiguredModelLabel,
  formatDateTime,
  formatDurationMs,
  formatSearchModeLabel,
  formatTelemetryLine,
  getAudioLevelPercent,
  getSessionDurationMs,
  parseTagInput,
  toAudioModeLabel,
  toDiagnosticsStatusClass,
  toDiagnosticsStatusLabel,
  truncateText,
} from "./rendererUtils.js";
import { bootstrapRenderer } from "./rendererBootstrap.js";

const AUTO_POLL_INTERVAL_MS = 5000;
const AUTO_SAMPLE_INTERVAL_MS = 200;
const AUTO_PROBE_DURATION_MS = 4500;
const AUTO_SUSTAINED_AUDIO_MS = 2800;
const AUTO_AUDIO_THRESHOLD = 0.015;
const AUTO_STOP_SILENCE_MS = 20000;
const MANUAL_STOP_COOLDOWN_MS = 30000;
const MAX_RECORDING_DURATION_MS = 4 * 60 * 60 * 1000;

function getById(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: ${id}`);
  }
  return element;
}

const sourceTypeSelect = getById("source-type");
const sourceSelect = getById("source-id");
const audioModeSelect = getById("audio-mode");
const titleInput = getById("title");
const startButton = getById("start-recording");
const stopButton = getById("stop-recording");
const pauseButton = getById("pause-recording");
const permissionStatus = getById("permission-status");
const refreshPermissionsButton = getById("refresh-permissions");
const requestMicrophoneButton = getById("request-microphone");
const openScreenSettingsButton = getById("open-screen-settings");
const chooseStorageButton = getById("choose-storage");
const storagePath = getById("storage-path");
const activityLog = getById("activity-log");
const transportRecordingState = getById("transport-recording-state");
const transportSourceSummary = getById("transport-source-summary");
const transportElapsed = getById("transport-elapsed");
const transportLevelFill = getById("transport-level-fill");
const transportLevelText = getById("transport-level-text");
const transportAutomation = getById("transport-automation");
const toggleAutoButton = getById("toggle-auto");
const autoState = getById("auto-state");
const slackSignal = getById("slack-signal");
const inactivityTimeout = getById("inactivity-timeout");
const inactivityTimeoutInput = getById("inactivity-timeout-input");
const aiProcessingEnabledCheckbox = getById("ai-processing-enabled");
const settingsTranscriptionProviderSelect = getById("settings-transcription-provider");
const settingsTranscriptionLanguageModeSelect = getById("settings-transcription-language-mode");
const settingsTranscriptionLanguageCustomInput = getById("settings-transcription-language-custom");
const settingsTranscriptionModelInput = getById("settings-transcription-model");
const transcriptionSetupSummary = getById("transcription-setup-summary");
const openTranscriptionSetupButton = getById("open-transcription-setup");
const saveTranscriptionDefaultsButton = getById("save-transcription-defaults");
const saveTimeoutButton = getById("save-timeout");
const saveHotkeysButton = getById("save-hotkeys");
const hotkeyStartStopInput = getById("hotkey-start-stop");
const hotkeyPauseResumeInput = getById("hotkey-pause-resume");
const hotkeyAutoToggleInput = getById("hotkey-auto-toggle");
const jobsList = getById("jobs-list");
const refreshJobsButton = getById("refresh-jobs");
const refreshTranscriptionDiagnosticsButton = getById("refresh-transcription-diagnostics");
const transcriptionDiagnosticsSummary = getById("transcription-diagnostics-summary");
const transcriptionDiagnosticsGrid = getById("transcription-diagnostics-grid");
const transcriptionTestTarget = getById("transcription-test-target");
const runTranscriptionTestButton = getById("run-transcription-test");
const transcriptionTestOutput = getById("transcription-test-output");
const sessionSearchInput = getById("session-search-query");
const sessionSearchModeSelect = getById("session-search-mode");
const sessionSearchButton = getById("session-search-button");
const sessionSearchClearButton = getById("session-search-clear");
const sessionReel = getById("session-reel");
const reelCount = getById("reel-count");
const sessionsList = getById("sessions-list");
const detailSessionId = getById("detail-session-id");
const detailSource = getById("detail-source");
const detailStartedAt = getById("detail-started-at");
const detailEndedAt = getById("detail-ended-at");
const detailStatus = getById("detail-status");
const detailDirtyState = getById("detail-dirty-state");
const detailTitleInput = getById("detail-title");
const detailSummaryInput = getById("detail-summary");
const detailTopicsInput = getById("detail-topics");
const detailKeywordsInput = getById("detail-keywords");
const detailTranscriptTimeline = getById("detail-transcript-timeline");
const detailTranscriptTimelineMeta = getById("detail-transcript-timeline-meta");
const detailTranscriptInput = getById("detail-transcript");
const sessionPlayer = getById("session-player");
const sessionPlayerMeta = getById("session-player-meta");
const detailTranscriptionMeta = getById("detail-transcription-meta");
const retranscribeProviderSelect = getById("retranscribe-provider");
const retranscribeLanguageModeSelect = getById("retranscribe-language-mode");
const retranscribeLanguageCustomInput = getById("retranscribe-language-custom");
const retranscribeModelInput = getById("retranscribe-model");
const retranscribeSessionButton = getById("retranscribe-session");
const replaySessionButton = getById("replay-session");
const saveDetailButton = getById("save-session-detail");
const exportMdButton = getById("export-md");
const exportTxtButton = getById("export-txt");
const exportJsonButton = getById("export-json");
const deleteSessionButton = getById("delete-session");
const telemetryPath = getById("telemetry-path");
const telemetryLog = getById("telemetry-log");
const refreshTelemetryButton = getById("refresh-telemetry");
const openTelemetryDirButton = getById("open-telemetry-dir");
const confirmDialog = getById("confirm-dialog");
const confirmDialogMessage = getById("confirm-dialog-message");
const confirmDialogConfirmBtn = getById("confirm-dialog-confirm");
const confirmDialogCancelBtn = getById("confirm-dialog-cancel");
const transcriptionSetupDialog = getById("transcription-setup-dialog");
const transcriptionSetupCloseButton = getById("transcription-setup-close");
const transcriptionSetupLead = getById("transcription-setup-lead");
const transcriptionSetupStatus = getById("transcription-setup-status");
const transcriptionModelRefreshButton = getById("transcription-model-refresh");
const transcriptionModelLibrary = getById("transcription-model-library");
const transcriptionCustomModel = getById("transcription-custom-model");
const transcriptionSetupBrowseButton = getById("transcription-setup-browse");
const transcriptionSetupResult = getById("transcription-setup-result");
const tabButtons = Array.from(document.querySelectorAll("[data-tab-target]"));
const tabPanels = Array.from(document.querySelectorAll("[data-tab-panel]"));

const TAB_METADATA = {
  capture: {
    title: "Capture",
    subtitle: "Record calls and monitor Slack activity.",
  },
  knowledge: {
    title: "Knowledge",
    subtitle: "Search, edit, and export captured session knowledge.",
  },
  media: {
    title: "Media",
    subtitle: "Review recording playback and transcription.",
  },
  processing: {
    title: "Processing",
    subtitle: "Review transcription and analysis job status.",
  },
  settings: {
    title: "Settings",
    subtitle: "Configure storage, local processing, and hotkeys.",
  },
  logs: {
    title: "Logs",
    subtitle: "Inspect telemetry and UI activity diagnostics.",
  },
};

/** @type {null | {
 *   recorder: MediaRecorder;
 *   recordingSessionId: string;
 *   mimeType: string;
 *   startedAt: string;
 *   sourceName: string;
 *   sourceType: "screen" | "window";
 *   audioMode: "system" | "mic" | "both";
 *   displayStream: MediaStream;
 *   microphoneStream: MediaStream | null;
 *   mixedStream: MediaStream;
 *   stopLevelMonitor: null | (() => Promise<void>);
 *   isAutoTriggered: boolean;
 *   isPaused: boolean;
 *   lastAudioActivityAt: number;
 *   autoStopCandidateSince: null | number;
 *   stopReason: string;
 *   accumulatedDurationMs: number;
 *   lastResumeAt: number | null;
 *   currentLevel: number;
 *   hasAudio: boolean;
 *   persistChain: Promise<void>;
 *   persistFailed: boolean;
 * }}
 */
let activeRecording = null;

/** @type {null | {
 *   storageDir: string;
 *   autoRecordEnabled: boolean;
 *   aiProcessingEnabled: boolean;
 *   inactivityTimeoutMinutes: number;
 *   hotkeys: {
 *     startStop: string;
 *     pauseResume: string;
 *     autoToggle: string;
 *   };
 *   transcriptionDefaults: {
 *     provider: "auto" | "local-whisper-cli" | "local-whisper-python";
 *     model?: string;
 *     language: string;
 *   };
 *   transcriptionSetup: {
 *     status: "pending" | "dismissed" | "completed";
 *     completedAt?: string;
 *     dismissedAt?: string;
 *     modelPath?: string;
 *     modelId?: string;
 *   };
 * }} */
let appSettings = null;

/** @type {null | {
 *   checkedAt: string;
 *   whisperCli: {
 *     available: boolean;
 *     commandPath?: string;
 *     source?: "bundled" | "system";
 *     modelPath?: string;
 *     modelExists: boolean;
 *     ready: boolean;
 *   };
 *   whisperPython: {
 *     available: boolean;
 *     commandPath?: string;
 *     ready: boolean;
 *   };
 *   ffmpeg: {
 *     available: boolean;
 *     commandPath?: string;
 *   };
 *   autoStrategy: {
 *     attemptOrder: string[];
 *     firstReadyProvider?: string;
 *     ready: boolean;
 *     summary: string;
 *   };
 *   managedModelDirectory: string;
 *   setupStatus: "pending" | "dismissed" | "completed";
 * }} */
let transcriptionDiagnostics = null;
/** @type {null | {
 *   runtimeAvailable: boolean;
 *   runtimeSource?: "bundled" | "system";
 *   managedModelDirectory: string;
 *   configuredModelPath?: string;
 *   aiProcessingEnabled: boolean;
 *   setupStatus: "pending" | "dismissed" | "completed";
 *   models: Array<{
 *     id: string;
 *     displayName: string;
 *     description: string;
 *     sizeLabel: string;
 *     memoryLabel: string;
 *     speedLabel: string;
 *     accuracyLabel: string;
 *     multilingual: boolean;
 *     recommended: boolean;
 *     installed: boolean;
 *     active: boolean;
 *     managedPath: string;
 *     language: string;
 *     priority: number;
 *   }>;
 *   customModel?: {
 *     path: string;
 *     exists: boolean;
 *     active: boolean;
 *   };
 * }} */
let transcriptionModelLibraryState = null;
let transcriptionSetupAutoPrompted = false;
let transcriptionSetupResultMessage =
  "New installs keep local processing off until setup succeeds.";
const transcriptionModelDownloadProgress = new Map();
let transcriptionModelDownloadUnsubscribe = null;

/** @type {Array<{
 *   id: string;
 *   sessionId: string;
 *   title: string;
 *   status: "queued" | "processing" | "done" | "failed";
 *   attemptCount: number;
 *   createdAt: string;
 *   updatedAt: string;
 *   startedAt?: string;
 *   completedAt?: string;
 *   failedAt?: string;
 *   errorMessage?: string;
 *   jobKind?: "initial" | "retranscribe";
 *   requestedProvider?: "auto" | "local-whisper-cli" | "local-whisper-python";
 *   requestedModel?: string;
 *   requestedLanguage?: string;
 *   transcriptProvider?: string;
 *   transcriptModel?: string;
 *   transcriptLanguage?: string;
 *   transcriptChars?: number;
 *   summaryPreview?: string;
 * }>} */
let processingJobs = [];

/** @type {Array<{
 *   id: string;
 *   title: string;
 *   sourceName?: string;
 *   startedAt: string;
 *   endedAt?: string;
 *   processingStatus: string;
 *   summary: string;
 *   topics: string[];
 *   keywords: string[];
 *   transcriptSnippet: string;
 *   updatedAt: string;
 * }>} */
let recentSessions = [];

/** @type {Array<{
 *   id: string;
 *   title: string;
 *   sourceName?: string;
 *   startedAt: string;
 *   endedAt?: string;
 *   processingStatus: string;
 *   summary: string;
 *   topics: string[];
 *   keywords: string[];
 *   transcriptSnippet: string;
 *   updatedAt: string;
 *   score?: number;
 *   matchType?: "keyword" | "semantic" | "both";
 * }>} */
let visibleSessions = [];

/** @type {null | {
 *   id: string;
 *   title: string;
 *   sourceName?: string;
 *   startedAt: string;
 *   endedAt?: string;
 *   processingStatus: string;
 *   summary: string;
 *   topics: string[];
 *   keywords: string[];
 *   transcriptSnippet: string;
 *   updatedAt: string;
 *   mediaPath: string;
 *   metadataPath: string;
 *   transcriptPath?: string;
 *   transcriptSegmentsPath?: string;
 *   analysisPath?: string;
 *   transcriptSegments: Array<{
 *     startMs: number;
 *     endMs: number;
 *     text: string;
 *   }>;
 *   transcriptText: string;
 *   screenMode?: "screen" | "window";
 *   audioMode?: "system" | "mic" | "both";
 *   autoTriggered?: boolean;
 *   stopReason?: string;
 *   transcriptProvider?: string;
 *   transcriptModel?: string;
 *   transcriptLanguage?: string;
 * }} */
let selectedSessionDetail = null;

let selectedSessionId = null;
let sessionDetailBaseline = null;
let sessionDetailDirty = false;
let activeTranscriptSegmentIndex = -1;
let autoMonitorTimer = null;
let autoTickInFlight = false;
let manualStopCooldownUntil = 0;
let hotkeyUnsubscribe = null;
let processingUnsubscribe = null;
let transportTelemetryTimer = null;
let maxDurationTimer = null;
const SESSION_REEL_LIMIT = 12;
const SESSION_THUMBNAIL_MAX_CONCURRENT = 2;
const SESSION_HOVER_PREVIEW_DELAY_MS = 320;
const SESSION_HOVER_PREVIEW_CLIP_DURATION_SECONDS = 6;
const sessionThumbnailCache = new Map();
const sessionThumbnailInflight = new Map();
const sessionThumbnailQueue = [];
let sessionThumbnailActiveCount = 0;
const sessionPlaybackCache = new Map();
const sessionPlaybackInflight = new Map();
const sessionHoverPreviewVideo = document.createElement("video");
let sessionHoverPreviewRequestToken = 0;
let sessionHoverPreviewTimerId = null;
let sessionHoverPreviewSessionId = null;
let sessionHoverPreviewThumbElement = null;
let sessionHoverPreviewPendingSessionId = null;
let sessionHoverPreviewPendingThumbElement = null;
let sessionHoverPreviewClipStartSeconds = 0;
let sessionHoverPreviewClipEndSeconds = 0;
let sessionHoverPreviewTotalSeconds = 0;
let sessionHoverPreviewAnimationFrameId = null;
let sessionHoverPreviewTimeElement = null;

sessionHoverPreviewVideo.className = "reel-thumb-video-preview";
sessionHoverPreviewVideo.muted = true;
sessionHoverPreviewVideo.defaultMuted = true;
sessionHoverPreviewVideo.playsInline = true;
sessionHoverPreviewVideo.preload = "auto";
sessionHoverPreviewVideo.controls = false;
sessionHoverPreviewVideo.disablePictureInPicture = true;

function ensureApi() {
  if (!window.coview) {
    throw new Error("Coview preload API was not found.");
  }
}

function toErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function showConfirmation(message) {
  return new Promise((resolve) => {
    confirmDialogMessage.textContent = message;
    const cleanup = () => {
      confirmDialogConfirmBtn.removeEventListener("click", onConfirm);
      confirmDialogCancelBtn.removeEventListener("click", onCancel);
      confirmDialog.removeEventListener("cancel", onCancel);
      confirmDialog.close();
    };
    const onConfirm = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };
    confirmDialogConfirmBtn.addEventListener("click", onConfirm, { once: true });
    confirmDialogCancelBtn.addEventListener("click", onCancel, { once: true });
    confirmDialog.addEventListener("cancel", onCancel, { once: true });
    confirmDialog.showModal();
  });
}

async function withButtonLoading(button, asyncFn) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = `${originalText}...`;
  try {
    return await asyncFn();
  } finally {
    button.textContent = originalText;
    button.disabled = false;
  }
}

function getActiveModelDownloadId() {
  for (const progress of transcriptionModelDownloadProgress.values()) {
    if (progress.status === "downloading") {
      return progress.modelId;
    }
  }
  return null;
}

function applySettings(settings) {
  appSettings = settings;
  updateAutoUi();
  updateHotkeyInputs();
  updateSettingsTranscriptionInputs();
  updateTranscriptionSetupSummary();
  if (selectedSessionDetail) {
    resetRetranscriptionControls(selectedSessionDetail);
    setRetranscriptionControlsEnabled(true);
  }
  storagePath.textContent = settings.storageDir;
}

function renderTranscriptionModelLibrary() {
  transcriptionModelLibrary.innerHTML = "";

  if (!transcriptionModelLibraryState) {
    transcriptionModelLibrary.innerHTML = '<p class="setting-hint">Loading model library...</p>';
    transcriptionCustomModel.textContent = "External model overrides will appear here when selected.";
    return;
  }

  const activeDownloadId = getActiveModelDownloadId();
  const hasManagedModels = transcriptionModelLibraryState.models.length > 0;

  if (!hasManagedModels) {
    transcriptionModelLibrary.innerHTML = '<p class="setting-hint">No managed models are available yet.</p>';
  }

  transcriptionModelLibraryState.models.forEach((model) => {
    const progress = transcriptionModelDownloadProgress.get(model.id);
    const isDownloading = progress?.status === "downloading";
    const card = document.createElement("article");
    card.className = `model-card${model.active ? " is-active" : ""}`;

    const header = document.createElement("div");
    header.className = "model-card-head";
    header.innerHTML = `
      <div>
        <h4>${escapeHtml(model.displayName)}</h4>
        <p>${escapeHtml(model.description)}</p>
      </div>
      <div class="model-card-badges"></div>
    `;
    const badges = header.querySelector(".model-card-badges");
    const badgeValues = [];
    if (model.recommended) {
      badgeValues.push({ label: "Recommended", tone: "primary" });
    }
    if (model.active) {
      badgeValues.push({ label: "Using Now", tone: "success" });
    } else if (model.installed) {
      badgeValues.push({ label: "Installed" });
    }
    if (model.multilingual) {
      badgeValues.push({ label: "Multilingual" });
    } else {
      badgeValues.push({ label: "English" });
    }
    badgeValues.forEach((badgeValue) => {
      const badge = document.createElement("span");
      badge.className = "model-badge";
      if (badgeValue.tone) {
        badge.dataset.tone = badgeValue.tone;
      }
      badge.textContent = badgeValue.label;
      badges.append(badge);
    });

    const meta = document.createElement("div");
    meta.className = "model-card-meta";
    meta.innerHTML = [
      `<span>Download: ${escapeHtml(model.sizeLabel)}</span>`,
      `<span>Memory: ${escapeHtml(model.memoryLabel)}</span>`,
      `<span>Speed: ${escapeHtml(model.speedLabel)}</span>`,
      `<span>Accuracy: ${escapeHtml(model.accuracyLabel)}</span>`,
    ].join("");

    const actions = document.createElement("div");
    actions.className = "model-card-actions";
    const actionBusy = Boolean(activeDownloadId) && activeDownloadId !== model.id;

    if (!model.installed) {
      const installButton = document.createElement("button");
      installButton.type = "button";
      installButton.className = model.recommended ? "primary" : "";
      installButton.textContent = isDownloading ? "Installing..." : "Install";
      installButton.disabled =
        !transcriptionModelLibraryState.runtimeAvailable || actionBusy || isDownloading;
      installButton.addEventListener("click", () => {
        void installWhisperModel(model.id).catch((error) => {
          transcriptionSetupResultMessage = `Setup failed: ${toErrorMessage(error)}`;
          renderTranscriptionSetupDialog();
          log(`Failed to install ${model.displayName}: ${toErrorMessage(error)}`, true);
        });
      });
      actions.append(installButton);
    } else if (!model.active) {
      const useButton = document.createElement("button");
      useButton.type = "button";
      useButton.textContent = "Use This Model";
      useButton.disabled = actionBusy || isDownloading;
      useButton.addEventListener("click", () => {
        void useInstalledWhisperModel(model.id).catch((error) => {
          transcriptionSetupResultMessage = `Unable to switch models: ${toErrorMessage(error)}`;
          renderTranscriptionSetupDialog();
          log(`Failed to switch to ${model.displayName}: ${toErrorMessage(error)}`, true);
        });
      });
      actions.append(useButton);
    }

    if (model.installed) {
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "danger";
      removeButton.textContent = "Remove";
      removeButton.disabled = actionBusy || isDownloading;
      removeButton.addEventListener("click", () => {
        void removeInstalledWhisperModel(model).catch((error) => {
          transcriptionSetupResultMessage = `Unable to remove model: ${toErrorMessage(error)}`;
          renderTranscriptionSetupDialog();
          log(`Failed to remove ${model.displayName}: ${toErrorMessage(error)}`, true);
        });
      });
      actions.append(removeButton);
    }

    const progressLine = document.createElement("div");
    progressLine.className = "model-card-progress";
    if (isDownloading) {
      const totalText = progress.totalBytes ? formatByteCount(progress.totalBytes) : model.sizeLabel;
      progressLine.textContent = `${progress.message || "Downloading"} ${formatByteCount(
        progress.downloadedBytes,
      )} / ${totalText}`;
    } else if (progress?.status === "failed" && progress.message) {
      progressLine.textContent = progress.message;
    } else if (progress?.status === "completed") {
      progressLine.textContent = progress.message || "Model installed.";
    } else if (model.installed) {
      progressLine.textContent = `Stored at ${model.managedPath}`;
    } else if (!transcriptionModelLibraryState.runtimeAvailable) {
      progressLine.textContent = "A local whisper runtime is required before managed installs can start.";
    } else {
      progressLine.textContent = `Ready to install. Default language: ${model.language === "auto" ? "auto" : model.language}.`;
    }

    card.append(header, meta, actions, progressLine);
    transcriptionModelLibrary.append(card);
  });

  if (transcriptionModelLibraryState.customModel?.active) {
    const customModel = transcriptionModelLibraryState.customModel;
    transcriptionCustomModel.textContent = customModel.exists
      ? `External model in use: ${customModel.path}`
      : `Configured external model is missing: ${customModel.path}`;
  } else {
    transcriptionCustomModel.textContent = "Use Existing Model File to point Coview at a local .bin model outside the managed library.";
  }
}

async function loadTranscriptionModelLibrary() {
  transcriptionModelLibraryState = await window.coview.listTranscriptionModels();
  if (transcriptionSetupDialog.open) {
    renderTranscriptionSetupDialog();
  }
}

function registerTranscriptionModelDownloadListener() {
  if (transcriptionModelDownloadUnsubscribe) {
    transcriptionModelDownloadUnsubscribe();
  }
  transcriptionModelDownloadUnsubscribe = window.coview.onTranscriptionModelDownloadProgress((progress) => {
    transcriptionModelDownloadProgress.set(progress.modelId, progress);
    if (transcriptionSetupDialog.open) {
      renderTranscriptionSetupDialog();
    }
  });
}

function shouldPromptTranscriptionSetup() {
  if (!appSettings || !transcriptionDiagnostics) {
    return false;
  }
  if (transcriptionDiagnostics.autoStrategy.ready) {
    return false;
  }
  return appSettings.transcriptionSetup.status !== "dismissed";
}

function updateTranscriptionSetupSummary() {
  if (!appSettings || !transcriptionDiagnostics) {
    transcriptionSetupSummary.textContent = "Loading transcription setup...";
    openTranscriptionSetupButton.textContent = "Guided Setup";
    return;
  }

  if (transcriptionDiagnostics.autoStrategy.ready) {
    openTranscriptionSetupButton.textContent = "Change Setup";
    const providerLabel =
      transcriptionDiagnostics.autoStrategy.firstReadyProvider === "local-whisper-cli"
        ? "Local whisper runtime ready"
        : "Local Python whisper ready";
    const modelLabel = appSettings.transcriptionDefaults.model
      ? ` Model: ${formatConfiguredModelLabel(appSettings.transcriptionDefaults.model)}.`
      : "";
    transcriptionSetupSummary.textContent = `${providerLabel}.${modelLabel}`;
    return;
  }

  if (transcriptionDiagnostics.whisperCli.available) {
    openTranscriptionSetupButton.textContent = "Finish Setup";
    transcriptionSetupSummary.textContent =
      "Coview found a local whisper runtime. Install a model to finish setup.";
    return;
  }

  openTranscriptionSetupButton.textContent = "Guided Setup";
  transcriptionSetupSummary.textContent =
    "Local processing is not configured yet. Guided setup will help you finish it.";
}

function renderTranscriptionSetupDialog() {
  if (!appSettings || !transcriptionDiagnostics) {
    return;
  }

  const whisperRuntimeDetected = transcriptionDiagnostics.whisperCli.available;
  const localProcessingReady = transcriptionDiagnostics.autoStrategy.ready;
  const runtimeLabel =
    transcriptionDiagnostics.whisperCli.source === "bundled"
      ? "Bundled whisper runtime detected."
      : transcriptionDiagnostics.whisperCli.available
        ? "System whisper-cli detected."
        : "No whisper runtime detected yet.";

  transcriptionSetupLead.textContent = localProcessingReady
    ? "Local processing is ready. You can still replace the model or point Coview at another one."
    : "Coview can install a local Whisper model and enable local processing automatically.";
  transcriptionSetupStatus.dataset.tone = localProcessingReady ? "ready" : "warning";
  transcriptionSetupStatus.innerHTML = [
    `<strong>${localProcessingReady ? "Local processing is ready" : "Setup still needed"}</strong>`,
    `<span>${escapeHtml(runtimeLabel)}</span>`,
    `<span>Configured model: ${escapeHtml(transcriptionDiagnostics.whisperCli.modelPath || "not set")}</span>`,
    `<span>Managed model folder: ${escapeHtml(transcriptionDiagnostics.managedModelDirectory)}</span>`,
  ].join("");
  transcriptionSetupBrowseButton.disabled = !whisperRuntimeDetected;
  transcriptionSetupResult.textContent = transcriptionSetupResultMessage;
  transcriptionModelRefreshButton.disabled = Boolean(getActiveModelDownloadId());
  renderTranscriptionModelLibrary();
}

async function openTranscriptionSetupDialog(options = {}) {
  await Promise.all([loadTranscriptionDiagnostics(), loadTranscriptionModelLibrary()]);
  renderTranscriptionSetupDialog();
  if (options.auto) {
    transcriptionSetupAutoPrompted = true;
  }
  if (!transcriptionSetupDialog.open) {
    transcriptionSetupDialog.showModal();
  }
}

async function dismissTranscriptionSetup() {
  if (!transcriptionDiagnostics?.autoStrategy.ready) {
    await updateSettings({
      aiProcessingEnabled: false,
      transcriptionSetup: {
        status: "dismissed",
      },
    });
    transcriptionSetupResultMessage = "Local processing stays off until setup is completed.";
  }
  if (transcriptionSetupDialog.open) {
    transcriptionSetupDialog.close();
  }
}

async function installWhisperModel(modelId) {
  const result = await window.coview.downloadRecommendedTranscriptionModel({
    modelId,
  });
  applySettings(result.settings);
  transcriptionSetupResultMessage = result.alreadyExisted
    ? `Using ${result.displayName} at ${result.modelPath}.`
    : `Installed ${result.displayName} to ${result.modelPath}.`;
  await Promise.all([loadTranscriptionDiagnostics(), loadTranscriptionModelLibrary()]);
  renderTranscriptionSetupDialog();
  log(
    result.alreadyExisted
      ? `Local transcription was already configured with ${result.displayName}.`
      : `Installed ${result.displayName} for local transcription.`,
  );
}

async function useInstalledWhisperModel(modelId) {
  applySettings(await window.coview.activateTranscriptionModel({ modelId }));
  transcriptionSetupResultMessage = "Transcription defaults updated.";
  await Promise.all([loadTranscriptionDiagnostics(), loadTranscriptionModelLibrary()]);
  renderTranscriptionSetupDialog();
  log(`Switched the default transcription model to ${modelId}.`);
}

async function removeInstalledWhisperModel(model) {
  const confirmed = await showConfirmation(
    `Remove ${model.displayName}?\n\nThis deletes the local model file from Coview's managed library.`,
  );
  if (!confirmed) {
    return;
  }

  const result = await window.coview.removeTranscriptionModel({ modelId: model.id });
  applySettings(result.settings);
  transcriptionSetupResultMessage = `${model.displayName} was removed.`;
  transcriptionModelDownloadProgress.delete(model.id);
  await Promise.all([loadTranscriptionDiagnostics(), loadTranscriptionModelLibrary()]);
  renderTranscriptionSetupDialog();
  log(`Removed ${model.displayName} from the managed model library.`);
}

async function chooseExistingTranscriptionModel() {
  const selectedPath = await window.coview.chooseTranscriptionModelFile();
  if (!selectedPath) {
    return;
  }

  applySettings(await window.coview.activateCustomTranscriptionModel({
    modelPath: selectedPath,
  }));
  transcriptionSetupResultMessage = `Configured local transcription to use ${selectedPath}.`;
  await Promise.all([loadTranscriptionDiagnostics(), loadTranscriptionModelLibrary()]);
  renderTranscriptionSetupDialog();
  log(`Configured local transcription to use ${selectedPath}.`);
}

function activateTab(tabId) {
  const metadata = TAB_METADATA[tabId];
  if (!metadata) {
    return;
  }

  for (const button of tabButtons) {
    const target = button.getAttribute("data-tab-target");
    button.classList.toggle("is-active", target === tabId);
  }

  for (const panel of tabPanels) {
    const panelId = panel.getAttribute("data-tab-panel");
    panel.classList.toggle("is-active", panelId === tabId);
  }

}

function registerTabNavigation() {
  for (const button of tabButtons) {
    button.addEventListener("click", () => {
      const target = button.getAttribute("data-tab-target");
      if (!target) {
        return;
      }
      activateTab(target);
    });
  }
}

function setStatusChipTone(element, tone) {
  element.dataset.tone = tone;
}

function getActiveRecordingElapsedMs(recording) {
  if (!recording) {
    return 0;
  }
  if (recording.lastResumeAt === null) {
    return recording.accumulatedDurationMs;
  }
  return recording.accumulatedDurationMs + (Date.now() - recording.lastResumeAt);
}

function updateTopbarStatusUi() {
  // Topbar removed — status is shown in the persistent bottom dock transport.
}

function syncTransportTelemetryLoop() {
  if (activeRecording && !transportTelemetryTimer) {
    transportTelemetryTimer = window.setInterval(() => {
      updateTransportTick();
    }, 250);
    return;
  }
  if (!activeRecording && transportTelemetryTimer) {
    window.clearInterval(transportTelemetryTimer);
    transportTelemetryTimer = null;
  }
}

function updateTransportStaticContext() {
  if (!activeRecording) {
    const sourceLabel = sourceSelect.options.length > 0 ? getSourceName() : "No source selected";
    const sourceTypeLabel = sourceTypeSelect.value === "window" ? "Window" : "Screen";
    const audioLabel = toAudioModeLabel(audioModeSelect.value);
    transportSourceSummary.textContent = `${sourceTypeLabel} • ${sourceLabel} • ${audioLabel}`;
    transportAutomation.textContent = appSettings
      ? appSettings.autoRecordEnabled
        ? "Auto armed"
        : "Manual only"
      : "Loading...";
  } else {
    transportSourceSummary.textContent = `${activeRecording.sourceType === "window" ? "Window" : "Screen"} • ${activeRecording.sourceName} • ${toAudioModeLabel(activeRecording.audioMode)}`;
    transportAutomation.textContent = activeRecording.isAutoTriggered ? "Auto session" : "Manual session";
  }
}

function updateTransportTick() {
  if (!activeRecording) {
    transportRecordingState.textContent = "Idle";
    transportRecordingState.classList.remove("is-recording", "is-paused");
    transportElapsed.textContent = "00:00";
    transportLevelFill.style.width = "0%";
    transportLevelText.textContent = "Idle";
    return;
  }

  if (activeRecording.isPaused) {
    transportRecordingState.textContent = "Paused";
    transportRecordingState.classList.add("is-paused");
    transportRecordingState.classList.remove("is-recording");
  } else {
    transportRecordingState.textContent = "Recording";
    transportRecordingState.classList.add("is-recording");
    transportRecordingState.classList.remove("is-paused");
  }

  transportElapsed.textContent = formatDurationMs(getActiveRecordingElapsedMs(activeRecording));

  if (!activeRecording.hasAudio) {
    transportLevelFill.style.width = "0%";
    transportLevelText.textContent = "Video only";
    return;
  }

  const levelPercent = activeRecording.isPaused ? 0 : getAudioLevelPercent(activeRecording.currentLevel);
  transportLevelFill.style.width = `${levelPercent}%`;
  if (activeRecording.isPaused) {
    transportLevelText.textContent = "Paused";
  } else if (levelPercent === 0) {
    transportLevelText.textContent = "Quiet";
  } else {
    transportLevelText.textContent = `${levelPercent}% signal`;
  }
}

function updateTransportDeckUi() {
  updateTopbarStatusUi();
  updateTransportStaticContext();
  updateTransportTick();
}

function readSessionDetailDraftSnapshot() {
  return {
    title: detailTitleInput.value,
    summary: detailSummaryInput.value,
    topics: parseTagInput(detailTopicsInput.value),
    keywords: parseTagInput(detailKeywordsInput.value),
    transcriptText: detailTranscriptInput.value,
  };
}

function setSessionDetailDirtyState(isDirty) {
  sessionDetailDirty = isDirty;
  detailDirtyState.textContent = isDirty ? "Unsaved changes" : "Saved";
  detailDirtyState.classList.toggle("is-dirty", isDirty);
  saveDetailButton.disabled = !selectedSessionDetail || !isDirty;
}

function updateSessionDetailDirtyState() {
  if (!selectedSessionDetail || !sessionDetailBaseline) {
    setSessionDetailDirtyState(false);
    return;
  }
  const current = JSON.stringify(readSessionDetailDraftSnapshot());
  setSessionDetailDirtyState(current !== sessionDetailBaseline);
}

function resetSessionDetailDraftBaseline() {
  sessionDetailBaseline = JSON.stringify(readSessionDetailDraftSnapshot());
  setSessionDetailDirtyState(false);
}

async function confirmDiscardSessionDetailDraft() {
  if (!sessionDetailDirty) {
    return true;
  }
  return showConfirmation(
    "You have unsaved session detail edits. Continue and discard these changes?",
  );
}

function clearSessionPlayer(message = "No session selected.") {
  sessionPlayer.pause();
  sessionPlayer.removeAttribute("src");
  sessionPlayer.load();
  sessionPlayerMeta.textContent = message;
}

function getTranscriptSegmentActiveEndMs(segments, index) {
  const segment = segments[index];
  if (!segment) {
    return 0;
  }

  const nextSegment = segments[index + 1];
  const fallbackEndMs = nextSegment?.startMs ?? (segment.startMs + 1500);
  return Math.max(segment.startMs + 1, segment.endMs || 0, fallbackEndMs);
}

function updateActiveTranscriptSegment() {
  const segments = selectedSessionDetail?.transcriptSegments || [];
  const cueButtons = detailTranscriptTimeline.querySelectorAll("[data-transcript-segment-index]");
  if (segments.length === 0 || cueButtons.length === 0) {
    activeTranscriptSegmentIndex = -1;
    return;
  }

  const currentMs = Math.round((sessionPlayer.currentTime || 0) * 1000);
  let nextActiveIndex = -1;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const activeEndMs = getTranscriptSegmentActiveEndMs(segments, index);
    if (currentMs >= segment.startMs && currentMs < activeEndMs) {
      nextActiveIndex = index;
      break;
    }
  }

  if (nextActiveIndex === -1 && segments.length > 0 && currentMs >= segments[segments.length - 1].startMs) {
    nextActiveIndex = segments.length - 1;
  }

  if (activeTranscriptSegmentIndex === nextActiveIndex) {
    return;
  }

  activeTranscriptSegmentIndex = nextActiveIndex;
  cueButtons.forEach((button, index) => {
    button.classList.toggle("is-active", index === nextActiveIndex);
  });
}

function renderTimestampedTranscript(detail = selectedSessionDetail) {
  activeTranscriptSegmentIndex = -1;
  const segments = detail?.transcriptSegments || [];

  if (!detail) {
    detailTranscriptTimeline.classList.add("is-empty");
    detailTranscriptTimeline.innerHTML =
      '<p class="transcript-segments-empty">Select a session to review synced transcript cues.</p>';
    detailTranscriptTimelineMeta.textContent = "No session selected.";
    return;
  }

  if (segments.length === 0) {
    detailTranscriptTimeline.classList.add("is-empty");
    detailTranscriptTimeline.innerHTML =
      '<p class="transcript-segments-empty">No timestamped transcript is available yet. Re-transcribe to generate synced cues.</p>';
    detailTranscriptTimelineMeta.textContent =
      detail.transcriptText && detail.transcriptText.length > 0
        ? "Transcript text is available, but not synced to playback."
        : "No timestamped transcript yet.";
    return;
  }

  detailTranscriptTimeline.classList.remove("is-empty");
  detailTranscriptTimeline.innerHTML = segments
    .map(
      (segment, index) => `
        <button
          type="button"
          class="transcript-segment"
          data-transcript-segment-index="${index}"
          data-start-ms="${segment.startMs}"
        >
          <span class="transcript-segment-time">${escapeHtml(formatDurationMs(segment.startMs))}</span>
          <span class="transcript-segment-text">${escapeHtml(segment.text)}</span>
        </button>
      `,
    )
    .join("");
  detailTranscriptTimelineMeta.textContent = `${segments.length} synced cues`;
  updateActiveTranscriptSegment();
}

async function seekSessionPlayerToTranscriptSegment(startMs) {
  if (!selectedSessionDetail || !Number.isFinite(startMs) || startMs < 0) {
    return;
  }

  try {
    await waitForVideoMetadata(sessionPlayer);
    await seekVideoFrame(sessionPlayer, startMs / 1000);
    updateActiveTranscriptSegment();
    await sessionPlayer.play().catch(() => undefined);
  } catch (error) {
    log(`Failed to seek the selected session recording: ${toErrorMessage(error)}`, true);
  }
}

function isSelectedSessionProcessingBusy() {
  return (
    selectedSessionDetail &&
    (selectedSessionDetail.processingStatus === "queued" ||
      selectedSessionDetail.processingStatus === "processing")
  );
}

function setRetranscriptionControlsEnabled(enabled) {
  const busy = isSelectedSessionProcessingBusy();
  const controlsEnabled = enabled && !busy;
  retranscribeProviderSelect.disabled = !controlsEnabled;
  retranscribeLanguageModeSelect.disabled = !controlsEnabled;
  retranscribeModelInput.disabled = !controlsEnabled;
  retranscribeLanguageCustomInput.disabled =
    !controlsEnabled || retranscribeLanguageModeSelect.value !== "custom";
  retranscribeSessionButton.disabled = !controlsEnabled;
}

function updateRetranscriptionLanguageUi() {
  const enabled = Boolean(selectedSessionDetail) && !isSelectedSessionProcessingBusy();
  retranscribeModelInput.disabled = !enabled;
  retranscribeLanguageCustomInput.disabled =
    !enabled || retranscribeLanguageModeSelect.value !== "custom";
}

function updateSessionTranscriptionMeta(detail) {
  if (!detail?.transcriptProvider && !detail?.transcriptModel && !detail?.transcriptLanguage) {
    if (detail?.transcriptSegments?.length > 0) {
      detailTranscriptionMeta.textContent = `${detail.transcriptSegments.length} synced cues`;
      return;
    }
    detailTranscriptionMeta.textContent = "No transcript metadata yet.";
    return;
  }
  const provider = detail?.transcriptProvider || "not available";
  const model = detail?.transcriptModel || "default";
  const language = detail?.transcriptLanguage || "en";
  const cueSummary =
    detail?.transcriptSegments?.length > 0 ? ` | ${detail.transcriptSegments.length} synced cues` : "";
  detailTranscriptionMeta.textContent = `Current: ${provider} / ${model} / ${language}${cueSummary}`;
}

function getUiTranscriptionDefaults(detail = null) {
  return {
    provider: appSettings?.transcriptionDefaults?.provider || detail?.transcriptProvider || "auto",
    model: appSettings?.transcriptionDefaults?.model || "",
    language: appSettings?.transcriptionDefaults?.language || detail?.transcriptLanguage || "en",
  };
}

function getRetranscriptionDefaultModel(detail) {
  const configuredModel = appSettings?.transcriptionDefaults?.model;
  if (configuredModel) {
    return configuredModel;
  }
  if (!detail?.transcriptModel) {
    return "";
  }
  if (
    detail.transcriptProvider === "local-whisper-python" &&
    detail.transcriptModel === "openai-whisper"
  ) {
    return "";
  }
  return detail.transcriptModel;
}

function resetRetranscriptionControls(detail = null) {
  const defaults = getUiTranscriptionDefaults(detail);
  const provider = defaults.provider;
  const language = defaults.language;

  retranscribeProviderSelect.value = provider;
  retranscribeModelInput.value = getRetranscriptionDefaultModel(detail);

  if (language === "auto") {
    retranscribeLanguageModeSelect.value = "auto";
    retranscribeLanguageCustomInput.value = "";
  } else if (language !== "en") {
    retranscribeLanguageModeSelect.value = "custom";
    retranscribeLanguageCustomInput.value = language;
  } else {
    retranscribeLanguageModeSelect.value = "en";
    retranscribeLanguageCustomInput.value = "";
  }

  updateSessionTranscriptionMeta(detail);
  updateRetranscriptionLanguageUi();
}

function updateSettingsTranscriptionLanguageUi() {
  settingsTranscriptionLanguageCustomInput.disabled =
    settingsTranscriptionLanguageModeSelect.value !== "custom";
}

function updateSettingsTranscriptionInputs() {
  if (!appSettings?.transcriptionDefaults) {
    settingsTranscriptionProviderSelect.value = "auto";
    settingsTranscriptionLanguageModeSelect.value = "en";
    settingsTranscriptionLanguageCustomInput.value = "";
    settingsTranscriptionModelInput.value = "";
    updateSettingsTranscriptionLanguageUi();
    return;
  }

  const defaults = appSettings.transcriptionDefaults;
  settingsTranscriptionProviderSelect.value = defaults.provider || "auto";
  settingsTranscriptionModelInput.value = defaults.model || "";
  if (defaults.language === "auto") {
    settingsTranscriptionLanguageModeSelect.value = "auto";
    settingsTranscriptionLanguageCustomInput.value = "";
  } else if (defaults.language !== "en") {
    settingsTranscriptionLanguageModeSelect.value = "custom";
    settingsTranscriptionLanguageCustomInput.value = defaults.language;
  } else {
    settingsTranscriptionLanguageModeSelect.value = "en";
    settingsTranscriptionLanguageCustomInput.value = "";
  }
  updateSettingsTranscriptionLanguageUi();
}

function resolveSettingsTranscriptionLanguage() {
  if (settingsTranscriptionLanguageModeSelect.value === "auto") {
    return "auto";
  }
  if (settingsTranscriptionLanguageModeSelect.value === "custom") {
    const customValue = settingsTranscriptionLanguageCustomInput.value.trim().toLowerCase();
    if (customValue.length === 0) {
      throw new Error("Enter a custom default language code or switch the language mode.");
    }
    return customValue;
  }
  return "en";
}

function resolveRetranscriptionLanguage() {
  if (retranscribeLanguageModeSelect.value === "auto") {
    return "auto";
  }
  if (retranscribeLanguageModeSelect.value === "custom") {
    const customValue = retranscribeLanguageCustomInput.value.trim().toLowerCase();
    if (customValue.length === 0) {
      throw new Error("Enter a custom language code or switch the language mode.");
    }
    return customValue;
  }
  return "en";
}

async function loadSessionPlayback(sessionId) {
  try {
    const playback = await window.coview.getSessionMediaPlayback(sessionId);
    if (selectedSessionId !== sessionId) {
      return;
    }
    sessionPlayer.src = playback.mediaUrl;
    sessionPlayer.load();
    sessionPlayerMeta.textContent = playback.mediaPath;
  } catch (error) {
    if (selectedSessionId !== sessionId) {
      return;
    }
    clearSessionPlayer("Recording preview unavailable.");
    log(`Failed to load recording preview: ${toErrorMessage(error)}`, true);
  }
}

function getVisibleReelSessions() {
  return recentSessions.slice(0, SESSION_REEL_LIMIT);
}

function getTrackedSessionThumbnailIds() {
  const keep = new Set();
  for (const session of getVisibleReelSessions()) {
    keep.add(session.id);
  }
  for (const session of visibleSessions) {
    keep.add(session.id);
  }
  if (selectedSessionId) {
    keep.add(selectedSessionId);
  }
  return keep;
}

function pruneSessionThumbnailCache() {
  const keep = getTrackedSessionThumbnailIds();
  for (const key of sessionThumbnailCache.keys()) {
    if (!keep.has(key)) {
      sessionThumbnailCache.delete(key);
    }
  }
  for (const key of sessionPlaybackCache.keys()) {
    if (!keep.has(key)) {
      sessionPlaybackCache.delete(key);
    }
  }
}

function renderSessionThumbnailMarkup(session, thumbnailUrl, { rootClassName = "reel-thumb", badges = [] } = {}) {
  const badgeMarkup = badges
    .filter((badge) => badge && badge.label)
    .map((badge) => {
      const className = badge.soft ? "reel-badge reel-badge-soft" : "reel-badge";
      return `<span class="${className}">${escapeHtml(badge.label)}</span>`;
    })
    .join("");

  return `
    <div class="${rootClassName}">
      ${
        thumbnailUrl
          ? `<div class="reel-thumb-image" style="background-image: url('${thumbnailUrl}');"></div>`
          : `<div class="reel-thumb-fallback">${escapeHtml(session.sourceName || session.title || "Session preview")}</div>`
      }
      <div class="reel-thumb-progress" aria-hidden="true">
        <div class="reel-thumb-progress-fill"></div>
      </div>
      <div class="reel-thumb-time" aria-hidden="true"></div>
      ${badgeMarkup ? `<div class="reel-thumb-overlay">${badgeMarkup}</div>` : ""}
    </div>
  `;
}

function getSessionThumbnailProcessingBadge(session) {
  const status = String(session?.processingStatus || "").trim();
  if (status.length === 0 || status.toLowerCase() === "done") {
    return null;
  }
  return { label: status };
}

async function getSessionPlayback(sessionId) {
  if (sessionPlaybackCache.has(sessionId)) {
    return sessionPlaybackCache.get(sessionId);
  }

  if (sessionPlaybackInflight.has(sessionId)) {
    return sessionPlaybackInflight.get(sessionId);
  }

  const pending = (async () => {
    try {
      const playback = await window.coview.getSessionMediaPlayback(sessionId);
      sessionPlaybackCache.set(sessionId, playback);
      return playback;
    } finally {
      sessionPlaybackInflight.delete(sessionId);
    }
  })();

  sessionPlaybackInflight.set(sessionId, pending);
  return pending;
}

async function waitForVideoMetadata(video) {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
    return;
  }

  await new Promise((resolve, reject) => {
    const onLoadedMetadata = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Unable to load session media metadata."));
    };
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("error", onError);
    };

    video.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

async function seekVideoFrame(video, timeSeconds) {
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
    return;
  }

  if (Math.abs(video.currentTime - timeSeconds) < 0.02) {
    await waitForVideoFrame(video);
    return;
  }

  await new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Unable to seek session media."));
    };
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };

    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = timeSeconds;
  });

  await waitForVideoFrame(video);
}

function clearSessionHoverPreviewTimer() {
  if (sessionHoverPreviewTimerId !== null) {
    window.clearTimeout(sessionHoverPreviewTimerId);
    sessionHoverPreviewTimerId = null;
  }
  sessionHoverPreviewPendingSessionId = null;
  sessionHoverPreviewPendingThumbElement = null;
}

function setSessionHoverPreviewProgress(progressRatio) {
  if (!sessionHoverPreviewThumbElement) {
    return;
  }

  const clampedRatio = Math.max(0, Math.min(1, progressRatio));
  sessionHoverPreviewThumbElement.style.setProperty("--reel-thumb-progress", clampedRatio.toFixed(4));
}

function setSessionHoverPreviewTimeLabel(currentSeconds, totalSeconds) {
  if (!sessionHoverPreviewTimeElement) {
    return;
  }

  const safeCurrentSeconds = Number.isFinite(currentSeconds) ? Math.max(0, currentSeconds) : 0;
  const safeTotalSeconds = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : NaN;
  sessionHoverPreviewTimeElement.textContent = `${formatDurationMs(safeCurrentSeconds * 1000)}/${formatDurationMs(safeTotalSeconds * 1000)}`;
}

function resolveSessionHoverPreviewTotalSeconds(fallbackDurationSeconds = 0) {
  if (Number.isFinite(sessionHoverPreviewVideo.duration) && sessionHoverPreviewVideo.duration > 0) {
    return sessionHoverPreviewVideo.duration;
  }
  if (Number.isFinite(fallbackDurationSeconds) && fallbackDurationSeconds > 0) {
    return fallbackDurationSeconds;
  }
  return 0;
}

function stopSessionHoverPreviewProgressLoop() {
  if (sessionHoverPreviewAnimationFrameId !== null) {
    window.cancelAnimationFrame(sessionHoverPreviewAnimationFrameId);
    sessionHoverPreviewAnimationFrameId = null;
  }
}

function startSessionHoverPreviewProgressLoop() {
  stopSessionHoverPreviewProgressLoop();

  const tick = () => {
    if (!sessionHoverPreviewThumbElement || sessionHoverPreviewVideo.paused) {
      sessionHoverPreviewAnimationFrameId = null;
      return;
    }

    const clipLength = Math.max(0.01, sessionHoverPreviewClipEndSeconds - sessionHoverPreviewClipStartSeconds);
    if (
      Number.isFinite(sessionHoverPreviewClipEndSeconds) &&
      sessionHoverPreviewClipEndSeconds > sessionHoverPreviewClipStartSeconds + 0.1 &&
      sessionHoverPreviewVideo.currentTime >= sessionHoverPreviewClipEndSeconds - 0.04
    ) {
      sessionHoverPreviewVideo.currentTime = sessionHoverPreviewClipStartSeconds;
    }

    const progressRatio =
      (sessionHoverPreviewVideo.currentTime - sessionHoverPreviewClipStartSeconds) / clipLength;
    setSessionHoverPreviewProgress(progressRatio);
    setSessionHoverPreviewTimeLabel(
      sessionHoverPreviewVideo.currentTime - sessionHoverPreviewClipStartSeconds,
      sessionHoverPreviewTotalSeconds,
    );
    sessionHoverPreviewAnimationFrameId = window.requestAnimationFrame(tick);
  };

  sessionHoverPreviewAnimationFrameId = window.requestAnimationFrame(tick);
}

function stopSessionHoverPreview() {
  clearSessionHoverPreviewTimer();
  sessionHoverPreviewRequestToken += 1;
  sessionHoverPreviewSessionId = null;
  sessionHoverPreviewClipStartSeconds = 0;
  sessionHoverPreviewClipEndSeconds = 0;
  sessionHoverPreviewTotalSeconds = 0;
  stopSessionHoverPreviewProgressLoop();

  if (sessionHoverPreviewThumbElement) {
    sessionHoverPreviewThumbElement.classList.remove("reel-thumb-previewing");
    sessionHoverPreviewThumbElement.style.removeProperty("--reel-thumb-progress");
    sessionHoverPreviewThumbElement = null;
  }
  if (sessionHoverPreviewTimeElement) {
    sessionHoverPreviewTimeElement.textContent = "";
    sessionHoverPreviewTimeElement = null;
  }

  sessionHoverPreviewVideo.pause();
  if (sessionHoverPreviewVideo.parentElement) {
    sessionHoverPreviewVideo.parentElement.removeChild(sessionHoverPreviewVideo);
  }
  sessionHoverPreviewVideo.removeAttribute("src");
  sessionHoverPreviewVideo.removeAttribute("poster");
  sessionHoverPreviewVideo.load();
}

async function startSessionHoverPreview(sessionId, thumbElement, requestToken, fallbackDurationSeconds = 0) {
  try {
    const playback = await getSessionPlayback(sessionId);
    if (requestToken !== sessionHoverPreviewRequestToken || !thumbElement.isConnected) {
      return;
    }

    if (sessionHoverPreviewThumbElement && sessionHoverPreviewThumbElement !== thumbElement) {
      sessionHoverPreviewThumbElement.classList.remove("reel-thumb-previewing");
      sessionHoverPreviewThumbElement.style.removeProperty("--reel-thumb-progress");
      const previousTimeElement = sessionHoverPreviewThumbElement.querySelector(".reel-thumb-time");
      if (previousTimeElement) {
        previousTimeElement.textContent = "";
      }
    }

    sessionHoverPreviewThumbElement = thumbElement;
    sessionHoverPreviewTimeElement = thumbElement.querySelector(".reel-thumb-time");
    sessionHoverPreviewSessionId = sessionId;
    sessionHoverPreviewVideo.poster = sessionThumbnailCache.get(sessionId) || "";

    if (sessionHoverPreviewVideo.parentElement !== thumbElement) {
      thumbElement.append(sessionHoverPreviewVideo);
    }

    if (sessionHoverPreviewVideo.src !== playback.mediaUrl) {
      sessionHoverPreviewVideo.pause();
      sessionHoverPreviewVideo.src = playback.mediaUrl;
      sessionHoverPreviewVideo.load();
    }

    await waitForVideoMetadata(sessionHoverPreviewVideo);
    sessionHoverPreviewTotalSeconds = resolveSessionHoverPreviewTotalSeconds(fallbackDurationSeconds);
    const previewDurationSeconds =
      sessionHoverPreviewTotalSeconds > 0
        ? sessionHoverPreviewTotalSeconds
        : SESSION_HOVER_PREVIEW_CLIP_DURATION_SECONDS;
    const previewStartTime = computeThumbnailCaptureTimes(previewDurationSeconds)[0] || 0;
    const previewEndTime = Math.min(
      previewDurationSeconds,
      previewStartTime + SESSION_HOVER_PREVIEW_CLIP_DURATION_SECONDS,
    );
    sessionHoverPreviewClipStartSeconds = previewStartTime;
    sessionHoverPreviewClipEndSeconds = Math.max(previewStartTime + 0.2, previewEndTime);
    await seekVideoFrame(sessionHoverPreviewVideo, previewStartTime);

    if (requestToken !== sessionHoverPreviewRequestToken || !thumbElement.isConnected) {
      return;
    }

    setSessionHoverPreviewProgress(0);
    setSessionHoverPreviewTimeLabel(0, sessionHoverPreviewTotalSeconds);
    thumbElement.classList.add("reel-thumb-previewing");
    await sessionHoverPreviewVideo.play();
    startSessionHoverPreviewProgressLoop();
  } catch {
    thumbElement.classList.remove("reel-thumb-previewing");
    thumbElement.style.removeProperty("--reel-thumb-progress");
    const timeElement = thumbElement.querySelector(".reel-thumb-time");
    if (timeElement) {
      timeElement.textContent = "";
    }
    if (sessionHoverPreviewTimeElement && sessionHoverPreviewTimeElement === timeElement) {
      sessionHoverPreviewTimeElement = null;
    }
    sessionHoverPreviewTotalSeconds = 0;
    stopSessionHoverPreviewProgressLoop();
  }
}

function scheduleSessionHoverPreview(sessionId, thumbElement, fallbackDurationSeconds = 0) {
  if (!thumbElement) {
    return;
  }

  if (sessionHoverPreviewSessionId === sessionId && sessionHoverPreviewThumbElement === thumbElement) {
    return;
  }

  clearSessionHoverPreviewTimer();
  sessionHoverPreviewRequestToken += 1;
  const requestToken = sessionHoverPreviewRequestToken;
  sessionHoverPreviewPendingSessionId = sessionId;
  sessionHoverPreviewPendingThumbElement = thumbElement;

  sessionHoverPreviewTimerId = window.setTimeout(() => {
    sessionHoverPreviewTimerId = null;
    sessionHoverPreviewPendingSessionId = null;
    sessionHoverPreviewPendingThumbElement = null;
    void startSessionHoverPreview(sessionId, thumbElement, requestToken, fallbackDurationSeconds);
  }, SESSION_HOVER_PREVIEW_DELAY_MS);
}

function bindSessionHoverPreview(rootElement, session, thumbElement) {
  if (!rootElement || !thumbElement) {
    return;
  }

  const sessionId = session?.id;
  if (!sessionId) {
    return;
  }
  const fallbackDurationSeconds = getSessionDurationMs(session) / 1000;

  rootElement.addEventListener("pointerenter", () => {
    void ensureSessionThumbnail(sessionId);
    scheduleSessionHoverPreview(sessionId, thumbElement, fallbackDurationSeconds);
  });

  rootElement.addEventListener("pointerleave", () => {
    if (sessionHoverPreviewThumbElement === thumbElement || sessionHoverPreviewSessionId === sessionId) {
      stopSessionHoverPreview();
      return;
    }
    if (
      sessionHoverPreviewPendingSessionId === sessionId &&
      sessionHoverPreviewPendingThumbElement === thumbElement
    ) {
      clearSessionHoverPreviewTimer();
    }
  });
}

function waitForVideoFrame(video) {
  return new Promise((resolve) => {
    let settled = false;

    function finish() {
      if (settled) {
        return;
      }
      settled = true;
      window.requestAnimationFrame(() => resolve());
    }

    if (typeof video.requestVideoFrameCallback === "function") {
      video.requestVideoFrameCallback(() => {
        finish();
      });
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        finish();
      });
    });
  });
}

function analyzeThumbnailFrame(canvas) {
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = 32;
  sampleCanvas.height = 18;
  const sampleContext = sampleCanvas.getContext("2d");
  if (!sampleContext) {
    return { isMostlyBlack: false };
  }

  sampleContext.drawImage(canvas, 0, 0, sampleCanvas.width, sampleCanvas.height);
  const { data } = sampleContext.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height);
  let nearBlackPixels = 0;
  const pixelCount = data.length / 4;

  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset] < 16 && data[offset + 1] < 16 && data[offset + 2] < 16) {
      nearBlackPixels += 1;
    }
  }

  return {
    isMostlyBlack: pixelCount > 0 && nearBlackPixels / pixelCount >= 0.94,
  };
}

function captureThumbnailFrame(video) {
  const width = Math.max(video.videoWidth || 320, 1);
  const height = Math.max(video.videoHeight || 180, 1);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas context unavailable.");
  }

  context.drawImage(video, 0, 0, width, height);

  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.78),
    ...analyzeThumbnailFrame(canvas),
  };
}

function captureVideoThumbnail(mediaUrl) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Thumbnail capture timed out."));
    }, 8000);
    let settled = false;

    function cleanup() {
      window.clearTimeout(timeoutId);
      video.pause();
      video.removeAttribute("src");
      video.load();
    }

    function finish(fn) {
      if (settled) {
        return;
      }
      settled = true;
      try {
        fn();
      } finally {
        cleanup();
      }
    }

    function fail(message) {
      finish(() => {
        reject(new Error(message));
      });
    }

    async function seekVideo(timeSeconds) {
      if (Math.abs(video.currentTime - timeSeconds) < 0.02) {
        await waitForVideoFrame(video);
        return;
      }

      await new Promise((resolveSeek, rejectSeek) => {
        const onSeeked = () => {
          cleanupListeners();
          resolveSeek();
        };
        const onError = () => {
          cleanupListeners();
          rejectSeek(new Error("Unable to seek session media for thumbnail generation."));
        };
        const cleanupListeners = () => {
          video.removeEventListener("seeked", onSeeked);
          video.removeEventListener("error", onError);
        };

        video.addEventListener("seeked", onSeeked, { once: true });
        video.addEventListener("error", onError, { once: true });
        video.currentTime = timeSeconds;
      });

      await waitForVideoFrame(video);
    }

    async function startCapture() {
      try {
        if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
          await new Promise((resolveLoaded, rejectLoaded) => {
            const onLoaded = () => {
              cleanupListeners();
              resolveLoaded();
            };
            const onError = () => {
              cleanupListeners();
              rejectLoaded(new Error("Unable to load session media for thumbnail generation."));
            };
            const cleanupListeners = () => {
              video.removeEventListener("loadedmetadata", onLoaded);
              video.removeEventListener("error", onError);
            };

            video.addEventListener("loadedmetadata", onLoaded, { once: true });
            video.addEventListener("error", onError, { once: true });
          });
        }

        const captureTimes = computeThumbnailCaptureTimes(video.duration);
        let fallbackThumbnail = null;

        for (const captureTime of captureTimes) {
          await seekVideo(captureTime);
          const candidate = captureThumbnailFrame(video);
          fallbackThumbnail = candidate.dataUrl;
          if (!candidate.isMostlyBlack) {
            finish(() => {
              resolve(candidate.dataUrl);
            });
            return;
          }
        }

        if (fallbackThumbnail) {
          finish(() => {
            resolve(fallbackThumbnail);
          });
          return;
        }

        fail("Unable to extract a video frame for thumbnail generation.");
      } catch (error) {
        finish(() => {
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      }
    }

    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;

    video.addEventListener("error", () => {
      fail("Unable to load session media for thumbnail generation.");
    });

    video.src = mediaUrl;
    video.load();
    void startCapture();
  });
}

async function ensureSessionThumbnail(sessionId) {
  if (sessionThumbnailCache.has(sessionId) || sessionThumbnailInflight.has(sessionId)) {
    return;
  }

  let resolvePending = () => undefined;
  const pending = new Promise((resolve) => {
    resolvePending = resolve;
  });

  sessionThumbnailInflight.set(sessionId, pending);
  sessionThumbnailQueue.push({ sessionId, resolve: resolvePending });
  pumpSessionThumbnailQueue();
}

function pumpSessionThumbnailQueue() {
  while (sessionThumbnailActiveCount < SESSION_THUMBNAIL_MAX_CONCURRENT && sessionThumbnailQueue.length > 0) {
    const nextTask = sessionThumbnailQueue.shift();
    if (!nextTask) {
      return;
    }

    sessionThumbnailActiveCount += 1;

    void (async () => {
      const { sessionId, resolve } = nextTask;
      let shouldRefresh = false;
      try {
        if (!getTrackedSessionThumbnailIds().has(sessionId)) {
          return;
        }

        const playback = await window.coview.getSessionMediaPlayback(sessionId);
        const thumbnailUrl = await captureVideoThumbnail(playback.mediaUrl);

        if (getTrackedSessionThumbnailIds().has(sessionId)) {
          sessionThumbnailCache.set(sessionId, thumbnailUrl);
          shouldRefresh = true;
        }
      } catch {
        if (getTrackedSessionThumbnailIds().has(sessionId)) {
          sessionThumbnailCache.set(sessionId, null);
          shouldRefresh = true;
        }
      } finally {
        sessionThumbnailInflight.delete(sessionId);
        sessionThumbnailActiveCount = Math.max(0, sessionThumbnailActiveCount - 1);
        resolve();

        if (shouldRefresh) {
          if (getVisibleReelSessions().some((session) => session.id === sessionId)) {
            renderSessionReel();
          }
          if (visibleSessions.some((session) => session.id === sessionId)) {
            renderSessionResults();
          }
        }

        pumpSessionThumbnailQueue();
      }
    })();
  }
}

function log(message, isError = false) {
  const timestamp = new Date().toLocaleTimeString();
  const line = `[${timestamp}] ${message}`;
  activityLog.textContent = `${line}\n${activityLog.textContent}`.trim();
  if (isError) {
    activityLog.classList.add("error");
  } else {
    activityLog.classList.remove("error");
  }
}

async function refreshTelemetryPanel(maxLines = 80) {
  const [logPath, lines] = await Promise.all([
    window.coview.getTelemetryLogPath(),
    window.coview.getTelemetryLogTail(maxLines),
  ]);
  telemetryPath.textContent = logPath;
  telemetryLog.textContent =
    lines.length > 0
      ? lines.map((line) => formatTelemetryLine(line)).join("\n")
      : "No telemetry entries yet.";
}

function renderDiagnosticsCard(title, ready, details, available) {
  const card = document.createElement("article");
  card.className = "diagnostic-card";
  const safeDetails = details.filter((detail) => detail && detail.trim().length > 0);
  card.innerHTML = `
    <div class="diagnostic-head">
      <strong>${title}</strong>
      <span class="diagnostic-status ${toDiagnosticsStatusClass(ready)}">${toDiagnosticsStatusLabel(ready, available)}</span>
    </div>
    <div class="diagnostic-details">
      ${safeDetails.map((detail) => `<span>${detail}</span>`).join("")}
    </div>
  `;
  return card;
}

function updateTranscriptionTestUi() {
  if (!selectedSessionDetail) {
    transcriptionTestTarget.textContent = "Select a session in Knowledge.";
    runTranscriptionTestButton.disabled = true;
    return;
  }

  if (isSelectedSessionProcessingBusy()) {
    transcriptionTestTarget.textContent = `Target busy: ${selectedSessionDetail.title || selectedSessionDetail.id}`;
    runTranscriptionTestButton.disabled = true;
    return;
  }

  transcriptionTestTarget.textContent = `Target: ${selectedSessionDetail.title || selectedSessionDetail.id}`;
  runTranscriptionTestButton.disabled = false;
}

function renderTranscriptionDiagnostics() {
  transcriptionDiagnosticsGrid.innerHTML = "";
  updateTranscriptionSetupSummary();

  if (!transcriptionDiagnostics) {
    transcriptionDiagnosticsSummary.textContent = "Diagnostics have not been loaded yet.";
    updateTranscriptionTestUi();
    return;
  }

  transcriptionDiagnosticsSummary.textContent = `${transcriptionDiagnostics.autoStrategy.summary} Last checked ${formatDateTime(transcriptionDiagnostics.checkedAt)}.`;

  const cards = [
    renderDiagnosticsCard(
      "Local whisper-cli",
      transcriptionDiagnostics.whisperCli.ready,
      [
        `Installed: ${transcriptionDiagnostics.whisperCli.available ? "yes" : "no"}`,
        `Command: ${transcriptionDiagnostics.whisperCli.commandPath || "-"}`,
        `Runtime source: ${transcriptionDiagnostics.whisperCli.source || "-"}`,
        `Configured model: ${transcriptionDiagnostics.whisperCli.modelPath || "not set"}`,
        `Local file exists: ${transcriptionDiagnostics.whisperCli.modelExists ? "yes" : "no"}`,
      ],
      transcriptionDiagnostics.whisperCli.available,
    ),
    renderDiagnosticsCard(
      "Local Python whisper",
      transcriptionDiagnostics.whisperPython.ready,
      [
        `Installed: ${transcriptionDiagnostics.whisperPython.available ? "yes" : "no"}`,
        `Command: ${transcriptionDiagnostics.whisperPython.commandPath || "-"}`,
      ],
      transcriptionDiagnostics.whisperPython.available,
    ),
    renderDiagnosticsCard(
      "ffmpeg",
      transcriptionDiagnostics.ffmpeg.available,
      [
        `Installed: ${transcriptionDiagnostics.ffmpeg.available ? "yes" : "no"}`,
        `Command: ${transcriptionDiagnostics.ffmpeg.commandPath || "-"}`,
      ],
      transcriptionDiagnostics.ffmpeg.available,
    ),
    renderDiagnosticsCard(
      "Auto strategy",
      transcriptionDiagnostics.autoStrategy.ready,
      [
        `Attempt order: ${
          transcriptionDiagnostics.autoStrategy.attemptOrder.length > 0
            ? transcriptionDiagnostics.autoStrategy.attemptOrder.join(" -> ")
            : "none"
        }`,
        `First ready provider: ${transcriptionDiagnostics.autoStrategy.firstReadyProvider || "-"}`,
      ],
      transcriptionDiagnostics.autoStrategy.ready,
    ),
  ];

  cards.forEach((card) => {
    transcriptionDiagnosticsGrid.append(card);
  });

  if (transcriptionSetupDialog.open) {
    renderTranscriptionSetupDialog();
  }
  updateTranscriptionTestUi();
}

async function loadTranscriptionDiagnostics() {
  transcriptionDiagnostics = await window.coview.getTranscriptionDiagnostics();
  renderTranscriptionDiagnostics();
}

function setButtons() {
  const isRecording = Boolean(activeRecording);
  startButton.disabled = isRecording;
  stopButton.disabled = !isRecording;
  pauseButton.disabled = !isRecording;
  if (!isRecording) {
    pauseButton.textContent = "Pause";
    updateTransportDeckUi();
    syncTransportTelemetryLoop();
    return;
  }
  pauseButton.textContent = activeRecording.isPaused ? "Resume" : "Pause";
  updateTransportDeckUi();
  syncTransportTelemetryLoop();
}

function setSessionDetailEnabled(enabled) {
  detailTitleInput.disabled = !enabled;
  detailSummaryInput.disabled = !enabled;
  detailTopicsInput.disabled = !enabled;
  detailKeywordsInput.disabled = !enabled;
  detailTranscriptInput.disabled = !enabled;
  replaySessionButton.disabled = !enabled;
  saveDetailButton.disabled = !enabled || !sessionDetailDirty;
  exportMdButton.disabled = !enabled;
  exportTxtButton.disabled = !enabled;
  exportJsonButton.disabled = !enabled;
  deleteSessionButton.disabled = !enabled;
  setRetranscriptionControlsEnabled(enabled);
}

function clearSessionDetail() {
  selectedSessionDetail = null;
  selectedSessionId = null;
  sessionDetailBaseline = null;
  activeTranscriptSegmentIndex = -1;
  detailSessionId.textContent = "-";
  detailSource.textContent = "-";
  detailStartedAt.textContent = "-";
  detailEndedAt.textContent = "-";
  detailStatus.textContent = "-";
  detailTitleInput.value = "";
  detailSummaryInput.value = "";
  detailTopicsInput.value = "";
  detailKeywordsInput.value = "";
  detailTranscriptInput.value = "";
  clearSessionPlayer();
  renderTimestampedTranscript(null);
  detailTranscriptionMeta.textContent = "No transcript metadata yet.";
  transcriptionTestOutput.textContent = "No test run yet.";
  resetRetranscriptionControls();
  setSessionDetailEnabled(false);
  setSessionDetailDirtyState(false);
  renderSessionReel();
  renderSessionResults();
  updateTranscriptionTestUi();
}

function updateAutoUi() {
  if (!appSettings) {
    autoState.textContent = "Loading...";
    toggleAutoButton.textContent = "Loading...";
    inactivityTimeout.textContent = "...";
    inactivityTimeoutInput.value = "";
    aiProcessingEnabledCheckbox.checked = false;
    aiProcessingEnabledCheckbox.disabled = true;
    updateTransportDeckUi();
    return;
  }

  autoState.textContent = appSettings.autoRecordEnabled ? "Enabled" : "Disabled";
  toggleAutoButton.textContent = appSettings.autoRecordEnabled
    ? "Disable Auto Recording"
    : "Enable Auto Recording";
  inactivityTimeout.textContent = `${appSettings.inactivityTimeoutMinutes} minutes`;
  inactivityTimeoutInput.value = String(appSettings.inactivityTimeoutMinutes);
  aiProcessingEnabledCheckbox.disabled = false;
  aiProcessingEnabledCheckbox.checked = appSettings.aiProcessingEnabled;
  updateTransportDeckUi();
}

function updateHotkeyInputs() {
  if (!appSettings) {
    return;
  }
  hotkeyStartStopInput.value = appSettings.hotkeys.startStop;
  hotkeyPauseResumeInput.value = appSettings.hotkeys.pauseResume;
  hotkeyAutoToggleInput.value = appSettings.hotkeys.autoToggle;
}

function updateSlackSignalText(signal) {
  if (!appSettings?.autoRecordEnabled) {
    slackSignal.textContent = "Auto disabled";
    return;
  }

  if (!signal.isRunning) {
    slackSignal.textContent = "Slack not running";
    return;
  }

  if (signal.callHintActive) {
    const hints = signal.callHints.length > 0 ? signal.callHints.join(" | ") : "window hint";
    slackSignal.textContent = `Call likely active (${hints})`;
    return;
  }

  slackSignal.textContent = "Slack running (no call hint)";
}

function renderProcessingJobs() {
  jobsList.innerHTML = "";

  if (processingJobs.length === 0) {
    const empty = document.createElement("p");
    empty.className = "jobs-empty";
    empty.textContent = "No processing jobs yet. Record a call to start transcription.";
    jobsList.append(empty);
    return;
  }

  for (const job of processingJobs) {
    const card = document.createElement("article");
    card.className = "job-card";

    const statusClass = `status-${job.status}`;
    card.innerHTML = `
      <div class="job-head">
        <strong class="job-title">${job.title || job.sessionId}</strong>
        <span class="job-status ${statusClass}">${job.status}</span>
      </div>
      <div class="job-meta">
        <span>Kind: ${job.jobKind || "initial"}</span>
        <span>Attempts: ${job.attemptCount}</span>
        <span>Updated: ${formatDateTime(job.updatedAt)}</span>
      </div>
      <div class="job-details">
        <span>Requested provider: ${job.requestedProvider || "auto"}</span>
        <span>Requested language: ${job.requestedLanguage || "en"}</span>
        <span>Requested model: ${job.requestedModel || "default"}</span>
        ${
          job.status === "done"
            ? `
          <span>Provider: ${job.transcriptProvider || "-"}</span>
          <span>Model: ${job.transcriptModel || "-"}</span>
          <span>Language: ${job.transcriptLanguage || "-"}</span>
          <span>Transcript chars: ${job.transcriptChars ?? "-"}</span>
          <p class="job-summary">${job.summaryPreview || ""}</p>
        `
            : ""
        }
        ${
          job.status === "failed"
            ? `
          <p class="job-error">${job.errorMessage || "Unknown processing error."}</p>
          <button class="retry-job" data-job-id="${job.id}" type="button">Retry Job</button>
        `
            : ""
        }
      </div>
    `;

    jobsList.append(card);
  }

  jobsList.querySelectorAll(".retry-job").forEach((button) => {
    button.addEventListener("click", () => {
      const jobId = button.getAttribute("data-job-id");
      if (!jobId) {
        return;
      }

      void withButtonLoading(button, async () => {
        try {
          await window.coview.retryProcessingJob(jobId);
          log(`Retry queued for job ${jobId}.`);
        } catch (error) {
          log(`Failed to retry job ${jobId}: ${toErrorMessage(error)}`, true);
        }
      });
    });
  });

  updateTranscriptionTestUi();
}

function renderSessionReel() {
  if (sessionHoverPreviewThumbElement && !sessionHoverPreviewThumbElement.isConnected) {
    stopSessionHoverPreview();
  }
  sessionReel.innerHTML = "";
  const reelSessions = getVisibleReelSessions();
  pruneSessionThumbnailCache();

  reelCount.textContent = `${recentSessions.length} session${recentSessions.length === 1 ? "" : "s"}`;

  if (reelSessions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "sessions-empty";
    empty.textContent = "No recordings yet.";
    sessionReel.append(empty);
    return;
  }

  const maxDurationMs = reelSessions.reduce((currentMax, session) => {
    return Math.max(currentMax, getSessionDurationMs(session));
  }, 1000);

  reelSessions.forEach((session) => {
    void ensureSessionThumbnail(session.id);

    const durationMs = getSessionDurationMs(session);
    const progressPercent = Math.max(14, Math.round((durationMs / maxDurationMs) * 100));
    const summaryText = truncateText(session.summary || session.transcriptSnippet || "No summary yet.", 120);
    const thumbnailUrl = sessionThumbnailCache.get(session.id);
    const item = document.createElement("article");
    item.className = "reel-item";
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.setAttribute("aria-label", `Open session ${session.title}`);
    item.style.setProperty("--reel-progress", `${progressPercent}%`);
    if (session.id === selectedSessionId) {
      item.classList.add("reel-item-active");
    }
    if (!thumbnailUrl) {
      item.classList.add("reel-item-pending");
    }

    item.innerHTML = `
      ${renderSessionThumbnailMarkup(session, thumbnailUrl, {
        badges: [
          getSessionThumbnailProcessingBadge(session),
          { label: session.sourceName || "Capture", soft: true },
        ],
      })}
      <div class="reel-item-head">
        <strong>${escapeHtml(session.title)}</strong>
        ${session.id === selectedSessionId ? '<span class="reel-selected">Selected</span>' : ""}
      </div>
      <p class="reel-item-time">${formatCompactDateTime(session.startedAt)}</p>
      <p class="reel-item-summary">${escapeHtml(summaryText || "-")}</p>
      <div class="reel-track">
        <div class="reel-track-meta">
          <span>${formatDurationMs(durationMs)}</span>
          <span>${session.id === selectedSessionId ? "Open in detail" : "Open session"}</span>
        </div>
        <div class="reel-track-bar">
          <div class="reel-track-fill"></div>
        </div>
      </div>
    `;

    const thumbElement = item.querySelector(".reel-thumb");
    bindSessionHoverPreview(item, session, thumbElement);

    const openSession = async () => {
      stopSessionHoverPreview();
      activateTab("media");
      await selectSession(session.id);
    };

    item.addEventListener("click", () => {
      void openSession();
    });
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void openSession();
      }
    });
    sessionReel.append(item);
  });
}

function renderSessionResults() {
  if (sessionHoverPreviewThumbElement && !sessionHoverPreviewThumbElement.isConnected) {
    stopSessionHoverPreview();
  }
  sessionsList.innerHTML = "";
  pruneSessionThumbnailCache();

  if (visibleSessions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "sessions-empty";
    empty.textContent = "No sessions found.";
    sessionsList.append(empty);
    return;
  }

  for (const session of visibleSessions) {
    void ensureSessionThumbnail(session.id);

    const card = document.createElement("article");
    card.className = "session-card";
    if (session.id === selectedSessionId) {
      card.classList.add("session-card-active");
    }

    const topics = session.topics.length > 0 ? session.topics.slice(0, 3).join(", ") : "-";
    const keywords = session.keywords.length > 0 ? session.keywords.slice(0, 4).join(", ") : "-";
    const searchInfo =
      typeof session.score === "number"
        ? `<span>Score: ${session.score.toFixed(2)} (${escapeHtml(formatSearchModeLabel(session.matchType || "both"))})</span>`
        : "";
    const summaryText = escapeHtml(session.summary || session.transcriptSnippet || "-");
    const topicsText = escapeHtml(topics);
    const keywordsText = escapeHtml(keywords);
    const durationText = formatDurationMs(getSessionDurationMs(session));
    const thumbnailUrl = sessionThumbnailCache.get(session.id);

    if (!thumbnailUrl) {
      card.classList.add("session-card-pending");
    }

    card.innerHTML = `
      ${renderSessionThumbnailMarkup(session, thumbnailUrl, {
        rootClassName: "reel-thumb session-card-thumb",
        badges: [
          { label: session.sourceName || "Capture" },
          { label: durationText, soft: true },
        ],
      })}
      <div class="session-head">
        <strong>${escapeHtml(session.title)}</strong>
        <span class="session-status">${escapeHtml(session.processingStatus)}</span>
      </div>
      <div class="session-meta">
        <span>${formatDateTime(session.startedAt)}</span>
        <span>${escapeHtml(session.sourceName || "Slack")}</span>
        ${searchInfo}
      </div>
      <p class="session-summary">${summaryText}</p>
      <div class="session-tags">
        <span><strong>Topics:</strong> ${topicsText}</span>
        <span><strong>Keywords:</strong> ${keywordsText}</span>
      </div>
      <div class="row">
        <button class="select-session" data-session-id="${escapeHtml(session.id)}" type="button">Open Session</button>
        <button class="delete-session-inline danger" data-session-id="${escapeHtml(session.id)}" type="button">Delete</button>
      </div>
    `;

    const thumbElement = card.querySelector(".reel-thumb");
    bindSessionHoverPreview(card, session, thumbElement);

    sessionsList.append(card);
  }

  sessionsList.querySelectorAll(".select-session").forEach((button) => {
    button.addEventListener("click", async () => {
      stopSessionHoverPreview();
      const sessionId = button.getAttribute("data-session-id");
      if (!sessionId) {
        return;
      }
      await selectSession(sessionId);
      activateTab("media");
    });
  });

  sessionsList.querySelectorAll(".delete-session-inline").forEach((button) => {
    button.addEventListener("click", () => {
      stopSessionHoverPreview();
      const sessionId = button.getAttribute("data-session-id");
      if (!sessionId) {
        return;
      }
      void withButtonLoading(button, () => deleteSessionById(sessionId));
    });
  });
}

function populateSessionDetail(detail) {
  selectedSessionDetail = detail;
  selectedSessionId = detail.id;
  activeTranscriptSegmentIndex = -1;
  detailSessionId.textContent = detail.id;
  detailSource.textContent = detail.sourceName || "Slack";
  detailStartedAt.textContent = formatDateTime(detail.startedAt);
  detailEndedAt.textContent = detail.endedAt ? formatDateTime(detail.endedAt) : "-";
  detailStatus.textContent = detail.processingStatus || "-";
  detailTitleInput.value = detail.title || "";
  detailSummaryInput.value = detail.summary || "";
  detailTopicsInput.value = detail.topics.join(", ");
  detailKeywordsInput.value = detail.keywords.join(", ");
  renderTimestampedTranscript(detail);
  detailTranscriptInput.value = detail.transcriptText || "";
  resetRetranscriptionControls(detail);
  transcriptionTestOutput.textContent = "No test run yet.";
  setSessionDetailEnabled(true);
  resetSessionDetailDraftBaseline();
  void loadSessionPlayback(detail.id);
  renderSessionReel();
  updateTranscriptionTestUi();
  renderSessionResults();
}

async function refreshActiveSessionDetail() {
  if (!selectedSessionId) {
    return;
  }
  if (sessionDetailDirty) {
    return;
  }
  try {
    const detail = await window.coview.getSessionDetail(selectedSessionId);
    if (!detail) {
      clearSessionDetail();
      await loadSessionsList();
      log("Selected session no longer exists.");
      return;
    }
    populateSessionDetail(detail);
  } catch (error) {
    log(`Failed to refresh selected session detail: ${toErrorMessage(error)}`, true);
  }
}

async function selectSession(sessionId) {
  if (selectedSessionId && selectedSessionId !== sessionId && !(await confirmDiscardSessionDetailDraft())) {
    return;
  }
  try {
    const detail = await window.coview.getSessionDetail(sessionId);
    if (!detail) {
      clearSessionDetail();
      await loadSessionsList();
      log("Session no longer exists.");
      return;
    }
    populateSessionDetail(detail);
  } catch (error) {
    log(`Failed to load session detail: ${toErrorMessage(error)}`, true);
  }
}

async function loadSessionsList() {
  sessionsList.textContent = "Loading...";
  const sessions = await window.coview.listSessions();
  recentSessions = sessions;
  visibleSessions = sessions;
  renderSessionReel();
  renderSessionResults();

  if (selectedSessionId) {
    const exists = visibleSessions.some((session) => session.id === selectedSessionId);
    if (!exists) {
      clearSessionDetail();
    }
  }
}

async function performSessionSearch() {
  const query = sessionSearchInput.value.trim();
  const mode = sessionSearchModeSelect.value;

  if (query.length === 0) {
    await loadSessionsList();
    return;
  }

  visibleSessions = await window.coview.searchSessions({
    query,
    mode,
  });
  renderSessionResults();
}

function stopTracks(stream) {
  if (!stream) {
    return;
  }
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function chooseMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];

  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }

  return "";
}

function mixAudio(displayStream, microphoneStream) {
  const displayTracks = displayStream.getAudioTracks();
  const microphoneTracks = microphoneStream ? microphoneStream.getAudioTracks() : [];
  const allTracks = [...displayTracks, ...microphoneTracks];

  if (allTracks.length === 0) {
    return { track: null, cleanup: async () => undefined };
  }

  if (allTracks.length === 1) {
    return { track: allTracks[0], cleanup: async () => undefined };
  }

  const audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();

  for (const track of allTracks) {
    const sourceNode = audioContext.createMediaStreamSource(new MediaStream([track]));
    sourceNode.connect(destination);
  }

  return {
    track: destination.stream.getAudioTracks()[0] ?? null,
    cleanup: async () => {
      await audioContext.close().catch(() => undefined);
    },
  };
}

function createAudioLevelMonitor(stream, onLevel, intervalMs = AUTO_SAMPLE_INTERVAL_MS) {
  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    return async () => undefined;
  }

  const audioContext = new AudioContext();
  const sourceStream = new MediaStream(audioTracks);
  const source = audioContext.createMediaStreamSource(sourceStream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  const samples = new Uint8Array(analyser.fftSize);
  const timer = setInterval(() => {
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const normalized = (samples[i] - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / samples.length);
    onLevel(rms, intervalMs);
  }, intervalMs);

  return async () => {
    clearInterval(timer);
    source.disconnect();
    analyser.disconnect();
    await audioContext.close().catch(() => undefined);
  };
}

async function detectSustainedAudio(stream) {
  return new Promise((resolve) => {
    let isDone = false;
    let activeMs = 0;
    let stopMonitor = async () => undefined;

    const finish = async (detected) => {
      if (isDone) {
        return;
      }
      isDone = true;
      clearTimeout(timeoutId);
      await stopMonitor();
      resolve(detected);
    };

    stopMonitor = createAudioLevelMonitor(stream, (level, intervalMs) => {
      if (level >= AUTO_AUDIO_THRESHOLD) {
        activeMs += intervalMs;
        if (activeMs >= AUTO_SUSTAINED_AUDIO_MS) {
          void finish(true);
        }
      } else {
        activeMs = 0;
      }
    });

    const timeoutId = setTimeout(() => {
      void finish(false);
    }, AUTO_PROBE_DURATION_MS);
  });
}

function getSourceName() {
  const option = sourceSelect.options[sourceSelect.selectedIndex];
  return option ? option.textContent || "capture" : "capture";
}

async function queryMicrophonePermission() {
  // Check mic permission without triggering a prompt
  try {
    const result = await navigator.permissions.query({ name: "microphone" });
    return result.state; // "granted", "denied", or "prompt"
  } catch {
    return "unknown";
  }
}

async function requestMicrophoneAccess() {
  // Actually request mic access (will show prompt if needed)
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) {
      track.stop();
    }
    return "granted";
  } catch (error) {
    if (error instanceof DOMException) {
      if (error.name === "NotAllowedError") {
        return "denied";
      }
      if (error.name === "NotFoundError") {
        return "no-device";
      }
    }
    return "unavailable";
  }
}

function formatPermissionLabel(value) {
  const labels = {
    granted: "Granted",
    denied: "Denied",
    prompt: "Not yet requested",
    restricted: "Restricted",
    "not-determined": "Not determined",
    available: "Available",
    "no-sources": "No sources found",
    "no-device": "No microphone found",
    unavailable: "Unavailable",
    unknown: "Unknown",
  };
  return labels[value] || value;
}

async function refreshPermissionStatus() {
  const status = await window.coview.getPermissionStatus();
  const isDarwin = status.platform === "darwin";

  let micStatus = status.microphone;
  if (micStatus === "probe-renderer") {
    micStatus = await queryMicrophonePermission();
  }

  const screenLabel = formatPermissionLabel(status.screen);
  const micLabel = formatPermissionLabel(micStatus);

  let hint = "";
  if (!isDarwin) {
    if (micStatus === "denied") {
      hint = "<br /><em>Microphone was denied. Check your system audio settings.</em>";
    } else if (micStatus === "prompt") {
      hint = '<br /><em>Click "Request Microphone" to grant access.</em>';
    } else if (status.screen === "no-sources") {
      hint = "<br /><em>No screen sources found. Your display server may not support capture.</em>";
    }
  }

  permissionStatus.innerHTML = `
    <strong>Microphone:</strong> ${micLabel}
    <br />
    <strong>Screen Recording:</strong> ${screenLabel}
    ${hint}
  `;

  // Hide macOS-only button on other platforms
  openScreenSettingsButton.style.display = isDarwin ? "" : "none";
}

async function loadStorageDir() {
  const dir = await window.coview.getStorageDir();
  storagePath.textContent = dir;
}

async function changeStorageLibrary() {
  if (activeRecording) {
    log("Stop the active recording before changing the active library.", true);
    return;
  }

  const selected = await window.coview.chooseStorageDir();
  if (!selected) {
    log("Storage library change canceled.");
    return;
  }

  if (appSettings?.storageDir && selected === appSettings.storageDir) {
    log("Storage library unchanged.");
    return;
  }

  const moveExistingLibrary = await showConfirmation(
    `Move the current library into "${selected}"?\n\nChoose OK to copy the current library there and switch after verification.\nChoose Cancel to decide whether to use the folder as a new empty library instead.`,
  );

  let mode = "move";
  if (!moveExistingLibrary) {
    const useEmptyLibrary = await showConfirmation(
      `Use "${selected}" as a new empty library?\n\nChoose OK to switch without moving the current sessions.\nChoose Cancel to keep the current library unchanged.`,
    );
    if (!useEmptyLibrary) {
      log("Storage library change canceled.");
      return;
    }
    mode = "empty";
  }

  const result = await window.coview.migrateLibraryStorage({
    nextStorageDir: selected,
    mode,
  });

  await loadSettings();
  await loadSessionsList();
  await loadProcessingJobs();

  if (mode === "move") {
    log(
      `Moved the active library to ${result.storageDir}. Verified ${result.verification.verifiedFiles}/${result.verification.expectedFiles} files.`,
    );
    if (result.previousStorageDir !== result.storageDir) {
      const cleanupPreviousLibrary = await showConfirmation(
        `Library migration succeeded.\n\nRemove the old library at "${result.previousStorageDir}" now?`,
      );
      if (cleanupPreviousLibrary) {
        await window.coview.cleanupLibraryStorage(result.previousStorageDir);
        log(`Removed the previous library at ${result.previousStorageDir}.`);
      } else {
        log(`Kept the previous library at ${result.previousStorageDir} for manual cleanup.`);
      }
    }
    return;
  }

  log(
    `Switched to a new empty library at ${result.storageDir}. The previous library is still available at ${result.previousStorageDir}.`,
  );
}

async function loadCaptureSources() {
  const sourceType = sourceTypeSelect.value;
  const sources = await window.coview.listCaptureSources(sourceType);

  sourceSelect.innerHTML = "";
  for (const source of sources) {
    const option = document.createElement("option");
    option.value = source.id;
    option.textContent = source.name;
    sourceSelect.append(option);
  }

  if (sources.length === 0) {
    log(`No capture sources found for type "${sourceType}".`, true);
    updateTransportDeckUi();
    return;
  }

  log(`Loaded ${sources.length} ${sourceType} sources.`);
  updateTransportDeckUi();
}

async function buildDisplayStream(sourceId, includeSystemAudio) {
  const desktopVideo = {
    mandatory: {
      chromeMediaSource: "desktop",
      chromeMediaSourceId: sourceId,
      maxFrameRate: 30,
    },
  };

  const desktopAudio = includeSystemAudio
    ? {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: sourceId,
        },
      }
    : false;

  return navigator.mediaDevices.getUserMedia({
    audio: desktopAudio,
    video: desktopVideo,
  });
}

async function resolveAutoProbeSourceId() {
  if (sourceTypeSelect.value === "screen" && sourceSelect.value) {
    return sourceSelect.value;
  }

  const screens = await window.coview.listCaptureSources("screen");
  if (screens.length > 0) {
    return screens[0].id;
  }

  return sourceSelect.value;
}

async function runAutoAudioProbe() {
  const probeSourceId = await resolveAutoProbeSourceId();
  if (!probeSourceId) {
    return false;
  }

  let probeStream = null;
  try {
    probeStream = await buildDisplayStream(probeSourceId, true);
    if (probeStream.getAudioTracks().length === 0) {
      return false;
    }
    return detectSustainedAudio(probeStream);
  } catch {
    return false;
  } finally {
    stopTracks(probeStream);
  }
}

function queueRecordingChunkPersist(recordingState, chunk) {
  recordingState.persistChain = recordingState.persistChain
    .then(async () => {
      if (recordingState.persistFailed || !chunk || chunk.size === 0) {
        return;
      }
      const buffer = await chunk.arrayBuffer();
      if (buffer.byteLength === 0) {
        return;
      }
      await window.coview.appendRecordingChunk({
        recordingSessionId: recordingState.recordingSessionId,
        data: buffer,
      });
    })
    .catch((error) => {
      recordingState.persistFailed = true;
      log(`Failed to persist a recording chunk: ${toErrorMessage(error)}`, true);
    });
}

async function finalizeRecording(recordingState) {
  if (recordingState.finalized) {
    return;
  }
  recordingState.finalized = true;

  if (maxDurationTimer) {
    clearTimeout(maxDurationTimer);
    maxDurationTimer = null;
  }

  try {
    log("Finalizing recording...");
    await recordingState.persistChain;
    const title = titleInput.value.trim() || recordingState.sourceName;
    const result = await window.coview.finishRecordingSession({
      recordingSessionId: recordingState.recordingSessionId,
      mimeType: recordingState.mimeType,
      metadata: {
        title,
        sourceName: recordingState.sourceName,
        startedAt: recordingState.startedAt,
        endedAt: new Date().toISOString(),
        screenMode: recordingState.sourceType,
        audioMode: recordingState.audioMode,
        autoTriggered: recordingState.isAutoTriggered,
        stopReason: recordingState.stopReason,
      },
    });
    if (result.droppedEmpty) {
      log("Dropped an obviously empty capture before adding it to the session timeline.");
    } else if (result.processingStatus === "disabled") {
      const setupHint =
        !appSettings?.aiProcessingEnabled && !transcriptionDiagnostics?.autoStrategy.ready
          ? " Finish Guided Setup in Settings to enable transcription."
          : "";
      log(
        `Saved recording (${result.bytesWritten} bytes) to ${result.mediaPath}. Local processing is disabled.${setupHint}`,
      );
    } else {
      log(
        `Saved recording (${result.bytesWritten} bytes) to ${result.mediaPath}. Processing job: ${result.processingJobId} (${result.processingStatus}).`,
      );
    }
    if (recordingState.persistFailed) {
      log(
        "One or more recording chunks failed to persist while capturing. Any recovered media was kept.",
        true,
      );
    }
    await loadSessionsList();
  } catch (error) {
    log(`Failed to save recording: ${toErrorMessage(error)}`, true);
  } finally {
    if (recordingState.stopLevelMonitor) {
      await recordingState.stopLevelMonitor();
    }
    stopTracks(recordingState.mixedStream);
    stopTracks(recordingState.displayStream);
    stopTracks(recordingState.microphoneStream);
    await recordingState.audioMixCleanup();
    activeRecording = null;
    setButtons();
  }
}

async function startRecording(options = { autoTriggered: false }) {
  if (activeRecording) {
    return;
  }

  const sourceId = sourceSelect.value;
  if (!sourceId) {
    log("Select a screen/window source before starting recording.", true);
    return;
  }

  const sourceType = sourceTypeSelect.value;
  const selectedAudioMode = audioModeSelect.value;
  const includeSystemAudio = selectedAudioMode === "system" || selectedAudioMode === "both";
  const includeMicrophone = selectedAudioMode === "mic" || selectedAudioMode === "both";
  const sourceName = getSourceName();
  const startedAt = new Date().toISOString();

  let displayStream = null;
  let microphoneStream = null;
  let mixedStream = null;
  let audioMixCleanup = async () => undefined;
  let recordingSessionId = null;

  try {
    const modeLabel = options.autoTriggered ? "auto" : "manual";
    log(
      `Starting ${modeLabel} capture from "${sourceName}" (${sourceType}, ${selectedAudioMode} audio).`,
    );

    displayStream = await buildDisplayStream(sourceId, includeSystemAudio);
    const hasSystemAudioTrack = displayStream.getAudioTracks().length > 0;
    const needsFallbackMic = includeSystemAudio && !hasSystemAudioTrack && !includeMicrophone;

    if (includeSystemAudio && !hasSystemAudioTrack) {
      log(
        "System audio is unavailable for this capture source on this platform. Falling back to microphone when possible.",
        true,
      );
    }

    if (includeMicrophone || needsFallbackMic) {
      try {
        microphoneStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
      } catch (error) {
        if (includeMicrophone) {
          throw error;
        }
        log(
          `Microphone fallback could not be enabled: ${toErrorMessage(error)}. Continuing without audio.`,
          true,
        );
      }
    }

    const hasMicrophoneTrack =
      Boolean(microphoneStream) && microphoneStream.getAudioTracks().length > 0;
    const effectiveAudioMode = hasSystemAudioTrack && hasMicrophoneTrack
      ? "both"
      : hasSystemAudioTrack
        ? "system"
        : hasMicrophoneTrack
          ? "mic"
          : selectedAudioMode;

    if (includeSystemAudio && !hasSystemAudioTrack && hasMicrophoneTrack) {
      log("Recording with microphone audio only for this session.");
    }
    if (!hasSystemAudioTrack && !hasMicrophoneTrack) {
      log("No audio tracks detected. Recording video only.", true);
    }

    const mixedAudio = mixAudio(displayStream, microphoneStream);
    audioMixCleanup = mixedAudio.cleanup;
    const videoTracks = displayStream.getVideoTracks();
    const tracks = [...videoTracks];
    if (mixedAudio.track) {
      tracks.push(mixedAudio.track);
    }
    mixedStream = new MediaStream(tracks);

    const mimeType = chooseMimeType();
    const recorder = mimeType ? new MediaRecorder(mixedStream, { mimeType }) : new MediaRecorder(mixedStream);
    const effectiveMimeType = mimeType || "video/webm";
    const sessionStart = await window.coview.beginRecordingSession({
      mimeType: effectiveMimeType,
      metadata: {
        title: titleInput.value.trim() || sourceName,
        sourceName,
        startedAt,
        screenMode: sourceType,
        audioMode: effectiveAudioMode,
        autoTriggered: Boolean(options.autoTriggered),
      },
    });
    recordingSessionId = sessionStart.recordingSessionId;

    const recordingState = {
      recorder,
      recordingSessionId,
      mimeType: effectiveMimeType,
      startedAt,
      sourceName,
      sourceType,
      audioMode: effectiveAudioMode,
      displayStream,
      microphoneStream,
      mixedStream,
      audioMixCleanup,
      stopLevelMonitor: null,
      isAutoTriggered: Boolean(options.autoTriggered),
      isPaused: false,
      lastAudioActivityAt: Date.now(),
      autoStopCandidateSince: null,
      stopReason: options.autoTriggered ? "auto-start" : "manual-start",
      accumulatedDurationMs: 0,
      lastResumeAt: Date.now(),
      currentLevel: 0,
      hasAudio: mixedStream.getAudioTracks().length > 0,
      finalized: false,
      persistChain: Promise.resolve(),
      persistFailed: false,
    };

    recordingState.stopLevelMonitor = createAudioLevelMonitor(mixedStream, (level) => {
      recordingState.currentLevel = Math.max(level, recordingState.currentLevel * 0.62);
      if (level >= AUTO_AUDIO_THRESHOLD) {
        recordingState.lastAudioActivityAt = Date.now();
      }
    });

    activeRecording = recordingState;
    setButtons();

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        queueRecordingChunkPersist(recordingState, event.data);
      }
    };

    recorder.onerror = (event) => {
      const error = event.error?.message || "Unknown recording error";
      log(`Recorder error: ${error}`, true);
      void finalizeRecording(recordingState);
    };

    recorder.onstop = () => {
      void finalizeRecording(recordingState);
    };

    displayStream.getVideoTracks()[0]?.addEventListener(
      "ended",
      () => {
        if (activeRecording) {
          log("Screen/window sharing ended. Stopping recording.");
          void stopRecording("capture-ended", false);
        }
      },
      { once: true },
    );

    maxDurationTimer = setTimeout(() => {
      if (activeRecording === recordingState) {
        log("Maximum recording duration (4 hours) reached. Stopping.");
        void stopRecording("max-duration-reached", false);
      }
    }, MAX_RECORDING_DURATION_MS);

    recorder.start(1000);
    log("Recording started.");
  } catch (error) {
    if (recordingSessionId) {
      await window.coview.cancelRecordingSession(recordingSessionId).catch(() => undefined);
    }
    stopTracks(mixedStream);
    stopTracks(displayStream);
    stopTracks(microphoneStream);
    await audioMixCleanup();
    activeRecording = null;
    setButtons();
    log(`Failed to start recording: ${toErrorMessage(error)}`, true);
  }
}

async function stopRecording(stopReason, applyCooldown) {
  if (!activeRecording) {
    return;
  }
  if (applyCooldown) {
    manualStopCooldownUntil = Date.now() + MANUAL_STOP_COOLDOWN_MS;
  }
  activeRecording.stopReason = stopReason;
  if (activeRecording.recorder.state !== "inactive") {
    activeRecording.recorder.stop();
  } else {
    void finalizeRecording(activeRecording);
  }
}

async function togglePauseResume() {
  if (!activeRecording) {
    return;
  }

  if (activeRecording.recorder.state === "recording") {
    if (activeRecording.lastResumeAt !== null) {
      activeRecording.accumulatedDurationMs += Date.now() - activeRecording.lastResumeAt;
      activeRecording.lastResumeAt = null;
    }
    activeRecording.currentLevel = 0;
    activeRecording.recorder.pause();
    activeRecording.isPaused = true;
    log("Recording paused.");
    setButtons();
    return;
  }

  if (activeRecording.recorder.state === "paused") {
    activeRecording.recorder.resume();
    activeRecording.isPaused = false;
    activeRecording.lastAudioActivityAt = Date.now();
    activeRecording.lastResumeAt = Date.now();
    log("Recording resumed.");
    setButtons();
  }
}

async function loadSettings() {
  applySettings(await window.coview.getSettings());
}

async function updateSettings(patch) {
  applySettings(await window.coview.updateSettings(patch));
  return appSettings;
}

async function loadProcessingJobs() {
  processingJobs = await window.coview.listProcessingJobs();
  renderProcessingJobs();
}

async function toggleAutoRecording() {
  if (!appSettings) {
    return;
  }
  const nextValue = !appSettings.autoRecordEnabled;
  await updateSettings({
    autoRecordEnabled: nextValue,
  });
  log(`Auto recording ${nextValue ? "enabled" : "disabled"}.`);
}

async function saveInactivityTimeout() {
  const parsed = Number.parseInt(inactivityTimeoutInput.value, 10);
  if (!Number.isFinite(parsed)) {
    log("Inactivity timeout must be a whole number of minutes.", true);
    return;
  }
  if (parsed < 1 || parsed > 1440) {
    log("Inactivity timeout must be between 1 and 1440 minutes.", true);
    return;
  }

  await updateSettings({
    inactivityTimeoutMinutes: parsed,
  });
  log(`Inactivity timeout updated to ${parsed} minutes.`);
}

async function saveTranscriptionDefaults() {
  await updateSettings({
    transcriptionDefaults: {
      provider: settingsTranscriptionProviderSelect.value,
      model: settingsTranscriptionModelInput.value.trim() || undefined,
      language: resolveSettingsTranscriptionLanguage(),
    },
  });
  await loadTranscriptionDiagnostics();
  log("Transcription defaults updated.");
}

async function autoMonitorTick() {
  if (!appSettings?.autoRecordEnabled) {
    return;
  }
  if (autoTickInFlight) {
    return;
  }
  autoTickInFlight = true;

  try {
    const signal = await window.coview.getSlackActivitySignal();
    updateSlackSignalText(signal);

    const now = Date.now();
    if (now < manualStopCooldownUntil) {
      return;
    }

    if (!activeRecording) {
      if (!signal.isRunning || !signal.callHintActive) {
        return;
      }

      const hasSustainedAudio = await runAutoAudioProbe();
      if (!hasSustainedAudio) {
        return;
      }

      await startRecording({ autoTriggered: true });
      return;
    }

    if (!activeRecording.isAutoTriggered || activeRecording.isPaused) {
      return;
    }

    const hasRecentAudio = now - activeRecording.lastAudioActivityAt < AUTO_STOP_SILENCE_MS;
    if (signal.callHintActive || hasRecentAudio) {
      activeRecording.autoStopCandidateSince = null;
    } else if (activeRecording.autoStopCandidateSince === null) {
      activeRecording.autoStopCandidateSince = now;
    } else if (now - activeRecording.autoStopCandidateSince >= AUTO_STOP_SILENCE_MS) {
      log("Auto-stop: Slack call appears to have ended.");
      await stopRecording("auto-call-ended", false);
      return;
    }

    const inactivityWindowMs = appSettings.inactivityTimeoutMinutes * 60 * 1000;
    if (now - activeRecording.lastAudioActivityAt >= inactivityWindowMs) {
      log(
        `Auto-stop fallback triggered after ${appSettings.inactivityTimeoutMinutes} minutes of inactivity.`,
      );
      await stopRecording("auto-inactivity-fallback", false);
    }
  } catch (error) {
    log(`Auto monitor error: ${toErrorMessage(error)}`, true);
  } finally {
    autoTickInFlight = false;
  }
}

function startAutoMonitor() {
  if (autoMonitorTimer) {
    clearInterval(autoMonitorTimer);
  }
  autoMonitorTimer = setInterval(() => {
    void autoMonitorTick();
  }, AUTO_POLL_INTERVAL_MS);
  void autoMonitorTick();
}

function stopAutoMonitor() {
  if (!autoMonitorTimer) {
    return;
  }
  clearInterval(autoMonitorTimer);
  autoMonitorTimer = null;
}

function registerHotkeyListener() {
  hotkeyUnsubscribe = window.coview.onHotkeyAction((action) => {
    if (action === "start-stop") {
      if (activeRecording) {
        void stopRecording("manual-hotkey-stop", true);
      } else {
        void startRecording({ autoTriggered: false });
      }
      return;
    }

    if (action === "pause-resume") {
      void togglePauseResume();
      return;
    }

    if (action === "auto-toggle") {
      void toggleAutoRecording();
    }
  });
}

function registerProcessingListener() {
  processingUnsubscribe = window.coview.onProcessingJobsUpdated((jobs) => {
    processingJobs = jobs;
    renderProcessingJobs();
    void loadSessionsList();
    void refreshActiveSessionDetail();
  });
}

async function saveActiveSessionDetail() {
  if (!selectedSessionId) {
    return;
  }
  if (!sessionDetailDirty) {
    log("No session detail changes to save.");
    return;
  }

  try {
    const patch = {};
    const nextTopics = parseTagInput(detailTopicsInput.value);
    const nextKeywords = parseTagInput(detailKeywordsInput.value);

    if (detailTitleInput.value !== (selectedSessionDetail?.title || "")) {
      patch.title = detailTitleInput.value;
    }
    if (detailSummaryInput.value !== (selectedSessionDetail?.summary || "")) {
      patch.summary = detailSummaryInput.value;
    }
    if (JSON.stringify(nextTopics) !== JSON.stringify(selectedSessionDetail?.topics || [])) {
      patch.topics = nextTopics;
    }
    if (JSON.stringify(nextKeywords) !== JSON.stringify(selectedSessionDetail?.keywords || [])) {
      patch.keywords = nextKeywords;
    }
    if (detailTranscriptInput.value !== (selectedSessionDetail?.transcriptText || "")) {
      patch.transcriptText = detailTranscriptInput.value;
    }

    const updated = await window.coview.updateSessionDetail({
      sessionId: selectedSessionId,
      patch,
    });
    populateSessionDetail(updated);
    await loadSessionsList();
    log(`Saved edits for session ${selectedSessionId}.`);
  } catch (error) {
    log(`Failed to save session edits: ${toErrorMessage(error)}`, true);
  }
}

async function retranscribeActiveSession() {
  if (!selectedSessionId || !selectedSessionDetail) {
    return;
  }

  const sessionId = selectedSessionId;
  const sessionLabel = selectedSessionDetail.title || sessionId;
  const discardMessage = sessionDetailDirty
    ? ' You also have unsaved edits that will be discarded.'
    : "";
  const confirmed = await showConfirmation(
    `Re-transcribe session "${sessionLabel}"?\n\nThis replaces the transcript, summary, topics, and keywords with fresh local output.${discardMessage}`,
  );
  if (!confirmed) {
    return;
  }

  try {
    const result = await window.coview.retranscribeSession({
      sessionId,
      options: {
        provider: retranscribeProviderSelect.value,
        model: retranscribeModelInput.value.trim() || undefined,
        language: resolveRetranscriptionLanguage(),
      },
    });
    log(
      `Queued re-transcription for ${sessionId} using ${result.requestedProvider || "auto"} (${result.requestedLanguage || "en"}).`,
    );
    await loadProcessingJobs();
    const detail = await window.coview.getSessionDetail(sessionId);
    if (detail) {
      populateSessionDetail(detail);
    }
    await loadSessionsList();
  } catch (error) {
    log(`Failed to queue re-transcription: ${toErrorMessage(error)}`, true);
  }
}

async function runSelectedSessionTranscriptionTest() {
  if (!selectedSessionId || !selectedSessionDetail) {
    return;
  }

  runTranscriptionTestButton.disabled = true;
  transcriptionTestOutput.textContent = "Running transcription test...";

  try {
    const result = await window.coview.testSessionTranscription({
      sessionId: selectedSessionId,
      options: {
        provider: retranscribeProviderSelect.value,
        model: retranscribeModelInput.value.trim() || undefined,
        language: resolveRetranscriptionLanguage(),
      },
    });

    transcriptionTestOutput.textContent = [
      `Tested at: ${formatDateTime(result.testedAt)}`,
      `Session: ${result.sessionId}`,
      `Provider used: ${result.provider}`,
      `Model used: ${result.model}`,
      `Language: ${result.language}`,
      `Chars: ${result.transcriptChars}`,
      `Elapsed: ${(result.elapsedMs / 1000).toFixed(1)}s`,
      "",
      result.previewText || "(No transcript preview)",
    ].join("\n");
    log(
      `Transcription test completed for ${result.sessionId} with ${result.provider} in ${(result.elapsedMs / 1000).toFixed(1)}s.`,
    );
  } catch (error) {
    transcriptionTestOutput.textContent = `Test failed: ${toErrorMessage(error)}`;
    log(`Transcription test failed: ${toErrorMessage(error)}`, true);
  } finally {
    updateTranscriptionTestUi();
  }
}

async function exportActiveSession(format) {
  if (!selectedSessionId) {
    return;
  }

  try {
    const result = await window.coview.exportSession({
      sessionId: selectedSessionId,
      format,
    });
    log(`Exported ${format.toUpperCase()} to ${result.exportPath}`);
  } catch (error) {
    log(`Failed to export session: ${toErrorMessage(error)}`, true);
  }
}

async function replayActiveSession() {
  if (!selectedSessionId) {
    return;
  }

  try {
    const result = await window.coview.openSessionMedia(selectedSessionId);
    log(`Opened recording externally: ${result.mediaPath}`);
  } catch (error) {
    log(`Failed to open recording: ${toErrorMessage(error)}`, true);
  }
}

async function deleteSessionById(sessionId) {
  const session = visibleSessions.find((s) => s.id === sessionId) || recentSessions.find((s) => s.id === sessionId);
  const sessionLabel = session?.title || sessionId;
  const confirmed = await showConfirmation(
    `Delete session "${sessionLabel}"?\n\nThis removes its recording, metadata, transcript, analysis, and related jobs.`,
  );
  if (!confirmed) {
    return;
  }

  const isSelected = selectedSessionId === sessionId;
  if (isSelected) {
    setSessionDetailEnabled(false);
  }
  try {
    const result = await window.coview.deleteSession(sessionId);
    log(
      `Deleted session ${sessionId}. Removed ${result.removedPaths.length} files and ${result.removedJobs} jobs.`,
    );
    if (isSelected) {
      clearSessionDetail();
    }
    await loadProcessingJobs();
    await loadSessionsList();
  } catch (error) {
    log(`Failed to delete session ${sessionId}: ${toErrorMessage(error)}`, true);
    if (isSelected) {
      setSessionDetailEnabled(true);
    }
  }
}

async function deleteActiveSession() {
  if (!selectedSessionId) {
    return;
  }
  await deleteSessionById(selectedSessionId);
}

function registerUiEventHandlers() {
  refreshPermissionsButton.addEventListener("click", () => {
    void refreshPermissionStatus();
  });

  requestMicrophoneButton.addEventListener("click", async () => {
    const result = await window.coview.requestMicrophonePermission();
    if (result === "probe-renderer") {
      // On Linux, trigger the browser's getUserMedia prompt directly
      const micStatus = await requestMicrophoneAccess();
      const granted = micStatus === "granted";
      log(granted ? "Microphone permission granted." : `Microphone status: ${formatPermissionLabel(micStatus)}.`, !granted);
    } else {
      log(result ? "Microphone permission granted." : "Microphone permission not granted.", !result);
    }
    await refreshPermissionStatus();
  });

  openScreenSettingsButton.addEventListener("click", async () => {
    await window.coview.openScreenPermissionSettings();
    log("Opened macOS Screen Recording settings.");
  });

  chooseStorageButton.addEventListener("click", () => {
    void withButtonLoading(chooseStorageButton, () => changeStorageLibrary()).catch((error) => {
      log(`Failed to change the active library: ${toErrorMessage(error)}`, true);
    });
  });

  refreshJobsButton.addEventListener("click", () => {
    void loadProcessingJobs();
  });

  refreshTranscriptionDiagnosticsButton.addEventListener("click", () => {
    void loadTranscriptionDiagnostics().catch((error) => {
      transcriptionDiagnosticsSummary.textContent = `Failed to load diagnostics: ${toErrorMessage(error)}`;
      log(`Failed to load transcription diagnostics: ${toErrorMessage(error)}`, true);
    });
  });

  openTranscriptionSetupButton.addEventListener("click", () => {
    void withButtonLoading(openTranscriptionSetupButton, () => openTranscriptionSetupDialog()).catch((error) => {
      log(`Failed to open guided setup: ${toErrorMessage(error)}`, true);
    });
  });

  sourceTypeSelect.addEventListener("change", () => {
    void loadCaptureSources();
  });

  sourceSelect.addEventListener("change", () => {
    updateTransportDeckUi();
  });

  audioModeSelect.addEventListener("change", () => {
    updateTransportDeckUi();
  });

  startButton.addEventListener("click", () => {
    void startRecording({ autoTriggered: false });
  });

  stopButton.addEventListener("click", () => {
    void stopRecording("manual-stop", true);
  });

  pauseButton.addEventListener("click", () => {
    void togglePauseResume();
  });

  toggleAutoButton.addEventListener("click", () => {
    void toggleAutoRecording();
  });

  aiProcessingEnabledCheckbox.addEventListener("change", () => {
    const nextValue = aiProcessingEnabledCheckbox.checked;
    void (async () => {
      try {
        if (nextValue) {
          if (!transcriptionDiagnostics) {
            await loadTranscriptionDiagnostics();
          }
          if (!transcriptionDiagnostics?.autoStrategy.ready) {
            aiProcessingEnabledCheckbox.checked = false;
            await updateSettings({
              aiProcessingEnabled: false,
              transcriptionSetup: {
                status: "pending",
              },
            });
            transcriptionSetupResultMessage =
              "Finish guided setup before enabling local processing.";
            await openTranscriptionSetupDialog();
            log("Guided setup opened because local processing is not configured yet.");
            return;
          }

          await updateSettings({
            aiProcessingEnabled: true,
            transcriptionSetup: {
              status: "completed",
              modelPath: appSettings?.transcriptionDefaults?.model,
              modelId: appSettings?.transcriptionSetup?.modelId,
            },
          });
        } else {
          await updateSettings({
            aiProcessingEnabled: false,
          });
        }

        log(`Local processing ${nextValue ? "enabled" : "disabled"}.`);
      } catch (error) {
        aiProcessingEnabledCheckbox.checked = Boolean(appSettings?.aiProcessingEnabled);
        log(`Failed to update local processing setting: ${toErrorMessage(error)}`, true);
      }
    })();
  });

  settingsTranscriptionLanguageModeSelect.addEventListener("change", () => {
    updateSettingsTranscriptionLanguageUi();
  });

  settingsTranscriptionProviderSelect.addEventListener("change", () => {
    updateSettingsTranscriptionLanguageUi();
  });

  saveTranscriptionDefaultsButton.addEventListener("click", () => {
    void saveTranscriptionDefaults().catch((error) => {
      log(`Failed to update transcription defaults: ${toErrorMessage(error)}`, true);
    });
  });

  transcriptionModelRefreshButton.addEventListener("click", () => {
    void withButtonLoading(transcriptionModelRefreshButton, async () => {
      await Promise.all([loadTranscriptionDiagnostics(), loadTranscriptionModelLibrary()]);
      renderTranscriptionSetupDialog();
      log("Refreshed the local transcription model library.");
    }).catch((error) => {
      transcriptionSetupResultMessage = `Refresh failed: ${toErrorMessage(error)}`;
      renderTranscriptionSetupDialog();
      log(`Failed to refresh the transcription model library: ${toErrorMessage(error)}`, true);
    });
  });

  transcriptionSetupBrowseButton.addEventListener("click", () => {
    void withButtonLoading(transcriptionSetupBrowseButton, () => chooseExistingTranscriptionModel()).catch((error) => {
      transcriptionSetupResultMessage = `Setup failed: ${toErrorMessage(error)}`;
      renderTranscriptionSetupDialog();
      log(`Failed to configure an existing transcription model: ${toErrorMessage(error)}`, true);
    });
  });

  transcriptionSetupCloseButton.addEventListener("click", () => {
    void dismissTranscriptionSetup().catch((error) => {
      log(`Failed to dismiss guided setup: ${toErrorMessage(error)}`, true);
    });
  });

  transcriptionSetupDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    void dismissTranscriptionSetup().catch((error) => {
      log(`Failed to dismiss guided setup: ${toErrorMessage(error)}`, true);
    });
  });

  saveTimeoutButton.addEventListener("click", () => {
    void saveInactivityTimeout().catch((error) => {
      log(`Failed to update inactivity timeout: ${toErrorMessage(error)}`, true);
    });
  });

  inactivityTimeoutInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void saveInactivityTimeout().catch((error) => {
        log(`Failed to update inactivity timeout: ${toErrorMessage(error)}`, true);
      });
    }
  });

  saveHotkeysButton.addEventListener("click", async () => {
    try {
      await updateSettings({
        hotkeys: {
          startStop: hotkeyStartStopInput.value.trim(),
          pauseResume: hotkeyPauseResumeInput.value.trim(),
          autoToggle: hotkeyAutoToggleInput.value.trim(),
        },
      });
      log("Hotkeys updated.");
    } catch (error) {
      log(`Failed to update hotkeys: ${toErrorMessage(error)}`, true);
    }
  });

  sessionSearchButton.addEventListener("click", () => {
    void withButtonLoading(sessionSearchButton, () => performSessionSearch());
  });

  sessionSearchClearButton.addEventListener("click", () => {
    sessionSearchInput.value = "";
    void loadSessionsList();
  });

  sessionSearchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void performSessionSearch();
    }
  });

  [detailTitleInput, detailSummaryInput, detailTopicsInput, detailKeywordsInput, detailTranscriptInput]
    .forEach((input) => {
      input.addEventListener("input", () => {
        updateSessionDetailDirtyState();
      });
    });

  retranscribeLanguageModeSelect.addEventListener("change", () => {
    updateRetranscriptionLanguageUi();
  });

  retranscribeProviderSelect.addEventListener("change", () => {
    updateRetranscriptionLanguageUi();
  });

  sessionPlayer.addEventListener("error", () => {
    if (!selectedSessionId) {
      return;
    }
    activeTranscriptSegmentIndex = -1;
    updateActiveTranscriptSegment();
    sessionPlayerMeta.textContent = "Recording preview unavailable.";
    log("Recording preview failed to load for the selected session.", true);
  });

  sessionPlayer.addEventListener("loadedmetadata", () => {
    updateActiveTranscriptSegment();
  });

  sessionPlayer.addEventListener("timeupdate", () => {
    updateActiveTranscriptSegment();
  });

  sessionPlayer.addEventListener("seeked", () => {
    updateActiveTranscriptSegment();
  });

  detailTranscriptTimeline.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest("[data-start-ms]");
    if (!button) {
      return;
    }

    const startMs = Number(button.getAttribute("data-start-ms"));
    void seekSessionPlayerToTranscriptSegment(startMs);
  });

  saveDetailButton.addEventListener("click", () => {
    void withButtonLoading(saveDetailButton, () => saveActiveSessionDetail());
  });

  replaySessionButton.addEventListener("click", () => {
    void replayActiveSession();
  });

  retranscribeSessionButton.addEventListener("click", () => {
    void retranscribeActiveSession();
  });

  runTranscriptionTestButton.addEventListener("click", () => {
    void runSelectedSessionTranscriptionTest();
  });

  exportMdButton.addEventListener("click", () => {
    void withButtonLoading(exportMdButton, () => exportActiveSession("md"));
  });
  exportTxtButton.addEventListener("click", () => {
    void withButtonLoading(exportTxtButton, () => exportActiveSession("txt"));
  });
  exportJsonButton.addEventListener("click", () => {
    void withButtonLoading(exportJsonButton, () => exportActiveSession("json"));
  });
  deleteSessionButton.addEventListener("click", () => {
    void withButtonLoading(deleteSessionButton, () => deleteActiveSession());
  });

  refreshTelemetryButton.addEventListener("click", () => {
    void refreshTelemetryPanel().catch((error) => {
      log(`Failed to refresh telemetry: ${toErrorMessage(error)}`, true);
    });
  });

  openTelemetryDirButton.addEventListener("click", () => {
    void window.coview
      .openTelemetryLogDir()
      .then(() => {
        log("Opened local telemetry log folder.");
      })
      .catch((error) => {
        log(`Failed to open telemetry log folder: ${toErrorMessage(error)}`, true);
      });
  });
}

function registerRealtimeSubscriptions() {
  registerHotkeyListener();
  registerProcessingListener();
  registerTranscriptionModelDownloadListener();
}

function registerBeforeUnloadHandler() {
  window.addEventListener("beforeunload", (event) => {
    if (sessionDetailDirty) {
      event.preventDefault();
      return;
    }
    stopAutoMonitor();
    if (hotkeyUnsubscribe) {
      hotkeyUnsubscribe();
      hotkeyUnsubscribe = null;
    }
    if (processingUnsubscribe) {
      processingUnsubscribe();
      processingUnsubscribe = null;
    }
    if (transcriptionModelDownloadUnsubscribe) {
      transcriptionModelDownloadUnsubscribe();
      transcriptionModelDownloadUnsubscribe = null;
    }
  });
}

async function runInitialLoadSequence() {
  await refreshPermissionStatus();
  await loadSettings();
  await loadStorageDir();
  await loadCaptureSources();
  await loadProcessingJobs();
  try {
    await loadTranscriptionDiagnostics();
  } catch (error) {
    transcriptionDiagnosticsSummary.textContent = `Failed to load diagnostics: ${toErrorMessage(error)}`;
    log(`Failed to load transcription diagnostics: ${toErrorMessage(error)}`, true);
  }
  if (shouldPromptTranscriptionSetup() && !transcriptionSetupAutoPrompted) {
    try {
      await openTranscriptionSetupDialog({ auto: true });
      log("Guided transcription setup opened.");
    } catch (error) {
      log(`Failed to open guided setup: ${toErrorMessage(error)}`, true);
    }
  }
  await loadSessionsList();
  try {
    await refreshTelemetryPanel();
  } catch (error) {
    telemetryLog.textContent = `Failed to load telemetry: ${toErrorMessage(error)}`;
    log(`Failed to load telemetry: ${toErrorMessage(error)}`, true);
  }
}

async function bootstrap() {
  await bootstrapRenderer({
    ensureApi,
    setButtons,
    updateAutoUi,
    clearSessionDetail,
    registerTabNavigation,
    activateTab,
    registerUiEventHandlers,
    registerRealtimeSubscriptions,
    registerBeforeUnloadHandler,
    runInitialLoadSequence,
    startAutoMonitor,
    log,
  });
}

void bootstrap();
