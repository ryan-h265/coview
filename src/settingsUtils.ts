export interface HotkeySettingsLike {
  startStop: string;
  pauseResume: string;
  autoToggle: string;
}

export interface TranscriptionRequestOptionsLike {
  provider?: string;
  model?: string;
  language?: string;
}

export interface EffectiveTranscriptionRequestOptionsLike {
  provider: "auto" | "local-whisper-cli" | "local-whisper-python";
  model?: string;
  language: string;
}

export interface TranscriptionSetupStateLike {
  status?: string;
  completedAt?: string;
  dismissedAt?: string;
  modelPath?: string;
  modelId?: string;
}

export interface EffectiveTranscriptionSetupStateLike {
  status: "pending" | "dismissed" | "completed";
  completedAt?: string;
  dismissedAt?: string;
  modelPath?: string;
  modelId?: string;
}

export interface AppSettingsLike {
  storageDir?: string;
  autoRecordEnabled?: boolean;
  aiProcessingEnabled?: boolean;
  inactivityTimeoutMinutes?: number;
  hotkeys?: Partial<HotkeySettingsLike>;
  transcriptionDefaults?: Partial<TranscriptionRequestOptionsLike>;
  transcriptionSetup?: Partial<TranscriptionSetupStateLike>;
}

export interface EffectiveSettingsLike {
  storageDir: string;
  autoRecordEnabled: boolean;
  aiProcessingEnabled: boolean;
  inactivityTimeoutMinutes: number;
  hotkeys: HotkeySettingsLike;
  transcriptionDefaults: EffectiveTranscriptionRequestOptionsLike;
  transcriptionSetup: EffectiveTranscriptionSetupStateLike;
}

export interface EffectiveSettingsOptions {
  defaultStorageDir: string;
  defaultAutoRecordEnabled: boolean;
  defaultAiProcessingEnabled: boolean;
  defaultInactivityTimeoutMinutes: number;
  minInactivityTimeoutMinutes: number;
  maxInactivityTimeoutMinutes: number;
  defaultTranscriptionLanguage: string;
  defaultHotkeys: HotkeySettingsLike;
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampTelemetryTailLines(
  value: unknown,
  defaultTailLines: number,
  maxTailLines: number,
): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return defaultTailLines;
  }
  return clampNumber(Math.round(value), 1, maxTailLines);
}

export function sanitizeHotkey(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

export function parseTranscriptionProvider(
  value: unknown,
): EffectiveTranscriptionRequestOptionsLike["provider"] | undefined {
  if (value === "auto" || value === "local-whisper-cli" || value === "local-whisper-python") {
    return value;
  }
  return undefined;
}

export function sanitizeTranscriptionModel(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }
  return normalized.slice(0, 512);
}

export function sanitizeTranscriptionLanguage(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return fallback;
  }
  if (normalized === "auto") {
    return "auto";
  }
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(normalized)) {
    throw new Error("Invalid transcription language override.");
  }
  return normalized;
}

export function parseTranscriptionSetupStatus(
  value: unknown,
): EffectiveTranscriptionSetupStateLike["status"] | undefined {
  if (value === "pending" || value === "dismissed" || value === "completed") {
    return value;
  }
  return undefined;
}

export function sanitizeIsoDateTime(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized.slice(0, 64) : undefined;
}

export function sanitizeTranscriptionSetupState(
  value: Partial<TranscriptionSetupStateLike> | undefined,
  fallbackModelPath?: string,
): EffectiveTranscriptionSetupStateLike {
  const status = parseTranscriptionSetupStatus(value?.status) ?? "pending";
  const modelPath = sanitizeTranscriptionModel(value?.modelPath) ?? fallbackModelPath;
  const modelIdCandidate = typeof value?.modelId === "string" ? value.modelId.trim() : "";
  const modelId = modelIdCandidate.length > 0 ? modelIdCandidate.slice(0, 64) : undefined;

  return {
    status,
    completedAt: status === "completed" ? sanitizeIsoDateTime(value?.completedAt) : undefined,
    dismissedAt: status === "dismissed" ? sanitizeIsoDateTime(value?.dismissedAt) : undefined,
    modelPath,
    modelId,
  };
}

export function getEffectiveTranscriptionOptions(
  raw: Partial<TranscriptionRequestOptionsLike> | undefined,
  defaultLanguage: string,
): EffectiveTranscriptionRequestOptionsLike {
  return {
    provider: parseTranscriptionProvider(raw?.provider) ?? "auto",
    model: sanitizeTranscriptionModel(raw?.model),
    language: sanitizeTranscriptionLanguage(raw?.language, defaultLanguage),
  };
}

export function getEffectiveSettings(
  raw: AppSettingsLike,
  options: EffectiveSettingsOptions,
): EffectiveSettingsLike {
  const storageDirCandidate = typeof raw.storageDir === "string" ? raw.storageDir.trim() : "";
  const storageDir =
    storageDirCandidate.length > 0 ? storageDirCandidate : options.defaultStorageDir;
  const transcriptionDefaults = getEffectiveTranscriptionOptions(
    raw.transcriptionDefaults,
    options.defaultTranscriptionLanguage,
  );

  const hotkeys: HotkeySettingsLike = {
    startStop: sanitizeHotkey(raw.hotkeys?.startStop, options.defaultHotkeys.startStop),
    pauseResume: sanitizeHotkey(raw.hotkeys?.pauseResume, options.defaultHotkeys.pauseResume),
    autoToggle: sanitizeHotkey(raw.hotkeys?.autoToggle, options.defaultHotkeys.autoToggle),
  };

  const timeoutCandidate =
    typeof raw.inactivityTimeoutMinutes === "number"
      ? raw.inactivityTimeoutMinutes
      : options.defaultInactivityTimeoutMinutes;

  const inactivityTimeoutMinutes = clampNumber(
    Math.round(timeoutCandidate),
    options.minInactivityTimeoutMinutes,
    options.maxInactivityTimeoutMinutes,
  );

  return {
    storageDir,
    autoRecordEnabled: raw.autoRecordEnabled ?? options.defaultAutoRecordEnabled,
    aiProcessingEnabled: raw.aiProcessingEnabled ?? options.defaultAiProcessingEnabled,
    inactivityTimeoutMinutes,
    hotkeys,
    transcriptionDefaults,
    transcriptionSetup: sanitizeTranscriptionSetupState(
      raw.transcriptionSetup,
      transcriptionDefaults.model,
    ),
  };
}
