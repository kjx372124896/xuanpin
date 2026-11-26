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
  level2: string;
  level3: string;
}

export const NO_SECOND_LEVEL_CATEGORY = "无二级类目";
export const NO_THIRD_LEVEL_CATEGORY = "无三级类目";

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
  // Some market exports encode an unavailable metric as an empty object.
  // Keep it unknown (null), never coerce it to zero or reject the whole row.
  if (raw === "{}") return { raw: null, min: null, max: null, median: null, valid: true };
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
  const source = String(value);
  const raw = source.trim();
  if (!raw) return null;
  // cellText trims Excel cells before this parser runs. Preserve validation
  // for a visibly empty first/last hierarchy segment after that trim.
  if (/^\/\s+/.test(raw) || /\s+\/$/.test(raw) || /\s+\/\s+\/\s+/.test(raw)) return null;
  // A slash is a hierarchy separator only when whitespace exists on both
  // sides. Slashes inside a category label (for example, "杯子/水杯/水壶")
  // are part of the label and must remain untouched.
  const levels = source.split(/\s+\/\s+/).map((part) => part.trim());
  if (levels.length > 3 || levels.some((part) => !part)) return null;
  return {
    raw,
    level1: levels[0],
    level2: levels[1] ?? NO_SECOND_LEVEL_CATEGORY,
    level3: levels[2] ?? NO_THIRD_LEVEL_CATEGORY,
  };
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
