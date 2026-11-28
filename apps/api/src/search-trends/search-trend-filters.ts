export const SEARCH_TREND_METRIC_FIELDS = [
  "currentDaysWithData", "currentDailyAverage", "previousDaysWithData", "previousDailyAverage",
] as const;

export type SearchTrendMetricField = typeof SEARCH_TREND_METRIC_FIELDS[number];
export type SearchTrendMetricOperator = "all" | "gt" | "gte" | "eq" | "lt" | "lte" | "between";
export interface SearchTrendMetricFilter {
  operator: SearchTrendMetricOperator;
  value?: number;
  max?: number;
}
export type SearchTrendMetricFilters = Partial<Record<SearchTrendMetricField, SearchTrendMetricFilter>>;

export function defaultSearchTrendMetricFilters(): SearchTrendMetricFilters {
  return { currentDaysWithData: { operator: "gt", value: 3 } };
}

const labels: Record<SearchTrendMetricField, string> = {
  currentDaysWithData: "当期有效天数", currentDailyAverage: "当期日均值",
  previousDaysWithData: "对比期有效天数", previousDailyAverage: "对比期日均值",
};

// Validate before translating user input into parameterized SQL conditions.
export function parseSearchTrendMetricFilters(input: unknown): SearchTrendMetricFilters {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("日均筛选参数无效。");
  const result = defaultSearchTrendMetricFilters();
  for (const [key, raw] of Object.entries(input)) {
    if (!SEARCH_TREND_METRIC_FIELDS.includes(key as SearchTrendMetricField)) throw new Error("日均筛选字段无效。");
    const field = key as SearchTrendMetricField;
    const label = labels[field];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(label + "筛选参数无效。");
    const { operator, value, max } = raw as Record<string, unknown>;
    if (operator === "all") {
      result[field] = { operator: "all" };
      continue;
    }
    if (!["gt", "gte", "eq", "lt", "lte", "between"].includes(operator as string)) throw new Error(label + "筛选方式无效。");
    const isDays = field.endsWith("DaysWithData");
    const valid = (number: unknown): number is number => typeof number === "number" && Number.isFinite(number) && number >= 0 && (!isDays || Number.isInteger(number));
    const requirement = isDays ? "必须填写大于等于0的整数。" : "必须填写大于等于0的数字。";
    if (!valid(value)) throw new Error(label + requirement);
    if (operator === "between") {
      if (!valid(max)) throw new Error(label + "上限" + requirement);
      if (value > max) throw new Error(label + "下限不能大于上限。");
      result[field] = { operator, value, max };
    } else {
      result[field] = { operator: operator as SearchTrendMetricOperator, value };
    }
  }
  return result;
}
