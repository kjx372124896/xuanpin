export interface ParsedMetric {
  raw: string | null;
  min: number | null;
  max: number | null;
  median: number | null;
  valid: boolean;
}

export interface ParsedCategory {
  raw: string;
  level1: string;
  level2: string | null;
}

function parseNumber(value: string): number | null {
  const match = value.trim().replace(/,/g, "").match(/^([+-]?\d+(?:\.\d+)?)\s*(亿|万|千)?$/);
  if (!match) return null;
  const number = Number(match[1]);
  const multiplier = match[2] === "亿" ? 100_000_000 : match[2] === "万" ? 10_000 : match[2] === "千" ? 1_000 : 1;
  const result = number * multiplier;
  return Number.isFinite(result) && result >= 0 ? result : null;
}

export function parseMetric(value: unknown): ParsedMetric {
  if (value === null || value === undefined || String(value).trim() === "") {
    return { raw: null, min: null, max: null, median: null, valid: false };
  }
  const raw = String(value).trim();
  const normalized = raw.replace(/[～〜—–－-]/g, "~").replace(/至|到/g, "~").replace(/\s+/g, " ");
  const parts = normalized.split("~");
  if (parts.length > 2) return { raw, min: null, max: null, median: null, valid: false };
  const min = parseNumber(parts[0]);
  const max = parts.length === 2 ? parseNumber(parts[1]) : min;
  if (min === null || max === null || min > max) {
    return { raw, min: null, max: null, median: null, valid: false };
  }
  return { raw, min, max, median: (min + max) / 2, valid: true };
}

export function parseCategoryName(value: unknown): ParsedCategory | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const separator = raw.indexOf("/");
  if (separator < 0) return { raw, level1: raw, level2: null };
  const level1 = raw.slice(0, separator).trim();
  const level2 = raw.slice(separator + 1).trim() || null;
  if (!level1) return null;
  return { raw, level1, level2 };
}

function parseDateToken(value: string): Date | null {
  const parts = value.split(/[-/]/).map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) return null;
  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

export function parseWeekPeriod(value: unknown): { start: Date; end: Date; raw: string } | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  const match = raw.match(/^(\d{4}[-/]\d{1,2}[-/]\d{1,2})\s*(?:[|｜]|[~～〜]|至|到|\s+-\s+)\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})$/);
  if (!match) return null;
  const start = parseDateToken(match[1]);
  const end = parseDateToken(match[2]);
  if (!start || !end || start > end) return null;
  return { start, end, raw };
}

export function parseExportTime(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const date = new Date(String(value).trim().replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/, "$1T$2"));
  return Number.isNaN(date.getTime()) ? null : date;
}
