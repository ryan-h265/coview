import { existsSync } from "node:fs";
import path from "node:path";

import { getShortUlidSuffix } from "./ulid";

export interface TranscriptSegmentLike {
  startMs: number;
  endMs: number;
  text: string;
}

export interface SessionSearchLike {
  title: string;
  sourceName?: string;
  summary: string;
  topics: string[];
  keywords: string[];
  transcriptText: string;
  searchTokenFrequency: Map<string, number>;
}

export interface SessionExportDetailLike {
  id: string;
  title: string;
  sourceName?: string;
  startedAt: string;
  endedAt?: string;
  processingStatus: string;
  summary: string;
  topics: string[];
  keywords: string[];
  transcriptText: string;
  transcriptSegments: TranscriptSegmentLike[];
}

const QUERY_SYNONYMS: Record<string, string[]> = {
  setup: ["configure", "configuration", "install", "installation", "onboarding"],
  configure: ["setup", "configuration", "configure"],
  config: ["configuration", "settings", "setup"],
  bug: ["issue", "error", "defect", "problem"],
  fix: ["resolve", "patch", "solution", "workaround"],
  deploy: ["deployment", "release", "rollout", "ship"],
  auth: ["authentication", "authorization", "login", "oauth"],
  api: ["endpoint", "service", "integration"],
  database: ["db", "postgres", "mysql", "schema", "migration"],
  infra: ["infrastructure", "kubernetes", "docker", "cloud"],
  performance: ["latency", "slow", "optimize", "optimization"],
};

const STOPWORDS = new Set([
  "a",
  "about",
  "above",
  "after",
  "again",
  "against",
  "all",
  "also",
  "am",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "doing",
  "down",
  "during",
  "each",
  "few",
  "for",
  "from",
  "further",
  "had",
  "has",
  "have",
  "having",
  "he",
  "her",
  "here",
  "hers",
  "herself",
  "him",
  "himself",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "itself",
  "just",
  "let",
  "me",
  "more",
  "most",
  "my",
  "myself",
  "no",
  "nor",
  "not",
  "now",
  "of",
  "off",
  "on",
  "once",
  "only",
  "or",
  "other",
  "our",
  "ours",
  "ourselves",
  "out",
  "over",
  "own",
  "same",
  "she",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "themselves",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "too",
  "under",
  "until",
  "up",
  "very",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "will",
  "with",
  "you",
  "your",
  "yours",
  "yourself",
  "yourselves",
]);

export function keywordScore(session: SessionSearchLike, queryTokens: string[]): number {
  if (queryTokens.length === 0) {
    return 0;
  }

  const weightedFields: Array<{ text: string; weight: number }> = [
    { text: session.title.toLowerCase(), weight: 8 },
    { text: (session.sourceName ?? "").toLowerCase(), weight: 3 },
    { text: session.summary.toLowerCase(), weight: 4 },
    { text: session.topics.join(" ").toLowerCase(), weight: 5 },
    { text: session.keywords.join(" ").toLowerCase(), weight: 5 },
    { text: session.transcriptText.toLowerCase(), weight: 1 },
  ];

  let score = 0;
  for (const token of queryTokens) {
    for (const field of weightedFields) {
      if (field.text.includes(token)) {
        score += field.weight;
      }
    }
  }
  return score;
}

export function semanticScore(
  session: Pick<SessionSearchLike, "searchTokenFrequency">,
  queryTokenFrequency: Map<string, number>,
): number {
  return cosineSimilarity(queryTokenFrequency, session.searchTokenFrequency);
}

export function buildMarkdownExport(detail: SessionExportDetailLike): string {
  const topics = detail.topics.length > 0 ? detail.topics.map((topic) => `- ${topic}`).join("\n") : "-";
  const keywords =
    detail.keywords.length > 0 ? detail.keywords.map((keyword) => `- ${keyword}`).join("\n") : "-";
  const transcript =
    detail.transcriptSegments.length > 0
      ? detail.transcriptSegments
          .map((segment) => `[${formatTranscriptTimestamp(segment.startMs)}] ${segment.text}`)
          .join("\n")
      : detail.transcriptText.length > 0
        ? detail.transcriptText
        : "(No transcript)";

  return `# ${detail.title}

## Metadata

- Session ID: ${detail.id}
- Source: ${detail.sourceName ?? "Slack"}
- Started At: ${detail.startedAt}
- Ended At: ${detail.endedAt ?? "-"}
- Processing Status: ${detail.processingStatus}

## Summary

${detail.summary}

## Topics

${topics}

## Keywords

${keywords}

## Transcript

${transcript}
`;
}

