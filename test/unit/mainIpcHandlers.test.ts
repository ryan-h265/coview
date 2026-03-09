import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  registeredHandlers,
  ipcMainHandle,
  desktopCapturerGetSources,
  dialogShowOpenDialog,
  shellOpenExternal,
  shellOpenPath,
  getMediaAccessStatus,
  askForMediaAccess,
  mkdir,
} = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  return {
    registeredHandlers: handlers,
    ipcMainHandle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, handler);
    }),
    desktopCapturerGetSources: vi.fn(),
    dialogShowOpenDialog: vi.fn(),
    shellOpenExternal: vi.fn(),
    shellOpenPath: vi.fn(),
    getMediaAccessStatus: vi.fn(),
    askForMediaAccess: vi.fn(),
    mkdir: vi.fn(),
  };
});

vi.mock("electron", () => ({
  desktopCapturer: {
    getSources: desktopCapturerGetSources,
  },
  dialog: {
    showOpenDialog: dialogShowOpenDialog,
  },
  ipcMain: {
    handle: ipcMainHandle,
  },
  shell: {
    openExternal: shellOpenExternal,
    openPath: shellOpenPath,
  },
  systemPreferences: {
    getMediaAccessStatus,
    askForMediaAccess,
  },
}));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    mkdir,
  };
});

import type { MainIpcDependencies } from "../../src/mainIpcHandlers";
import { registerMainIpcHandlers } from "../../src/mainIpcHandlers";
import {
  IPC_CHANNELS,
  type AppendRecordingChunkResult,
  type BeginRecordingSessionResult,
  type CancelRecordingSessionResultPayload,
  type DeleteLibraryResultPayload,
  type DeleteSessionResultPayload,
  type DownloadTranscriptionModelResult,
  type FinishRecordingSessionResult,
  type OpenSessionMediaResultPayload,
  type PermissionStatusPayload,
  type ProcessingJobPayload,
  type RemoveTranscriptionModelResult,
  type SessionDetailPayload,
  type SessionExportResult,
  type SessionMediaPlaybackPayload,
  type SessionSearchResultPayload,
  type SessionSummaryPayload,
  type SettingsPayload,
  type SlackActivitySignalPayload,
  type StorageMigrationResultPayload,
  type TranscriptionDiagnosticsPayload,
  type TranscriptionTestResultPayload,
  type WhisperModelLibraryPayload,
} from "../../src/ipcContracts";

const originalPlatform = process.platform;

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    value,
    configurable: true,
  });
}

function createSettingsPayload(storageDir = "/tmp/coview"): SettingsPayload {
  return {
    storageDir,
    autoRecordEnabled: true,
    aiProcessingEnabled: false,
    inactivityTimeoutMinutes: 60,
    hotkeys: {
      startStop: "CommandOrControl+Shift+R",
      pauseResume: "CommandOrControl+Shift+P",
      autoToggle: "CommandOrControl+Shift+A",
    },
    transcriptionDefaults: {
      provider: "auto",
      language: "en",
    },
    transcriptionSetup: {
      status: "pending",
    },
  };
}

