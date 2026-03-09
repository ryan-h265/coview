import { describe, expect, it } from "vitest";

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
} from "../../src/rendererUtils.js";

describe("rendererUtils", () => {
  it("formats model labels, byte counts, and durations", () => {
    expect(formatConfiguredModelLabel("/tmp/models/ggml-base.en.bin")).toBe("ggml-base.en.bin");
    expect(formatConfiguredModelLabel("   ")).toBe("not set");
    expect(formatByteCount(0)).toBe("0 B");
    expect(formatByteCount(1536)).toBe("2 KiB");
    expect(formatDurationMs(-1)).toBe("--:--");
    expect(formatDurationMs(3723000)).toBe("01:02:03");
  });

  it("formats transport and search labels", () => {
    expect(getAudioLevelPercent(0.2)).toBe(100);
    expect(getAudioLevelPercent(-1)).toBe(0);
    expect(toAudioModeLabel("both")).toBe("System + mic");
    expect(toAudioModeLabel("unknown")).toBe("Audio unset");
    expect(formatSearchModeLabel("semantic")).toBe("similarity");
    expect(formatSearchModeLabel("other")).toBe("search");
  });

  it("normalizes display text and tags", () => {
    expect(truncateText("  Alpha   beta gamma  ", 12)).toBe("Alpha beta\u2026");
    expect(escapeHtml(`<tag attr="x">&'</tag>`)).toBe(
      "&lt;tag attr=&quot;x&quot;&gt;&amp;&#39;&lt;/tag&gt;",
    );
    expect(parseTagInput("api, auth, api,  , release")).toEqual(["api", "auth", "release"]);
  });

  it("computes thumbnail capture times and session duration", () => {
    expect(computeThumbnailCaptureTimes(0.1)).toEqual([0]);
    expect(computeThumbnailCaptureTimes(10)).toEqual([2, 3.5, 5, 6.5, 8]);
    expect(
      getSessionDurationMs({
        startedAt: "2026-03-09T09:00:00.000Z",
        endedAt: "2026-03-09T09:05:00.000Z",
      }),
    ).toBe(300000);
    expect(getSessionDurationMs({ startedAt: "bad-date" })).toBe(0);
  });

  it("formats telemetry lines and diagnostics status labels", () => {
    expect(
      formatTelemetryLine(
        JSON.stringify({
          at: "2026-03-09T09:00:00.000Z",
          level: "warn",
          event: "telemetry.test",
          context: {
            ok: true,
          },
        }),
      ),
    ).toBe('2026-03-09T09:00:00.000Z WARN telemetry.test {"ok":true}');
    expect(formatTelemetryLine("plain line")).toBe("plain line");
    expect(toDiagnosticsStatusLabel(true, true)).toBe("Ready");
    expect(toDiagnosticsStatusLabel(false, false)).toBe("Missing");
    expect(toDiagnosticsStatusClass(true)).toBe("diagnostic-status-ready");
    expect(toDiagnosticsStatusClass(false)).toBe("diagnostic-status-warning");
  });

  it("handles missing and invalid date strings", () => {
    expect(formatDateTime("")).toBe("-");
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
    expect(formatCompactDateTime("")).toBe("-");
    expect(formatCompactDateTime("not-a-date")).toBe("not-a-date");
  });
});
