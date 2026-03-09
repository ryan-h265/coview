import {
  desktopCapturer,
  dialog,
  ipcMain,
  shell,
  systemPreferences,
  type BrowserWindow,
  type OpenDialogOptions,
} from "electron";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  IPC_CHANNELS,
  type BeginRecordingSessionPayload,
  type BeginRecordingSessionResult,
  type CaptureSourceType,
  type DeleteLibraryResultPayload,
  type DeleteSessionResultPayload,
  type DownloadTranscriptionModelResult,
  type FinishRecordingSessionPayload,
  type FinishRecordingSessionResult,
  type OpenSessionMediaResultPayload,
  type PermissionStatusPayload,
  type ProcessingJobPayload,
  type RemoveTranscriptionModelResult,
  type SessionExportFormat,
  type SessionExportResult,
  type SessionMediaPlaybackPayload,
  type SessionSearchMode,
  type SessionSearchResultPayload,
  type SessionSummaryPayload,
  type SessionDetailPayload,
  type SessionUpdatePatchPayload,
  type SettingsUpdatePayload,
  type SettingsPayload,
  type SlackActivitySignalPayload,
  type StorageMigrationPayload,
  type StorageMigrationResultPayload,
  type TranscriptionDiagnosticsPayload,
  type TranscriptionTestResultPayload,
  type TranscriptionRequestOptionsPayload,
  type WhisperModelLibraryPayload,
  type CancelRecordingSessionResultPayload,
  type AppendRecordingChunkResult,
} from "./ipcContracts";

export interface MainIpcDependencies {
  screenSettingsUrl: string;
  getMainWindow: () => BrowserWindow | null;
  getPermissionStatus: () => Promise<PermissionStatusPayload>;
  getEffectiveSettings: () => Promise<SettingsPayload>;
  updateSettingsPatch: (patch: SettingsUpdatePayload) => Promise<SettingsPayload>;
  getTelemetryFilePath: () => string;
  getTelemetryDirPath: () => string;
  clampTelemetryTailLines: (value: unknown) => number;
  readTelemetryTail: (maxLines: number) => Promise<string[]>;
  logError: (event: string, context?: unknown) => void;
  logWarn: (event: string, context?: unknown) => void;
  logInfo: (event: string, context?: unknown) => void;
  getSlackActivitySignal: () => Promise<SlackActivitySignalPayload>;
  loadProcessingJobsStore: () => Promise<void>;
  listJobsForRenderer: () => ProcessingJobPayload[];
  retryProcessingJob: (jobId: string) => Promise<ProcessingJobPayload>;
  getTranscriptionDiagnostics: (forceRefresh?: boolean) => Promise<TranscriptionDiagnosticsPayload>;
  listWhisperModels: (forceRefresh?: boolean) => Promise<WhisperModelLibraryPayload>;
  installWhisperModel: (modelId?: string) => Promise<DownloadTranscriptionModelResult>;
  activateWhisperModel: (modelId: string) => Promise<SettingsPayload>;
  activateCustomWhisperModel: (modelPath: string) => Promise<SettingsPayload>;
  removeWhisperModel: (modelId: string) => Promise<RemoveTranscriptionModelResult>;
  chooseTranscriptionModelFile: () => Promise<string | null>;
  runTranscriptionTest: (
    sessionId: string,
    options?: Partial<TranscriptionRequestOptionsPayload>,
  ) => Promise<TranscriptionTestResultPayload>;
  listSessionsSummary: () => Promise<SessionSummaryPayload[]>;
  searchSessions: (query: string, mode: SessionSearchMode) => Promise<SessionSearchResultPayload[]>;
  getSessionDetail: (sessionId: string) => Promise<SessionDetailPayload>;
  updateSessionDetail: (
    sessionId: string,
    patch: SessionUpdatePatchPayload,
  ) => Promise<SessionDetailPayload>;
  queueSessionRetranscription: (
    sessionId: string,
    options?: Partial<TranscriptionRequestOptionsPayload>,
  ) => Promise<ProcessingJobPayload>;
  exportSession: (sessionId: string, format: SessionExportFormat) => Promise<SessionExportResult>;
  openSessionMedia: (sessionId: string) => Promise<OpenSessionMediaResultPayload>;
  getSessionMediaPlayback: (sessionId: string) => Promise<SessionMediaPlaybackPayload>;
  deleteSession: (sessionId: string) => Promise<DeleteSessionResultPayload>;
  getResolvedStorageDir: () => Promise<string>;
  invalidateSessionIndexCache: () => void;
  migrateLibraryStorage: (payload: StorageMigrationPayload) => Promise<StorageMigrationResultPayload>;
  cleanupInactiveLibrary: (storageDir: string) => Promise<DeleteLibraryResultPayload>;
  beginRecordingSession: (payload: BeginRecordingSessionPayload) => Promise<BeginRecordingSessionResult>;
  appendRecordingSessionChunk: (payload: {
    recordingSessionId: string;
    data: ArrayBuffer;
  }) => Promise<AppendRecordingChunkResult>;
  completeRecordingSession: (payload: FinishRecordingSessionPayload) => Promise<FinishRecordingSessionResult>;
  cancelRecordingSession: (recordingSessionId: string) => Promise<CancelRecordingSessionResultPayload>;
}

