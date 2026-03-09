export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscriptSegmentsArtifact {
  version: number;
  generatedAt?: string;
  provider?: string;
  model?: string;
  language?: string;
  segments: TranscriptSegment[];
}

export interface TranscriptParseResult {
  text: string;
  language?: string;
  segments: TranscriptSegment[];
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function parseTimestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }

  if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    return Math.round(Number(normalized));
  }

  const match = normalized.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})([.,](\d{1,3}))?$/);
  if (!match) {
    return undefined;
  }

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = match[5] ? Number(match[5].padEnd(3, "0")) : 0;

  return (((hours * 60 + minutes) * 60) + seconds) * 1000 + milliseconds;
}

function sanitizeSegmentText(value: string): string {
  return value.replace(/\u0000/g, "").replace(/\r\n/g, "\n").trim();
}

function normalizeSegment(
  startMs: number | undefined,
  endMs: number | undefined,
  text: unknown,
): TranscriptSegment | null {
  if (typeof text !== "string") {
    return null;
  }

  const cleanedText = sanitizeSegmentText(text);
  if (cleanedText.length === 0 || typeof startMs !== "number" || !Number.isFinite(startMs)) {
    return null;
  }

  const safeStartMs = Math.max(0, Math.round(startMs));
  const safeEndMs =
    typeof endMs === "number" && Number.isFinite(endMs)
      ? Math.max(safeStartMs, Math.round(endMs))
      : safeStartMs;

  return {
    startMs: safeStartMs,
    endMs: safeEndMs,
    text: cleanedText,
  };
}

function parseWhisperCliSegment(value: unknown): TranscriptSegment | null {
  const entry = asObject(value);
  if (!entry) {
    return null;
  }

  const offsets = asObject(entry.offsets);
  const timestamps = asObject(entry.timestamps);
  const startMs =
    parseNumber(offsets?.from) ??
    parseTimestampMs(timestamps?.from);
  const endMs =
    parseNumber(offsets?.to) ??
    parseTimestampMs(timestamps?.to);

  return normalizeSegment(startMs, endMs, entry.text);
}

function parseWhisperPythonSegment(value: unknown): TranscriptSegment | null {
  const entry = asObject(value);
  if (!entry) {
    return null;
  }

  const startSeconds = parseNumber(entry.start);
  const endSeconds = parseNumber(entry.end);
  const startMs = typeof startSeconds === "number" ? startSeconds * 1000 : undefined;
  const endMs = typeof endSeconds === "number" ? endSeconds * 1000 : undefined;
  return normalizeSegment(startMs, endMs, entry.text);
}

function parseStoredSegment(value: unknown): TranscriptSegment | null {
  const entry = asObject(value);
  if (!entry) {
    return null;
  }

  return normalizeSegment(parseNumber(entry.startMs), parseNumber(entry.endMs), entry.text);
}

function collectTranscriptTextLines(values: unknown[]): string[] {
  return values
    .map((value) => {
      const entry = asObject(value);
      return typeof entry?.text === "string" ? sanitizeSegmentText(entry.text) : "";
    })
    .filter((value) => value.length > 0);
}

function normalizeSegments(values: unknown[], parser: (value: unknown) => TranscriptSegment | null): TranscriptSegment[] {
  return values
    .map((value) => parser(value))
    .filter((segment): segment is TranscriptSegment => Boolean(segment));
}

export function buildTranscriptTextFromSegments(segments: TranscriptSegment[]): string {
  return segments
    .map((segment) => sanitizeSegmentText(segment.text))
    .filter((segment) => segment.length > 0)
    .join("\n")
    .trim();
}

export function createTranscriptSegmentsArtifact(params: {
  generatedAt: string;
  provider: string;
  model: string;
  language: string;
  segments: TranscriptSegment[];
}): TranscriptSegmentsArtifact {
  return {
    version: 1,
    generatedAt: params.generatedAt,
    provider: params.provider,
    model: params.model,
    language: params.language,
    segments: params.segments.map((segment) => ({
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
    })),
  };
}

export function readTranscriptSegmentsArtifact(raw: string): TranscriptSegmentsArtifact {
  const parsed = JSON.parse(raw) as unknown;

  if (Array.isArray(parsed)) {
    return {
      version: 1,
      segments: normalizeSegments(parsed, parseStoredSegment),
    };
  }

  const artifact = asObject(parsed);
  if (!artifact) {
    return {
      version: 1,
      segments: [],
    };
  }

  return {
    version: parseNumber(artifact.version) ?? 1,
    generatedAt: typeof artifact.generatedAt === "string" ? artifact.generatedAt : undefined,
    provider: typeof artifact.provider === "string" ? artifact.provider : undefined,
    model: typeof artifact.model === "string" ? artifact.model : undefined,
    language: typeof artifact.language === "string" ? artifact.language : undefined,
    segments: normalizeSegments(Array.isArray(artifact.segments) ? artifact.segments : [], parseStoredSegment),
  };
}

export function parseWhisperCliTranscriptJson(raw: string): TranscriptParseResult {
  const parsed = JSON.parse(raw) as unknown;
  const result = asObject(parsed);
  if (!result) {
    throw new Error("whisper-cli produced invalid JSON");
  }

  const transcriptionEntries = Array.isArray(result.transcription) ? result.transcription : [];
  const segments = normalizeSegments(transcriptionEntries, parseWhisperCliSegment);
  const fallbackText = collectTranscriptTextLines(transcriptionEntries).join("\n").trim();
  const metadata = asObject(result.result);
  const params = asObject(result.params);
  const language =
    typeof metadata?.language === "string"
      ? metadata.language
      : typeof params?.language === "string"
        ? params.language
        : undefined;
  const text = segments.length > 0 ? buildTranscriptTextFromSegments(segments) : fallbackText;

  if (text.length === 0) {
    throw new Error("whisper-cli produced empty transcript");
  }

  return {
    text,
    language,
    segments,
  };
}

export function parseWhisperPythonTranscriptJson(raw: string): TranscriptParseResult {
  const parsed = JSON.parse(raw) as unknown;
  const result = asObject(parsed);
  if (!result) {
    throw new Error("python whisper produced invalid JSON");
  }

  const segmentEntries = Array.isArray(result.segments) ? result.segments : [];
  const segments = normalizeSegments(segmentEntries, parseWhisperPythonSegment);
  const fallbackText = typeof result.text === "string" ? sanitizeSegmentText(result.text) : "";
  const text = segments.length > 0 ? buildTranscriptTextFromSegments(segments) : fallbackText;

  if (text.length === 0) {
    throw new Error("python whisper produced empty transcript");
  }

  return {
    text,
    language: typeof result.language === "string" ? result.language : undefined,
    segments,
  };
}