export function buildTextExport(detail: SessionExportDetailLike): string {
  const sections: string[] = [];
  sections.push(`Title: ${detail.title}`);
  sections.push(`Session ID: ${detail.id}`);
  sections.push(`Source: ${detail.sourceName ?? "Slack"}`);
  sections.push(`Started At: ${detail.startedAt}`);
  sections.push(`Ended At: ${detail.endedAt ?? "-"}`);
  sections.push(`Processing Status: ${detail.processingStatus}`);
  sections.push("");
  sections.push("Summary:");
  sections.push(detail.summary);
  sections.push("");
  sections.push("Topics:");
  sections.push(detail.topics.length > 0 ? detail.topics.join(", ") : "-");
  sections.push("");
  sections.push("Keywords:");
  sections.push(detail.keywords.length > 0 ? detail.keywords.join(", ") : "-");
  sections.push("");
  sections.push("Transcript:");
  sections.push(
    detail.transcriptSegments.length > 0
      ? detail.transcriptSegments
          .map((segment) => `[${formatTranscriptTimestamp(segment.startMs)}] ${segment.text}`)
          .join("\n")
      : detail.transcriptText.length > 0
        ? detail.transcriptText
        : "(No transcript)",
  );
  return sections.join("\n");
}

export function formatTranscriptTimestamp(valueMs: number): string {
  const safeMs = Math.max(0, Math.round(valueMs));
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function getMimeTypeForFile(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".webm") {
    return "video/webm";
  }
  if (extension === ".mp4") {
    return "video/mp4";
  }
  if (extension === ".wav") {
    return "audio/wav";
  }
  if (extension === ".m4a") {
    return "audio/mp4";
  }
  return "application/octet-stream";
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

export function tokenizeWords(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g);
  if (!matches) {
    return [];
  }
  return matches.filter((word) => !STOPWORDS.has(word));
}

export function getTopEntries(counter: Map<string, number>, maxCount: number): string[] {
  return [...counter.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, maxCount)
    .map((entry) => entry[0]);
}

export function toTopicLabel(value: string): string {
  return value
    .split(/[\s-]+/)
    .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

export function extractKeywords(text: string, maxCount = 8): string[] {
  const words = tokenizeWords(text);
  const counter = new Map<string, number>();
  for (const word of words) {
    counter.set(word, (counter.get(word) ?? 0) + 1);
  }
  return getTopEntries(counter, maxCount);
}

export function extractTopics(text: string, maxCount = 5): string[] {
  const words = tokenizeWords(text);
  const bigramCounter = new Map<string, number>();
  for (let index = 0; index < words.length - 1; index += 1) {
    const current = words[index];
    const next = words[index + 1];
    if (current.length < 3 || next.length < 3) {
      continue;
    }
    const phrase = `${current} ${next}`;
    bigramCounter.set(phrase, (bigramCounter.get(phrase) ?? 0) + 1);
  }

  const bigramTopics = getTopEntries(bigramCounter, maxCount).map((value) => toTopicLabel(value));
  if (bigramTopics.length >= maxCount) {
    return bigramTopics.slice(0, maxCount);
  }

  const keywordTopics = extractKeywords(text, maxCount)
    .map((value) => toTopicLabel(value))
    .filter((topic) => !bigramTopics.includes(topic));
  return [...bigramTopics, ...keywordTopics].slice(0, maxCount);
}

export function buildSummary(text: string, topics: string[]): string {
  const sentences = splitSentences(text);
  if (sentences.length >= 2) {
    return `${sentences[0]} ${sentences[1]}`.trim();
  }
  if (sentences.length === 1) {
    return sentences[0];
  }

  if (topics.length > 0) {
    return `The call covered ${topics.slice(0, 3).join(", ")}.`;
  }
  return "No meaningful speech content was detected in this recording.";
}

export function sanitizeTranscriptText(value: string): string {
  return value.replace(/\u0000/g, "").replace(/\r\n/g, "\n").trim();
}

export function sanitizeSessionTitle(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return fallback;
  }
  return trimmed.slice(0, 180);
}