function createMainIpcDependencies(): MainIpcDependencies {
  const permissionStatus: PermissionStatusPayload = {
    microphone: "granted",
    screen: "granted",
    platform: "linux",
  };
  const telemetryLines = ["line-1", "line-2"];
  const slackSignal: SlackActivitySignalPayload = {
    isRunning: true,
    callHintActive: false,
    callHints: [],
    windowTitles: ["Slack"],
    checkedAt: "2026-03-09T10:00:00.000Z",
  };
  const processingJob: ProcessingJobPayload = {
    id: "job-1",
    sessionId: "session-1",
    title: "Job",
    status: "queued",
    attemptCount: 1,
    createdAt: "2026-03-09T10:00:00.000Z",
    updatedAt: "2026-03-09T10:00:00.000Z",
  };
  const transcriptionDiagnostics: TranscriptionDiagnosticsPayload = {
    checkedAt: "2026-03-09T10:00:00.000Z",
    whisperCli: {
      available: true,
      modelExists: true,
      ready: true,
    },
    whisperPython: {
      available: false,
      ready: false,
    },
    ffmpeg: {
      available: true,
    },
    autoStrategy: {
      attemptOrder: ["local-whisper-cli"],
      firstReadyProvider: "local-whisper-cli",
      ready: true,
      summary: "ready",
    },
    managedModelDirectory: "/tmp/models",
    setupStatus: "completed",
  };
  const modelLibrary: WhisperModelLibraryPayload = {
    runtimeAvailable: true,
    managedModelDirectory: "/tmp/models",
    aiProcessingEnabled: false,
    setupStatus: "completed",
    models: [],
  };
  const downloadModelResult: DownloadTranscriptionModelResult = {
    modelId: "base.en",
    displayName: "Base English",
    description: "desc",
    modelPath: "/tmp/models/base.en.bin",
    alreadyExisted: false,
    settings: createSettingsPayload(),
  };
  const removeModelResult: RemoveTranscriptionModelResult = {
    removed: true,
    settings: createSettingsPayload(),
  };
  const transcriptionTestResult: TranscriptionTestResultPayload = {
    sessionId: "session-1",
    provider: "local-whisper-cli",
    model: "base.en",
    language: "en",
    transcriptChars: 120,
    previewText: "preview",
    elapsedMs: 1500,
    testedAt: "2026-03-09T10:00:00.000Z",
  };
  const sessionSummary: SessionSummaryPayload = {
    id: "session-1",
    title: "Weekly Sync",
    startedAt: "2026-03-09T10:00:00.000Z",
    processingStatus: "done",
    summary: "summary",
    topics: [],
    keywords: [],
    transcriptSnippet: "snippet",
    updatedAt: "2026-03-09T10:00:00.000Z",
  };
  const sessionDetail: SessionDetailPayload = {
    ...sessionSummary,
    mediaPath: "/tmp/session.webm",
    metadataPath: "/tmp/session.json",
    transcriptSegments: [],
    transcriptText: "full transcript",
  };
  const sessionSearchResults: SessionSearchResultPayload[] = [
    {
      ...sessionSummary,
      score: 88,
      matchType: "both",
    },
  ];
  const exportResult: SessionExportResult = {
    exportPath: "/tmp/export.md",
  };
  const openMediaResult: OpenSessionMediaResultPayload = {
    opened: true,
    mediaPath: "/tmp/session.webm",
  };
  const mediaPlaybackResult: SessionMediaPlaybackPayload = {
    mediaPath: "/tmp/session.webm",
    mediaUrl: "file:///tmp/session.webm",
  };
  const deleteSessionResult: DeleteSessionResultPayload = {
    deleted: true,
    removedPaths: ["/tmp/session.webm"],
    removedJobs: 1,
  };
  const storageMigrationResult: StorageMigrationResultPayload = {
    storageDir: "/tmp/new-library",
    previousStorageDir: "/tmp/old-library",
    mode: "move",
    copiedEntries: 2,
    verification: {
      expectedFiles: 4,
      verifiedFiles: 4,
    },
  };
  const cleanupLibraryResult: DeleteLibraryResultPayload = {
    removed: true,
  };
  const beginRecordingResult: BeginRecordingSessionResult = {
    recordingSessionId: "recording-1",
  };
  const appendChunkResult: AppendRecordingChunkResult = {
    bytesWritten: 10,
    chunkCount: 2,
  };
  const finishRecordingResult: FinishRecordingSessionResult = {
    mediaPath: "/tmp/session.webm",
    metadataPath: "/tmp/session.json",
    bytesWritten: 10,
    processingJobId: "job-1",
    processingStatus: "queued",
    droppedEmpty: false,
  };
  const cancelRecordingResult: CancelRecordingSessionResultPayload = {
    cancelled: true,
  };

  return {
    screenSettingsUrl: "x-apple.systempreferences:test",
    getMainWindow: vi.fn(() => null),
    getPermissionStatus: vi.fn(async () => permissionStatus),
    getEffectiveSettings: vi.fn(async () => createSettingsPayload()),
    updateSettingsPatch: vi.fn(async (patch) => createSettingsPayload(patch.storageDir ?? "/tmp/coview")),
    getTelemetryFilePath: vi.fn(() => "/tmp/coview/logs/coview.log"),
    getTelemetryDirPath: vi.fn(() => "/tmp/coview/logs"),
    clampTelemetryTailLines: vi.fn((value) => (typeof value === "number" ? value : 120)),
    readTelemetryTail: vi.fn(async () => telemetryLines),
    logError: vi.fn(),
    logWarn: vi.fn(),
    logInfo: vi.fn(),
    getSlackActivitySignal: vi.fn(async () => slackSignal),
    loadProcessingJobsStore: vi.fn(async () => undefined),
    listJobsForRenderer: vi.fn(() => [processingJob]),
    retryProcessingJob: vi.fn(async () => processingJob),
    getTranscriptionDiagnostics: vi.fn(async () => transcriptionDiagnostics),
    listWhisperModels: vi.fn(async () => modelLibrary),
    installWhisperModel: vi.fn(async () => downloadModelResult),
    activateWhisperModel: vi.fn(async () => createSettingsPayload()),
    activateCustomWhisperModel: vi.fn(async () => createSettingsPayload()),
    removeWhisperModel: vi.fn(async () => removeModelResult),
    chooseTranscriptionModelFile: vi.fn(async () => "/tmp/models/base.en.bin"),
    runTranscriptionTest: vi.fn(async () => transcriptionTestResult),
    listSessionsSummary: vi.fn(async () => [sessionSummary]),
    searchSessions: vi.fn(async () => sessionSearchResults),
    getSessionDetail: vi.fn(async () => sessionDetail),
    updateSessionDetail: vi.fn(async () => sessionDetail),
    queueSessionRetranscription: vi.fn(async () => processingJob),
    exportSession: vi.fn(async () => exportResult),
    openSessionMedia: vi.fn(async () => openMediaResult),
    getSessionMediaPlayback: vi.fn(async () => mediaPlaybackResult),
    deleteSession: vi.fn(async () => deleteSessionResult),
    getResolvedStorageDir: vi.fn(async () => "/tmp/coview"),
    invalidateSessionIndexCache: vi.fn(),
    migrateLibraryStorage: vi.fn(async () => storageMigrationResult),
    cleanupInactiveLibrary: vi.fn(async () => cleanupLibraryResult),
    beginRecordingSession: vi.fn(async () => beginRecordingResult),
    appendRecordingSessionChunk: vi.fn(async () => appendChunkResult),
    completeRecordingSession: vi.fn(async () => finishRecordingResult),
    cancelRecordingSession: vi.fn(async () => cancelRecordingResult),
  };
}

