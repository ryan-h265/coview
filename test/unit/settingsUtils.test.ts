import { describe, expect, it } from "vitest";

import {
  clampTelemetryTailLines,
  getEffectiveSettings,
  getEffectiveTranscriptionOptions,
  sanitizeTranscriptionLanguage,
  sanitizeTranscriptionSetupState,
} from "../../src/settingsUtils";

const effectiveSettingsOptions = {
  defaultStorageDir: "/tmp/coview-recordings",
  defaultAutoRecordEnabled: true,
  defaultAiProcessingEnabled: false,
  defaultInactivityTimeoutMinutes: 60,
  minInactivityTimeoutMinutes: 1,
  maxInactivityTimeoutMinutes: 1440,
  defaultTranscriptionLanguage: "en",
  defaultHotkeys: {
    startStop: "CommandOrControl+Shift+R",
    pauseResume: "CommandOrControl+Shift+P",
    autoToggle: "CommandOrControl+Shift+A",
  },
} as const;

describe("settingsUtils", () => {
  it("clamps telemetry tail requests to safe bounds", () => {
    expect(clampTelemetryTailLines(undefined, 120, 1000)).toBe(120);
    expect(clampTelemetryTailLines(0, 120, 1000)).toBe(1);
    expect(clampTelemetryTailLines(1500, 120, 1000)).toBe(1000);
    expect(clampTelemetryTailLines(12.6, 120, 1000)).toBe(13);
  });

  it("normalizes effective transcription options", () => {
    expect(
      getEffectiveTranscriptionOptions(
        {
          provider: "local-whisper-cli",
          model: "  /tmp/model.bin  ",
          language: " EN-gb ",
        },
        "en",
      ),
    ).toEqual({
      provider: "local-whisper-cli",
      model: "/tmp/model.bin",
      language: "en-gb",
    });

    expect(getEffectiveTranscriptionOptions({}, "en")).toEqual({
      provider: "auto",
      model: undefined,
      language: "en",
    });
  });

  it("rejects invalid transcription language overrides", () => {
    expect(sanitizeTranscriptionLanguage("auto", "en")).toBe("auto");
    expect(() => sanitizeTranscriptionLanguage("english (us)", "en")).toThrow(
      "Invalid transcription language override.",
    );
  });

  it("sanitizes transcription setup state based on status", () => {
    expect(
      sanitizeTranscriptionSetupState({
        status: "completed",
        completedAt: " 2026-03-09T09:00:00.000Z ",
        dismissedAt: "2026-03-09T09:01:00.000Z",
        modelPath: " /tmp/model.bin ",
        modelId: " base.en ",
      }),
    ).toEqual({
      status: "completed",
      completedAt: "2026-03-09T09:00:00.000Z",
      dismissedAt: undefined,
      modelPath: "/tmp/model.bin",
      modelId: "base.en",
    });

    expect(
      sanitizeTranscriptionSetupState({
        status: "dismissed",
        completedAt: "2026-03-09T09:00:00.000Z",
        dismissedAt: "2026-03-09T09:01:00.000Z",
      }),
    ).toEqual({
      status: "dismissed",
      completedAt: undefined,
      dismissedAt: "2026-03-09T09:01:00.000Z",
      modelPath: undefined,
      modelId: undefined,
    });
  });

  it("builds effective settings with defaults, clamps, and sanitized setup state", () => {
    const settings = getEffectiveSettings(
      {
        storageDir: "   ",
        autoRecordEnabled: false,
        aiProcessingEnabled: true,
        inactivityTimeoutMinutes: 5000,
        hotkeys: {
          startStop: "  ",
          pauseResume: "Alt+P",
        },
        transcriptionDefaults: {
          provider: "local-whisper-python",
          model: " /tmp/python-model.bin ",
          language: "fr",
        },
        transcriptionSetup: {
          status: "completed",
          completedAt: "2026-03-09T09:30:00.000Z",
          modelPath: " /tmp/override.bin ",
          modelId: " custom-model ",
        },
      },
      effectiveSettingsOptions,
    );

    expect(settings).toEqual({
      storageDir: "/tmp/coview-recordings",
      autoRecordEnabled: false,
      aiProcessingEnabled: true,
      inactivityTimeoutMinutes: 1440,
      hotkeys: {
        startStop: "CommandOrControl+Shift+R",
        pauseResume: "Alt+P",
        autoToggle: "CommandOrControl+Shift+A",
      },
      transcriptionDefaults: {
        provider: "local-whisper-python",
        model: "/tmp/python-model.bin",
        language: "fr",
      },
      transcriptionSetup: {
        status: "completed",
        completedAt: "2026-03-09T09:30:00.000Z",
        dismissedAt: undefined,
        modelPath: "/tmp/override.bin",
        modelId: "custom-model",
      },
    });
  });
});
