import { randomBytes } from "node:crypto";

const ULID_ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID_TIME_LENGTH = 10;
const ULID_RANDOM_LENGTH = 16;
const ULID_RANDOM_MASK = 31n;

let lastTimestamp = -1;
let lastRandomDigits: number[] | null = null;

function encodeTime(timestamp: number): string {
  let value = BigInt(timestamp);
  const output = new Array<string>(ULID_TIME_LENGTH);
  for (let index = ULID_TIME_LENGTH - 1; index >= 0; index -= 1) {
    output[index] = ULID_ENCODING[Number(value & ULID_RANDOM_MASK)];
    value >>= 5n;
  }
  return output.join("");
}

function createRandomDigits(): number[] {
  let value = 0n;
  for (const byte of randomBytes(10)) {
    value = (value << 8n) | BigInt(byte);
  }

  const digits = new Array<number>(ULID_RANDOM_LENGTH);
  for (let index = ULID_RANDOM_LENGTH - 1; index >= 0; index -= 1) {
    digits[index] = Number(value & ULID_RANDOM_MASK);
    value >>= 5n;
  }
  return digits;
}

function incrementRandomDigits(previousDigits: number[]): number[] {
  const nextDigits = [...previousDigits];
  for (let index = nextDigits.length - 1; index >= 0; index -= 1) {
    if (nextDigits[index] < 31) {
      nextDigits[index] += 1;
      return nextDigits;
    }
    nextDigits[index] = 0;
  }
  return nextDigits;
}

function encodeRandomDigits(digits: number[]): string {
  return digits.map((digit) => ULID_ENCODING[digit]).join("");
}

export function createMonotonicUlid(timestamp = Date.now()): string {
  if (!Number.isInteger(timestamp) || timestamp < 0) {
    throw new Error("ULID timestamp must be a non-negative integer.");
  }

  if (timestamp > lastTimestamp || !lastRandomDigits) {
    lastTimestamp = timestamp;
    lastRandomDigits = createRandomDigits();
  } else {
    lastTimestamp = timestamp;
    lastRandomDigits = incrementRandomDigits(lastRandomDigits);
  }

  return `${encodeTime(timestamp)}${encodeRandomDigits(lastRandomDigits)}`;
}

export function getShortUlidSuffix(value: string, length = 8): string {
  return value.slice(Math.max(0, value.length - length));
}