async function invokeHandler(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = registeredHandlers.get(channel);
  if (!handler) {
    throw new Error(`No handler registered for ${channel}`);
  }
  return handler({}, ...args);
}

describe("registerMainIpcHandlers", () => {
  beforeEach(() => {
    registeredHandlers.clear();
    vi.clearAllMocks();
    setPlatform(originalPlatform);
    desktopCapturerGetSources.mockResolvedValue([
      { id: "screen:1", name: "Screen 1" },
      { id: "window:1", name: "Window 1" },
    ]);
    dialogShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    shellOpenExternal.mockResolvedValue(undefined);
    shellOpenPath.mockResolvedValue("");
    getMediaAccessStatus.mockReturnValue("not-determined");
    askForMediaAccess.mockResolvedValue(true);
    mkdir.mockResolvedValue(undefined);
  });

  it("registers the extracted IPC contract and forwards successful handlers", async () => {
    const deps = createMainIpcDependencies();
    registerMainIpcHandlers(deps);

    expect(registeredHandlers.size).toBeGreaterThan(30);

    await expect(invokeHandler(IPC_CHANNELS.permissions.getStatus)).resolves.toEqual({
      microphone: "granted",
      screen: "granted",
      platform: "linux",
    });
    await expect(invokeHandler(IPC_CHANNELS.permissions.requestMicrophone)).resolves.toBe(
      "probe-renderer",
    );
    await expect(invokeHandler(IPC_CHANNELS.permissions.openScreenSettings)).resolves.toBe(false);

    await expect(invokeHandler(IPC_CHANNELS.capture.listSources, "window")).resolves.toEqual([
      { id: "screen:1", name: "Screen 1" },
      { id: "window:1", name: "Window 1" },
    ]);
    expect(desktopCapturerGetSources).toHaveBeenCalledWith({
      types: ["window"],
      fetchWindowIcons: true,
      thumbnailSize: { width: 0, height: 0 },
    });

    await expect(invokeHandler(IPC_CHANNELS.settings.get)).resolves.toEqual(
      createSettingsPayload(),
    );
    expect(mkdir).toHaveBeenCalledWith("/tmp/coview", { recursive: true });

    await expect(
      invokeHandler(IPC_CHANNELS.settings.update, { aiProcessingEnabled: true }),
    ).resolves.toEqual(createSettingsPayload());
    expect(deps.updateSettingsPatch).toHaveBeenCalledWith({ aiProcessingEnabled: true });

    await expect(invokeHandler(IPC_CHANNELS.telemetry.getLogPath)).resolves.toBe(
      "/tmp/coview/logs/coview.log",
    );
    expect(mkdir).toHaveBeenCalledWith("/tmp/coview/logs", { recursive: true });

    await expect(invokeHandler(IPC_CHANNELS.telemetry.getLogTail, 80)).resolves.toEqual([
      "line-1",
      "line-2",
    ]);
    expect(deps.clampTelemetryTailLines).toHaveBeenCalledWith(80);
    expect(deps.readTelemetryTail).toHaveBeenCalledWith(80);

    await expect(invokeHandler(IPC_CHANNELS.telemetry.openLogDir)).resolves.toBe(true);
    expect(shellOpenPath).toHaveBeenCalledWith("/tmp/coview/logs");
    expect(deps.logInfo).toHaveBeenCalledWith("telemetry.open_dir", {
      telemetryDir: "/tmp/coview/logs",
    });

    await expect(invokeHandler(IPC_CHANNELS.slack.getActivitySignal)).resolves.toEqual({
      isRunning: true,
      callHintActive: false,
      callHints: [],
      windowTitles: ["Slack"],
      checkedAt: "2026-03-09T10:00:00.000Z",
    });

    await expect(invokeHandler(IPC_CHANNELS.processing.listJobs)).resolves.toEqual([
      expect.objectContaining({ id: "job-1" }),
    ]);
    expect(deps.loadProcessingJobsStore).toHaveBeenCalled();

    await expect(invokeHandler(IPC_CHANNELS.processing.retryJob, "job-1")).resolves.toEqual(
      expect.objectContaining({ id: "job-1" }),
    );

    await expect(invokeHandler(IPC_CHANNELS.transcription.getDiagnostics)).resolves.toEqual(
      expect.objectContaining({ managedModelDirectory: "/tmp/models" }),
    );
    expect(deps.getTranscriptionDiagnostics).toHaveBeenCalledWith(true);

    await expect(invokeHandler(IPC_CHANNELS.transcription.listModels)).resolves.toEqual(
      expect.objectContaining({ managedModelDirectory: "/tmp/models" }),
    );
    expect(deps.listWhisperModels).toHaveBeenCalledWith(true);

    await expect(
      invokeHandler(IPC_CHANNELS.transcription.downloadModel, { modelId: "small.en" }),
    ).resolves.toEqual(expect.objectContaining({ modelId: "base.en" }));
    expect(deps.installWhisperModel).toHaveBeenCalledWith("small.en");

    await expect(invokeHandler(IPC_CHANNELS.transcription.downloadModel)).resolves.toEqual(
      expect.objectContaining({ modelId: "base.en" }),
    );
    expect(deps.installWhisperModel).toHaveBeenLastCalledWith("base.en");

    await expect(invokeHandler(IPC_CHANNELS.transcription.chooseModelFile)).resolves.toBe(
      "/tmp/models/base.en.bin",
    );

    await expect(invokeHandler(IPC_CHANNELS.sessions.list)).resolves.toEqual([
      expect.objectContaining({ id: "session-1" }),
    ]);

    await expect(
      invokeHandler(IPC_CHANNELS.sessions.search, { query: "auth bug", mode: "keyword" }),
    ).resolves.toEqual([expect.objectContaining({ id: "session-1" })]);
    expect(deps.searchSessions).toHaveBeenCalledWith("auth bug", "keyword");

    await expect(
      invokeHandler(IPC_CHANNELS.sessions.search, { query: "auth bug", mode: "invalid" }),
    ).resolves.toEqual([expect.objectContaining({ id: "session-1" })]);
    expect(deps.searchSessions).toHaveBeenLastCalledWith("auth bug", "both");

    await expect(invokeHandler(IPC_CHANNELS.sessions.getDetail, "session-1")).resolves.toEqual(
      expect.objectContaining({ id: "session-1" }),
    );

    await expect(
      invokeHandler(IPC_CHANNELS.sessions.updateDetail, {
        sessionId: "session-1",
        patch: { title: "Updated" },
      }),
    ).resolves.toEqual(expect.objectContaining({ id: "session-1" }));
    expect(deps.updateSessionDetail).toHaveBeenCalledWith("session-1", { title: "Updated" });

    await expect(
      invokeHandler(IPC_CHANNELS.sessions.retranscribe, {
        sessionId: "session-1",
        options: { provider: "auto" },
      }),
    ).resolves.toEqual(expect.objectContaining({ id: "job-1" }));
    expect(deps.queueSessionRetranscription).toHaveBeenCalledWith("session-1", { provider: "auto" });

    await expect(
      invokeHandler(IPC_CHANNELS.sessions.export, { sessionId: "session-1", format: "md" }),
    ).resolves.toEqual({ exportPath: "/tmp/export.md" });

    await expect(invokeHandler(IPC_CHANNELS.sessions.openMedia, "session-1")).resolves.toEqual({
      opened: true,
      mediaPath: "/tmp/session.webm",
    });
    await expect(
      invokeHandler(IPC_CHANNELS.sessions.getMediaPlayback, "session-1"),
    ).resolves.toEqual({
      mediaPath: "/tmp/session.webm",
      mediaUrl: "file:///tmp/session.webm",
    });
    await expect(invokeHandler(IPC_CHANNELS.sessions.delete, "session-1")).resolves.toEqual({
      deleted: true,
      removedPaths: ["/tmp/session.webm"],
      removedJobs: 1,
    });

    await expect(invokeHandler(IPC_CHANNELS.storage.getDir)).resolves.toBe("/tmp/coview");
    await expect(invokeHandler(IPC_CHANNELS.storage.setDir, " /tmp/new-library ")).resolves.toBe(
      "/tmp/new-library",
    );
    expect(deps.invalidateSessionIndexCache).toHaveBeenCalled();
    expect(deps.logInfo).toHaveBeenCalledWith("storage.set_dir", {
      storageDir: "/tmp/new-library",
    });

    await expect(invokeHandler(IPC_CHANNELS.storage.chooseDir)).resolves.toBeNull();

    await expect(
      invokeHandler(IPC_CHANNELS.storage.migrateLibrary, {
        nextStorageDir: "/tmp/new-library",
        mode: "move",
      }),
    ).resolves.toEqual(expect.objectContaining({ storageDir: "/tmp/new-library" }));

    await expect(
      invokeHandler(IPC_CHANNELS.storage.cleanupLibrary, "/tmp/old-library"),
    ).resolves.toEqual({
      removed: true,
    });

    await expect(
      invokeHandler(IPC_CHANNELS.recording.beginSession, { mimeType: "video/webm" }),
    ).resolves.toEqual({
      recordingSessionId: "recording-1",
    });

    const chunkPayload = {
      recordingSessionId: "recording-1",
      data: new ArrayBuffer(0),
    };
    await expect(invokeHandler(IPC_CHANNELS.recording.appendChunk, chunkPayload)).resolves.toEqual({
      bytesWritten: 10,
      chunkCount: 2,
    });

    await expect(
      invokeHandler(IPC_CHANNELS.recording.finishSession, {
        recordingSessionId: "recording-1",
        mimeType: "video/webm",
        metadata: {},
      }),
    ).resolves.toEqual(expect.objectContaining({ mediaPath: "/tmp/session.webm" }));

    await expect(
      invokeHandler(IPC_CHANNELS.recording.cancelSession, "recording-1"),
    ).resolves.toEqual({
      cancelled: true,
    });
  });

  it("covers darwin-specific permission and chooser flows", async () => {
    const deps = createMainIpcDependencies();
    const browserWindow = { id: 1 } as unknown as Electron.BrowserWindow;
    deps.getMainWindow = vi.fn(() => browserWindow);
    registerMainIpcHandlers(deps);

    setPlatform("darwin");
    getMediaAccessStatus.mockReturnValue("granted");
    await expect(invokeHandler(IPC_CHANNELS.permissions.requestMicrophone)).resolves.toBe(true);
    expect(askForMediaAccess).not.toHaveBeenCalled();

    getMediaAccessStatus.mockReturnValue("denied");
    askForMediaAccess.mockResolvedValueOnce(false);
    await expect(invokeHandler(IPC_CHANNELS.permissions.requestMicrophone)).resolves.toBe(false);
    expect(askForMediaAccess).toHaveBeenCalledWith("microphone");

    await expect(invokeHandler(IPC_CHANNELS.permissions.openScreenSettings)).resolves.toBe(true);
    expect(shellOpenExternal).toHaveBeenCalledWith("x-apple.systempreferences:test");

    dialogShowOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ["/tmp/selected-library"],
    });
    await expect(invokeHandler(IPC_CHANNELS.storage.chooseDir)).resolves.toBe(
      "/tmp/selected-library",
    );
    expect(dialogShowOpenDialog).toHaveBeenCalledWith(browserWindow, {
      properties: ["openDirectory", "createDirectory"],
    });
  });

  it("validates bad payloads and logs expected failures", async () => {
    const deps = createMainIpcDependencies();
    registerMainIpcHandlers(deps);

    await expect(
      invokeHandler(IPC_CHANNELS.transcription.activateModel, { modelId: " " }),
    ).rejects.toThrow("Invalid transcription model activation payload");
    await expect(
      invokeHandler(IPC_CHANNELS.transcription.activateCustomModel, { modelPath: "" }),
    ).rejects.toThrow("Invalid custom transcription model activation payload");
    await expect(
      invokeHandler(IPC_CHANNELS.transcription.removeModel, { modelId: "" }),
    ).rejects.toThrow("Invalid transcription model removal payload");
    await expect(
      invokeHandler(IPC_CHANNELS.transcription.testSession, {}),
    ).rejects.toThrow("Invalid transcription test payload");

    const transcriptionFailure = new Error("transcription failed");
    deps.runTranscriptionTest = vi.fn(async () => {
      throw transcriptionFailure;
    });
    registeredHandlers.clear();
    registerMainIpcHandlers(deps);
    await expect(
      invokeHandler(IPC_CHANNELS.transcription.testSession, { sessionId: "session-1" }),
    ).rejects.toThrow("transcription failed");
    expect(deps.logError).toHaveBeenCalledWith(
      "transcription.test_failed",
      expect.objectContaining({ sessionId: "session-1", error: transcriptionFailure }),
    );

    deps.getSessionDetail = vi.fn(async () => {
      throw new Error("Session not found");
    });
    registeredHandlers.clear();
    registerMainIpcHandlers(deps);
    await expect(invokeHandler(IPC_CHANNELS.sessions.getDetail, "missing")).resolves.toBeNull();
    expect(deps.logWarn).toHaveBeenCalledWith("session.detail_not_found", { sessionId: "missing" });

    deps.getSessionDetail = vi.fn(async () => {
      throw new Error("Unexpected");
    });
    registeredHandlers.clear();
    registerMainIpcHandlers(deps);
    await expect(invokeHandler(IPC_CHANNELS.sessions.getDetail, "missing")).rejects.toThrow(
      "Unexpected",
    );

    await expect(
      invokeHandler(IPC_CHANNELS.sessions.updateDetail, "bad-payload"),
    ).rejects.toThrow("Invalid session update payload");
    await expect(
      invokeHandler(IPC_CHANNELS.sessions.retranscribe, { sessionId: "" }),
    ).rejects.toThrow("Invalid session re-transcription payload");
    await expect(
      invokeHandler(IPC_CHANNELS.sessions.export, { sessionId: "session-1", format: "csv" }),
    ).rejects.toThrow("Unsupported export format");
    await expect(invokeHandler(IPC_CHANNELS.sessions.openMedia, "")).rejects.toThrow(
      "Invalid session id",
    );
    await expect(invokeHandler(IPC_CHANNELS.sessions.getMediaPlayback, "")).rejects.toThrow(
      "Invalid session id",
    );
    await expect(invokeHandler(IPC_CHANNELS.sessions.delete, "")).rejects.toThrow(
      "Invalid session id",
    );

    await expect(invokeHandler(IPC_CHANNELS.storage.setDir, " ")).rejects.toThrow(
      "Storage directory cannot be empty.",
    );
    await expect(
      invokeHandler(IPC_CHANNELS.storage.migrateLibrary, { nextStorageDir: "/tmp", mode: "bad" }),
    ).rejects.toThrow("Invalid storage migration mode.");
    await expect(
      invokeHandler(IPC_CHANNELS.storage.cleanupLibrary, " "),
    ).rejects.toThrow("Invalid library cleanup path.");

    shellOpenPath.mockResolvedValueOnce("permission denied");
    await expect(invokeHandler(IPC_CHANNELS.telemetry.openLogDir)).rejects.toThrow(
      "Failed to open log directory: permission denied",
    );
    expect(deps.logError).toHaveBeenCalledWith(
      "telemetry.open_dir_failed",
      expect.objectContaining({ telemetryDir: "/tmp/coview/logs", error: "permission denied" }),
    );
  });

  it("logs recording handler failures before rethrowing", async () => {
    const deps = createMainIpcDependencies();
    const beginFailure = new Error("begin failed");
    deps.beginRecordingSession = vi.fn(async () => {
      throw beginFailure;
    });
    const appendFailure = new Error("append failed");
    deps.appendRecordingSessionChunk = vi.fn(async () => {
      throw appendFailure;
    });
    const finishFailure = new Error("finish failed");
    deps.completeRecordingSession = vi.fn(async () => {
      throw finishFailure;
    });
    const cancelFailure = new Error("cancel failed");
    deps.cancelRecordingSession = vi.fn(async () => {
      throw cancelFailure;
    });

    registerMainIpcHandlers(deps);

    await expect(
      invokeHandler(IPC_CHANNELS.recording.beginSession, { mimeType: "video/webm" }),
    ).rejects.toThrow("begin failed");
    expect(deps.logError).toHaveBeenCalledWith(
      "recording.begin_session_failed",
      expect.objectContaining({ error: beginFailure }),
    );

    await expect(
      invokeHandler(IPC_CHANNELS.recording.appendChunk, {
        recordingSessionId: "recording-1",
        data: new ArrayBuffer(0),
      }),
    ).rejects.toThrow("append failed");
    expect(deps.logError).toHaveBeenCalledWith(
      "recording.append_chunk_failed",
      expect.objectContaining({ recordingSessionId: "recording-1", error: appendFailure }),
    );

    await expect(
      invokeHandler(IPC_CHANNELS.recording.finishSession, {
        recordingSessionId: "recording-1",
        mimeType: "video/webm",
        metadata: {},
      }),
    ).rejects.toThrow("finish failed");
    expect(deps.logError).toHaveBeenCalledWith(
      "recording.finish_session_failed",
      expect.objectContaining({ recordingSessionId: "recording-1", error: finishFailure }),
    );

    await expect(invokeHandler(IPC_CHANNELS.recording.cancelSession, "recording-1")).rejects.toThrow(
      "cancel failed",
    );
    expect(deps.logError).toHaveBeenCalledWith(
      "recording.cancel_session_failed",
      expect.objectContaining({ recordingSessionId: "recording-1", error: cancelFailure }),
    );
  });
});
