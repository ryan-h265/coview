export function formatConfiguredModelLabel(value) {
  if (!value) {
    return "not set";
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return "not set";
  }
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] || normalized;
}

export function formatByteCount(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024))} MiB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KiB`;
  }
  return `${bytes} B`;
}

export function formatDurationMs(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return "--:--";
  }
  const safeMs = Math.max(0, Math.round(durationMs));
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function getAudioLevelPercent(level) {
  return Math.max(0, Math.min(100, Math.round(level * 1400)));
}

export function toAudioModeLabel(value) {
  if (value === "both") {
    return "System + mic";
  }
  if (value === "mic") {
    return "Mic only";
  }
  if (value === "system") {
    return "System audio";
  }
  return "Audio unset";
}

export function formatSearchModeLabel(value) {
  if (value === "both") {
    return "keyword + similarity";
  }
  if (value === "semantic") {
    return "similarity";
  }
  if (value === "keyword") {
    return "keyword";
  }
  return "search";
}

export function formatDateTime(isoValue) {
  if (!isoValue) {
    return "-";
  }
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) {
    return isoValue;
  }
  return date.toLocaleString();
}

export function formatCompactDateTime(isoValue) {
  if (!isoValue) {
    return "-";
  }
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) {
    return isoValue;
  }
  return date.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getSessionDurationMs(session) {
  if (!session?.startedAt) {
    return 0;
  }
  const startedAtMs = new Date(session.startedAt).getTime();
  if (Number.isNaN(startedAtMs)) {
    return 0;
  }
  const endedAtMs = session.endedAt ? new Date(session.endedAt).getTime() : startedAtMs;
  if (Number.isNaN(endedAtMs)) {
    return 0;
  }
  return Math.max(0, endedAtMs - startedAtMs);
}

export function truncateText(value, maxLength) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}\u2026`;
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

export function parseTagInput(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index)
    .slice(0, 24);
}

export function computeThumbnailCaptureTimes(durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0.25) {
    return [0];
  }

  const maxSeekTime = Math.max(durationSeconds - 0.2, 0);
  const candidates = [
    durationSeconds * 0.2,
    durationSeconds * 0.35,
    durationSeconds * 0.5,
    durationSeconds * 0.65,
    durationSeconds * 0.8,
  ];

  return Array.from(
    new Set(
      candidates.map((timeSeconds) => {
        return Number(Math.min(Math.max(timeSeconds, 0.15), maxSeekTime).toFixed(3));
      }),
    ),
  );
}

export function formatTelemetryLine(rawLine) {
  try {
    const parsed = JSON.parse(rawLine);
    const at = typeof parsed.at === "string" ? parsed.at : "";
    const level = typeof parsed.level === "string" ? parsed.level.toUpperCase() : "INFO";
    const event = typeof parsed.event === "string" ? parsed.event : "event";
    const context =
      typeof parsed.context === "undefined" ? "" : ` ${JSON.stringify(parsed.context)}`;
    return `${at} ${level} ${event}${context}`;
  } catch {
    return rawLine;
  }
}

export function toDiagnosticsStatusLabel(ready, available) {
  if (ready) {
    return "Ready";
  }
  if (available === false) {
    return "Missing";
  }
  return "Needs setup";
}

export function toDiagnosticsStatusClass(ready) {
  return ready ? "diagnostic-status-ready" : "diagnostic-status-warning";
}
