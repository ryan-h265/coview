import { beforeEach, describe, expect, it, vi } from "vitest";

const exposeInMainWorld = vi.fn();
const invoke = vi.fn();
const on = vi.fn();
const removeListener = vi.fn();

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld,
  },
  ipcRenderer: {
    invoke,
    on,
    removeListener,
  },
}));

async function loadPreloadApi(): Promise<Record<string, unknown>> {
  vi.resetModules();
  exposeInMainWorld.mockReset();
  invoke.mockReset();
  on.mockReset();
  removeListener.mockReset();

  await import("../../src/preload");

  expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
  const [namespace, api] = exposeInMainWorld.mock.calls[0] as [string, Record<string, unknown>];
  expect(namespace).toBe("coview");
  return api;
}

describe("preload bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes the expected Coview API surface", async () => {
    const api = await loadPreloadApi();

    expect(api).toEqual(
      expect.objectContaining({
        getSettings: expect.any(Function),
        updateSettings: expect.any(Function),
        onHotkeyAction: expect.any(Function),
        listSessions: expect.any(Function),
        beginRecordingSession: expect.any(Function),
        finishRecordingSession: expect.any(Function),
      }),
    );
  });

  it("proxies invoke calls and removes event listeners on unsubscribe", async () => {
    const api = await loadPreloadApi();

    const invokeCases: Array<{
      method: string;
      args: unknown[];
      expected: unknown[];
    }> = [
      { method: "getPermissionStatus", args: [], expected: ["permissions:get-status"] },
      { method: "requestMicrophonePermission", args: [], expected: ["permissions:request-microphone"] },
      { method: "openScreenPermissionSettings", args: [], expected: ["permissions:open-screen-settings"] },
      { method: "listCaptureSources", args: ["screen"], expected: ["capture:list-sources", "screen"] },
      { method: "getSettings", args: [], expected: ["settings:get"] },
      {
        method: "updateSettings",
        args: [{ aiProcessingEnabled: true }],
        expected: ["settings:update", { aiProcessingEnabled: true }],
      },
      { method: "getTelemetryLogPath", args: [], expected: ["telemetry:get-log-path"] },
      { method: "getTelemetryLogTail", args: [80], expected: ["telemetry:get-log-tail", 80] },
      { method: "openTelemetryLogDir", args: [], expected: ["telemetry:open-log-dir"] },
      { method: "getSlackActivitySignal", args: [], expected: ["slack:get-activity-signal"] },
      { method: "listProcessingJobs", args: [], expected: ["processing:list-jobs"] },
      { method: "retryProcessingJob", args: ["job-1"], expected: ["processing:retry-job", "job-1"] },
      { method: "getTranscriptionDiagnostics", args: [], expected: ["transcription:get-diagnostics"] },
      { method: "listTranscriptionModels", args: [], expected: ["transcription:list-models"] },
      {
        method: "downloadRecommendedTranscriptionModel",
        args: [{ modelId: "base.en" }],
        expected: ["transcription:download-model", { modelId: "base.en" }],
      },
      { method: "chooseTranscriptionModelFile", args: [], expected: ["transcription:choose-model-file"] },
      {
        method: "activateTranscriptionModel",
        args: [{ modelId: "base.en" }],
        expected: ["transcription:activate-model", { modelId: "base.en" }],
      },
      {
        method: "activateCustomTranscriptionModel",
        args: [{ modelPath: "/tmp/model.bin" }],
        expected: ["transcription:activate-custom-model", { modelPath: "/tmp/model.bin" }],
      },
      {
        method: "removeTranscriptionModel",
        args: [{ modelId: "base.en" }],
        expected: ["transcription:remove-model", { modelId: "base.en" }],
      },
      {
        method: "testSessionTranscription",
        args: [{ sessionId: "session-1", options: { provider: "auto" } }],
        expected: ["transcription:test-session", { sessionId: "session-1", options: { provider: "auto" } }],
      },
      { method: "listSessions", args: [], expected: ["sessions:list"] },
      {
        method: "searchSessions",
        args: [{ query: "auth bug", mode: "both" }],
        expected: ["sessions:search", { query: "auth bug", mode: "both" }],
      },
      { method: "getSessionDetail", args: ["session-1"], expected: ["sessions:get-detail", "session-1"] },
      {
        method: "updateSessionDetail",
        args: [{ sessionId: "session-1", patch: { title: "Updated" } }],
        expected: ["sessions:update-detail", { sessionId: "session-1", patch: { title: "Updated" } }],
      },
      {
        method: "retranscribeSession",
        args: [{ sessionId: "session-1", options: { provider: "auto" } }],
        expected: ["sessions:retranscribe", { sessionId: "session-1", options: { provider: "auto" } }],
      },
      {
        method: "exportSession",
        args: [{ sessionId: "session-1", format: "md" }],
        expected: ["sessions:export", { sessionId: "session-1", format: "md" }],
      },
      { method: "openSessionMedia", args: ["session-1"], expected: ["sessions:open-media", "session-1"] },
      {
        method: "getSessionMediaPlayback",
        args: ["session-1"],
        expected: ["sessions:get-media-playback", "session-1"],
      },
      { method: "deleteSession", args: ["session-1"], expected: ["sessions:delete", "session-1"] },
      { method: "getStorageDir", args: [], expected: ["storage:get-dir"] },
      { method: "setStorageDir", args: ["/tmp/library"], expected: ["storage:set-dir", "/tmp/library"] },
      { method: "chooseStorageDir", args: [], expected: ["storage:choose-dir"] },
      {
        method: "migrateLibraryStorage",
        args: [{ nextStorageDir: "/tmp/new-library", mode: "move" }],
        expected: ["storage:migrate-library", { nextStorageDir: "/tmp/new-library", mode: "move" }],
      },
      {
        method: "cleanupLibraryStorage",
        args: ["/tmp/old-library"],
        expected: ["storage:cleanup-library", "/tmp/old-library"],
      },
      {
        method: "beginRecordingSession",
        args: [{ mimeType: "video/webm" }],
        expected: ["recording:begin-session", { mimeType: "video/webm" }],
      },
      {
        method: "appendRecordingChunk",
        args: [{ recordingSessionId: "recording-1", data: new ArrayBuffer(0) }],
        expected: [
          "recording:append-chunk",
          { recordingSessionId: "recording-1", data: new ArrayBuffer(0) },
        ],
      },
      {
        method: "finishRecordingSession",
        args: [{ recordingSessionId: "recording-1", mimeType: "video/webm", metadata: {} }],
        expected: [
          "recording:finish-session",
          { recordingSessionId: "recording-1", mimeType: "video/webm", metadata: {} },
        ],
      },
      {
        method: "cancelRecordingSession",
        args: ["recording-1"],
        expected: ["recording:cancel-session", "recording-1"],
      },
    ];

    for (const testCase of invokeCases) {
      await (api[testCase.method] as (...args: unknown[]) => Promise<unknown>)(...testCase.args);
      expect(invoke).toHaveBeenCalledWith(...testCase.expected);
    }

    const callback = vi.fn();
    const unsubscribe = (api.onHotkeyAction as (cb: (action: string) => void) => () => void)(callback);
    const hotkeyCall = on.mock.calls.find(([channel]) => channel === "hotkey:action");
    expect(hotkeyCall).toBeTruthy();

    const listener = hotkeyCall?.[1] as ((event: unknown, action: string) => void) | undefined;
    expect(listener).toBeTypeOf("function");
    listener?.({}, "pause-resume");
    expect(callback).toHaveBeenCalledWith("pause-resume");

    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith("hotkey:action", listener);

    const jobsCallback = vi.fn();
    const unsubscribeJobs = (
      api.onProcessingJobsUpdated as (cb: (jobs: unknown[]) => void) => () => void
    )(jobsCallback);
    const jobsCall = on.mock.calls.find(([channel]) => channel === "processing:jobs-updated");
    const jobsListener = jobsCall?.[1] as ((event: unknown, jobs: unknown[]) => void) | undefined;
    jobsListener?.({}, [{ id: "job-1" }]);
    expect(jobsCallback).toHaveBeenCalledWith([{ id: "job-1" }]);
    unsubscribeJobs();
    expect(removeListener).toHaveBeenCalledWith("processing:jobs-updated", jobsListener);

    const progressCallback = vi.fn();
    const unsubscribeProgress = (
      api.onTranscriptionModelDownloadProgress as (cb: (progress: unknown) => void) => () => void
    )(progressCallback);
    const progressCall = on.mock.calls.find(([channel]) => channel === "transcription:model-download-progress");
    const progressListener = progressCall?.[1] as
      | ((event: unknown, progress: { modelId: string; status: string }) => void)
      | undefined;
    progressListener?.({}, { modelId: "base.en", status: "downloading" });
    expect(progressCallback).toHaveBeenCalledWith({ modelId: "base.en", status: "downloading" });
    unsubscribeProgress();
    expect(removeListener).toHaveBeenCalledWith(
      "transcription:model-download-progress",
      progressListener,
    );
  });
});