export function toSearchTokens(text: string): string[] {
  const normalized = text.toLowerCase().match(/[a-z0-9][a-z0-9-]{1,}/g);
  if (!normalized) {
    return [];
  }
  return normalized
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

export function toTokenFrequency(tokens: string[]): Map<string, number> {
  const frequency = new Map<string, number>();
  for (const token of tokens) {
    frequency.set(token, (frequency.get(token) ?? 0) + 1);
  }
  return frequency;
}

export function cosineSimilarity(left: Map<string, number>, right: Map<string, number>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (const value of left.values()) {
    leftMagnitude += value * value;
  }
  for (const value of right.values()) {
    rightMagnitude += value * value;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  for (const [token, leftValue] of left.entries()) {
    const rightValue = right.get(token) ?? 0;
    if (rightValue > 0) {
      dot += leftValue * rightValue;
    }
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export function expandQueryTokens(
  tokens: string[],
  synonymsMap: Record<string, string[]> = QUERY_SYNONYMS,
): string[] {
  const expanded = new Set<string>();
  for (const token of tokens) {
    expanded.add(token);
    const synonyms = synonymsMap[token] ?? [];
    for (const synonym of synonyms) {
      expanded.add(synonym);
    }
  }
  return [...expanded];
}

export function getTranscriptSnippet(text: string, maxChars = 220): string {
  const trimmed = sanitizeTranscriptText(text);
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxChars)}...`;
}

export function buildSearchText(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(" \n");
}

export function formatExportTimestamp(isoValue: string): string {
  const date = new Date(isoValue);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}`;
}

export function getDisambiguatedPathIfNeeded(filePath: string): string {
  if (!existsSync(filePath)) {
    return filePath;
  }

  const directory = path.dirname(filePath);
  const extension = path.extname(filePath);
  const basename = path.basename(filePath, extension);
  let candidateIndex = 2;
  while (true) {
    const candidatePath = path.join(directory, `${basename}-${candidateIndex}${extension}`);
    if (!existsSync(candidatePath)) {
      return candidatePath;
    }
    candidateIndex += 1;
  }
}

function formatDateForFilename(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function sanitizeFileComponent(value: string): string {
  const normalized = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "");
  const collapsed = normalized.replace(/\s+/g, "_");
  const trimmed = collapsed.slice(0, 80);
  return trimmed.length > 0 ? trimmed : "recording";
}

export function buildRecordingFileStem(startedAtIso: string, title: string, sessionId: string): string {
  const startedAt = new Date(startedAtIso);
  const safeStartedAt = Number.isNaN(startedAt.getTime()) ? new Date() : startedAt;
  return `${formatDateForFilename(safeStartedAt)}_${sanitizeFileComponent(title)}_${getShortUlidSuffix(
    sessionId,
  )}`;
}

export function getRecordingDurationMs(startedAtIso: string, endedAtIso: string): number {
  const startedAt = new Date(startedAtIso).getTime();
  const endedAt = new Date(endedAtIso).getTime();
  if (Number.isNaN(startedAt) || Number.isNaN(endedAt)) {
    return 0;
  }
  return Math.max(0, endedAt - startedAt);
}

export function buildPreviewText(text: string, maxChars = 220): string {
  const normalized = sanitizeTranscriptText(text);
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars)}...`;
}

export function computeArtifacts(mediaPath: string, transcriptSegmentsFilenameSuffix: string): {
  transcriptPath: string;
  transcriptSegmentsPath: string;
  analysisPath: string;
} {
  const directory = path.dirname(mediaPath);
  const stem = path.basename(mediaPath, path.extname(mediaPath));
  return {
    transcriptPath: path.join(directory, `${stem}.transcript.txt`),
    transcriptSegmentsPath: path.join(directory, `${stem}${transcriptSegmentsFilenameSuffix}`),
    analysisPath: path.join(directory, `${stem}.analysis.json`),
  };
}