function requireObject<T extends object>(value: unknown, message: string): T {
  if (!value || typeof value !== "object") {
    throw new Error(message);
  }
  return value as T;
}

function requireNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== "string") {
    throw new Error(message);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(message);
  }
  return normalized;
}

function normalizeSessionSearchMode(value: unknown): SessionSearchMode {
  if (value === "keyword" || value === "semantic" || value === "both") {
    return value;
  }
  return "both";
}

function normalizeSessionExportFormat(value: unknown): SessionExportFormat {
  if (value === "md" || value === "txt" || value === "json") {
    return value;
  }
  throw new Error("Unsupported export format");
}

export function registerMainIpcHandlers(deps: MainIpcDependencies): void {
  ipcMain.handle(IPC_CHANNELS.permissions.getStatus, async () => {
    return deps.getPermissionStatus();
  });

  ipcMain.handle(IPC_CHANNELS.permissions.requestMicrophone, async () => {
    if (process.platform !== "darwin") {
      return "probe-renderer";
    }

    const status = systemPreferences.getMediaAccessStatus("microphone");
    if (status === "granted") {
      return true;
    }
    return systemPreferences.askForMediaAccess("microphone");
  });

  ipcMain.handle(IPC_CHANNELS.permissions.openScreenSettings, async () => {
    if (process.platform !== "darwin") {
      return false;
    }
    await shell.openExternal(deps.screenSettingsUrl);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.capture.listSources, async (_event, sourceType: CaptureSourceType) => {
    const isWindow = sourceType === "window";
    const sources = await desktopCapturer.getSources({
      types: [isWindow ? "window" : "screen"],
      fetchWindowIcons: isWindow,
      thumbnailSize: { width: 0, height: 0 },
    });

    return sources.map((source) => ({
      id: source.id,
      name: source.name,
    }));
  });

  ipcMain.handle(IPC_CHANNELS.settings.get, async () => {
    const effectiveSettings = await deps.getEffectiveSettings();
    await mkdir(effectiveSettings.storageDir, { recursive: true });
    return effectiveSettings;
  });

  ipcMain.handle(IPC_CHANNELS.settings.update, async (_event, patch: SettingsUpdatePayload) => {
    return deps.updateSettingsPatch(patch);
  });

  ipcMain.handle(IPC_CHANNELS.telemetry.getLogPath, async () => {
    const telemetryFilePath = deps.getTelemetryFilePath();
    await mkdir(path.dirname(telemetryFilePath), { recursive: true });
    return telemetryFilePath;
  });

  ipcMain.handle(IPC_CHANNELS.telemetry.getLogTail, async (_event, maxLines?: number) => {
    return deps.readTelemetryTail(deps.clampTelemetryTailLines(maxLines));
  });

  ipcMain.handle(IPC_CHANNELS.telemetry.openLogDir, async () => {
    const telemetryDir = deps.getTelemetryDirPath();
    await mkdir(telemetryDir, { recursive: true });
    const errorMessage = await shell.openPath(telemetryDir);
    if (errorMessage) {
      deps.logError("telemetry.open_dir_failed", {
        telemetryDir,
        error: errorMessage,
      });
      throw new Error(`Failed to open log directory: ${errorMessage}`);
    }
    deps.logInfo("telemetry.open_dir", { telemetryDir });
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.slack.getActivitySignal, async () => {
    return deps.getSlackActivitySignal();
  });

  ipcMain.handle(IPC_CHANNELS.processing.listJobs, async () => {
    await deps.loadProcessingJobsStore();
    return deps.listJobsForRenderer();
  });

  ipcMain.handle(IPC_CHANNELS.processing.retryJob, async (_event, jobId: string) => {
    return deps.retryProcessingJob(jobId);
  });

  ipcMain.handle(IPC_CHANNELS.transcription.getDiagnostics, async () => {
    return deps.getTranscriptionDiagnostics(true);
  });

  ipcMain.handle(IPC_CHANNELS.transcription.listModels, async () => {
    return deps.listWhisperModels(true);
  });

  ipcMain.handle(
    IPC_CHANNELS.transcription.downloadModel,
    async (_event, payload?: { modelId?: string }) => {
      const modelId = typeof payload?.modelId === "string" ? payload.modelId : "base.en";
      return deps.installWhisperModel(modelId);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.transcription.activateModel,
    async (_event, payload?: { modelId?: string }) => {
      return deps.activateWhisperModel(
        requireNonEmptyString(payload?.modelId, "Invalid transcription model activation payload"),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.transcription.activateCustomModel,
    async (_event, payload?: { modelPath?: string }) => {
      return deps.activateCustomWhisperModel(
        requireNonEmptyString(payload?.modelPath, "Invalid custom transcription model activation payload"),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.transcription.removeModel,
    async (_event, payload?: { modelId?: string }) => {
      return deps.removeWhisperModel(
        requireNonEmptyString(payload?.modelId, "Invalid transcription model removal payload"),
      );
    },
  );

  ipcMain.handle(IPC_CHANNELS.transcription.chooseModelFile, async () => {
    return deps.chooseTranscriptionModelFile();
  });

  ipcMain.handle(
    IPC_CHANNELS.transcription.testSession,
    async (_event, payload?: { sessionId?: string; options?: Partial<TranscriptionRequestOptionsPayload> }) => {
      const sessionId = requireNonEmptyString(payload?.sessionId, "Invalid transcription test payload");
      try {
        return await deps.runTranscriptionTest(sessionId, payload?.options ?? {});
      } catch (error) {
        deps.logError("transcription.test_failed", {
          sessionId,
          options: payload?.options ?? {},
          error,
        });
        throw error;
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.sessions.list, async () => {
    return deps.listSessionsSummary();
  });

  ipcMain.handle(
    IPC_CHANNELS.sessions.search,
    async (_event, payload?: { query?: string; mode?: SessionSearchMode }) => {
      return deps.searchSessions(
        typeof payload?.query === "string" ? payload.query : "",
        normalizeSessionSearchMode(payload?.mode),
      );
    },
  );

  ipcMain.handle(IPC_CHANNELS.sessions.getDetail, async (_event, sessionId: string) => {
    try {
      return await deps.getSessionDetail(sessionId);
    } catch (error) {
      if (error instanceof Error && error.message === "Session not found") {
        deps.logWarn("session.detail_not_found", { sessionId });
        return null;
      }
      throw error;
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.sessions.updateDetail,
    async (_event, payload?: { sessionId?: string; patch?: SessionUpdatePatchPayload }) => {
      const validPayload = requireObject<{ sessionId?: string; patch?: SessionUpdatePatchPayload }>(
        payload,
        "Invalid session update payload",
      );
      return deps.updateSessionDetail(
        requireNonEmptyString(validPayload.sessionId, "Invalid session update payload"),
        validPayload.patch ?? {},
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.sessions.retranscribe,
    async (_event, payload?: { sessionId?: string; options?: Partial<TranscriptionRequestOptionsPayload> }) => {
      const sessionId = requireNonEmptyString(payload?.sessionId, "Invalid session re-transcription payload");
      return deps.queueSessionRetranscription(sessionId, payload?.options ?? {});
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.sessions.export,
    async (_event, payload?: { sessionId?: string; format?: SessionExportFormat }) => {
      const validPayload = requireObject<{ sessionId?: string; format?: SessionExportFormat }>(
        payload,
        "Invalid session export payload",
      );
      return deps.exportSession(
        requireNonEmptyString(validPayload.sessionId, "Invalid session export payload"),
        normalizeSessionExportFormat(validPayload.format),
      );
    },
  );

  ipcMain.handle(IPC_CHANNELS.sessions.openMedia, async (_event, sessionId: string) => {
    return deps.openSessionMedia(requireNonEmptyString(sessionId, "Invalid session id"));
  });

  ipcMain.handle(IPC_CHANNELS.sessions.getMediaPlayback, async (_event, sessionId: string) => {
    return deps.getSessionMediaPlayback(requireNonEmptyString(sessionId, "Invalid session id"));
  });

  ipcMain.handle(IPC_CHANNELS.sessions.delete, async (_event, sessionId: string) => {
    return deps.deleteSession(requireNonEmptyString(sessionId, "Invalid session id"));
  });

  ipcMain.handle(IPC_CHANNELS.storage.getDir, async () => {
    return deps.getResolvedStorageDir();
  });

  ipcMain.handle(IPC_CHANNELS.storage.setDir, async (_event, storageDir: string) => {
    const normalizedStorageDir = requireNonEmptyString(
      storageDir,
      "Storage directory cannot be empty.",
    );
    const updatedSettings = await deps.updateSettingsPatch({
      storageDir: normalizedStorageDir,
    });
    deps.invalidateSessionIndexCache();
    deps.logInfo("storage.set_dir", { storageDir: normalizedStorageDir });
    return updatedSettings.storageDir;
  });

  ipcMain.handle(IPC_CHANNELS.storage.chooseDir, async () => {
    const options: OpenDialogOptions = {
      properties: ["openDirectory", "createDirectory"],
    };
    const mainWindow = deps.getMainWindow();
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.handle(
    IPC_CHANNELS.storage.migrateLibrary,
    async (_event, payload?: StorageMigrationPayload) => {
      const validPayload = requireObject<StorageMigrationPayload>(
        payload,
        "Invalid storage migration payload.",
      );
      if (validPayload.mode !== "move" && validPayload.mode !== "empty") {
        throw new Error("Invalid storage migration mode.");
      }
      requireNonEmptyString(validPayload.nextStorageDir, "Invalid storage migration payload.");
      return deps.migrateLibraryStorage(validPayload);
    },
  );

  ipcMain.handle(IPC_CHANNELS.storage.cleanupLibrary, async (_event, storageDir: string) => {
    return deps.cleanupInactiveLibrary(
      requireNonEmptyString(storageDir, "Invalid library cleanup path."),
    );
  });

  ipcMain.handle(IPC_CHANNELS.recording.beginSession, async (_event, payload: BeginRecordingSessionPayload) => {
    try {
      return await deps.beginRecordingSession(payload);
    } catch (error) {
      deps.logError("recording.begin_session_failed", { error });
      throw error;
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.recording.appendChunk,
    async (_event, payload?: { recordingSessionId?: string; data?: ArrayBuffer }) => {
      try {
        const validPayload = requireObject<{ recordingSessionId?: string; data?: ArrayBuffer }>(
          payload,
          "Invalid recording chunk payload.",
        );
        return await deps.appendRecordingSessionChunk({
          recordingSessionId: requireNonEmptyString(
            validPayload.recordingSessionId,
            "Invalid recording chunk payload.",
          ),
          data: validPayload.data as ArrayBuffer,
        });
      } catch (error) {
        deps.logError("recording.append_chunk_failed", {
          recordingSessionId: payload?.recordingSessionId,
          error,
        });
        throw error;
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.recording.finishSession,
    async (_event, payload?: FinishRecordingSessionPayload) => {
      try {
        const validPayload = requireObject<FinishRecordingSessionPayload>(
          payload,
          "Invalid recording finish payload.",
        );
        return await deps.completeRecordingSession({
          recordingSessionId: requireNonEmptyString(
            validPayload.recordingSessionId,
            "Invalid recording finish payload.",
          ),
          mimeType: validPayload.mimeType,
          metadata: validPayload.metadata,
        });
      } catch (error) {
        deps.logError("recording.finish_session_failed", {
          recordingSessionId: payload?.recordingSessionId,
          error,
        });
        throw error;
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.recording.cancelSession, async (_event, recordingSessionId: string) => {
    try {
      return await deps.cancelRecordingSession(
        requireNonEmptyString(recordingSessionId, "Invalid recording session id."),
      );
    } catch (error) {
      deps.logError("recording.cancel_session_failed", {
        recordingSessionId,
        error,
      });
      throw error;
    }
  });
}
