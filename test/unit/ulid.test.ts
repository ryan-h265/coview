import { describe, expect, it } from "vitest";

import { createMonotonicUlid, getShortUlidSuffix } from "../../src/ulid";

describe("ULID helpers", () => {
  it("creates lexicographically monotonic ULIDs for the same timestamp", () => {
    const timestamp = Date.UTC(2026, 2, 7, 12, 0, 0);
    const first = createMonotonicUlid(timestamp);
    const second = createMonotonicUlid(timestamp);
    const third = createMonotonicUlid(timestamp);

    expect(first < second).toBe(true);
    expect(second < third).toBe(true);
  });

  it("returns a readable short suffix", () => {
    const value = createMonotonicUlid(Date.UTC(2026, 2, 7, 12, 0, 1));
    expect(getShortUlidSuffix(value, 8)).toHaveLength(8);
  });

  it("rejects invalid timestamps", () => {
    expect(() => createMonotonicUlid(-1)).toThrow("ULID timestamp must be a non-negative integer.");
    expect(() => createMonotonicUlid(1.5)).toThrow("ULID timestamp must be a non-negative integer.");
  });
});
