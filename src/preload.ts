import { contextBridge, ipcRenderer } from "electron";

import {
  IPC_CHANNELS,
  type CoviewApi,
  type HotkeyAction,
  type ProcessingJobPayload,
  type WhisperModelDownloadProgressPayload,
} from "./ipcContracts";

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => {
    callback(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: CoviewApi = {
  getPermissionStatus: async () => {
    return ipcRenderer.invoke(IPC_CHANNELS.permissions.getStatus);
  },
  requestMicrophonePermission: async () => {
    return ipcRenderer.invoke(IPC_CHANNELS.permissions.requestMicrophone);
  },
  openScreenPermissionSettings: async () => {
    return ipcRenderer.invoke(IPC_CHANNELS.permissions.openScreenSettings);
  },
  listCaptureSources: async (sourceType) => {
    return ipcRenderer.invoke(IPC_CHANNELS.capture.listSources, sourceType);
  },
  getSettings: async () => {
    return ipcRenderer.invoke(IPC_CHANNELS.settings.get);
  },
  updateSettings: async (patch) => {
    return ipcRenderer.invoke(IPC_CHANNELS.settings.update, patch);
  },
  getTelemetryLogPath: async () => {
    return ipcRenderer.invoke(IPC_CHANNELS.telemetry.getLogPath);
  },
  getTelemetryLogTail: async (maxLines) => {
    return ipcRenderer.invoke(IPC_CHANNELS.telemetry.getLogTail, maxLines);
  },
  openTelemetryLogDir: async () => {
    return ipcRenderer.invoke(IPC_CHANNELS.telemetry.openLogDir);
  },
  getSlackActivitySignal: async () => {
    return ipcRenderer.invoke(IPC_CHANNELS.slack.getActivitySignal);
  },
  onHotkeyAction: (callback) => {
    return subscribe<HotkeyAction>(IPC_CHANNELS.hotkeyAction, callback);
  },
  listProcessingJobs: async () => {
    return ipcRenderer.invoke(IPC_CHANNELS.processing.listJobs);
  },
  retryProcessingJob: async (jobId) => {
    return ipcRenderer.invoke(IPC_CHANNELS.processing.retryJob, jobId);
  },
  getTranscriptionDiagnostics: async () => {
    return ipcRenderer.invoke(IPC_CHANNELS.transcription.getDiagnostics);
  },
  listTranscriptionModels: async () => {
    return ipcRenderer.invoke(IPC_CHANNELS.transcription.listModels);
  },
  downloadRecommendedTranscriptionModel: async (payload) => {
    return ipcRenderer.invoke(IPC_CHANNELS.transcription.downloadModel, payload);
  },
  chooseTranscriptionModelFile: async () => {
    return ipcRenderer.invoke(IPC_CHANNELS.transcription.chooseModelFile);
  },
  activateTranscriptionModel: async (payload) => {
    return ipcRenderer.invoke(IPC_CHANNELS.transcription.activateModel, payload);
  },
  activateCustomTranscriptionModel: async (payload) => {
    return ipcRenderer.invoke(IPC_CHANNELS.transcription.activateCustomModel, payload);
  },
  removeTranscriptionModel: async (payload) => {
    return ipcRenderer.invoke(IPC_CHANNELS.transcription.removeModel, payload);
  },
  onTranscriptionModelDownloadProgress: (callback) => {
    return subscribe<WhisperModelDownloadProgressPayload>(
      IPC_CHANNELS.transcription.modelDownloadProgress,
      callback,
    );
  },
  testSessionTranscription: async (payload) => {
    return ipcRenderer.invoke(IPC_CHANNELS.transcription.testSession, payload);
  },
  onProcessingJobsUpdated: (callback) => {
    return subscribe<ProcessingJobPayload[]>(IPC_CHANNELS.processing.jobsUpdated, callback);
  },
  listSessions: async () => {
    return ipcRenderer.invoke(IPC_CHANNELS.sessions.list);
  },
  searchSessions: async (payload) => {
    return ipcRenderer.invoke(IPC_CHANNELS.sessions.search, payload);
  },
  getSessionDetail: async (sessionId) => {
    return ipcRenderer.invoke(IPC_CHANNELS.sessions.getDetail, sessionId);
  },
  updateSessionDetail: async (payload) => {
    return ipcRenderer.invoke(IPC_CHANNELS.sessions.updateDetail, payload);
  },
  retranscribeSession: async (payload) => {
    return ipcRenderer.invoke(IPC_CHANNELS.sessions.retranscribe, payload);
  },
  exportSession: async (payload) => {
    return ipcRenderer.invoke(IPC_CHANNELS.sessions.export, payload);
  },
  openSessionMedia: async (sessionId) => {
    return ipcRenderer.invoke(IPC_CHANNELS.sessions.openMedia, sessionId);
  },
  getSessionMediaPlayback: async (sessionId) => {
    return ipcRenderer.invoke(IPC_CHANNELS.sessions.getMediaPlayback, sessionId);
  },
  deleteSession: async (sessionId) => {
    return ipcRenderer.invoke(IPC_CHANNELS.sessions.delete, sessionId);
  },
  getStorageDir: async () => {
    return ipcRenderer.invoke(IPC_CHANNELS.storage.getDir);
  },
  setStorageDir: async (storageDir) => {
    return ipcRenderer.invoke(IPC_CHANNELS.storage.setDir, storageDir);
  },
  chooseStorageDir: async () => {
    return ipcRenderer.invoke(IPC_CHANNELS.storage.chooseDir);
  },
  migrateLibraryStorage: async (payload) => {
    return ipcRenderer.invoke(IPC_CHANNELS.storage.migrateLibrary, payload);
  },
  cleanupLibraryStorage: async (storageDir) => {
    return ipcRenderer.invoke(IPC_CHANNELS.storage.cleanupLibrary, storageDir);
  },
  beginRecordingSession: async (payload) => {
    return ipcRenderer.invoke(IPC_CHANNELS.recording.beginSession, payload);
  },
  appendRecordingChunk: async (payload) => {
    return ipcRenderer.invoke(IPC_CHANNELS.recording.appendChunk, payload);
  },
  finishRecordingSession: async (payload) => {
    return ipcRenderer.invoke(IPC_CHANNELS.recording.finishSession, payload);
  },
  cancelRecordingSession: async (recordingSessionId) => {
    return ipcRenderer.invoke(IPC_CHANNELS.recording.cancelSession, recordingSessionId);
  },
};

contextBridge.exposeInMainWorld("coview", api);
