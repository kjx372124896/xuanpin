export interface SearchTrendComparisonPeriods {
  previousStartDate: Date;
  previousEndDate: Date;
  currentStartDate: Date;
  currentEndDate: Date;
}

export type SearchTrendComparisonMode = "previousMonth" | "previousYear";

function shiftUtcDays(date: Date, days: number) {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function shiftUtcMonthsClamped(date: Date, months: number) {
  const targetMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)).getUTCDate();
  targetMonth.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return targetMonth;
}

export function buildSearchTrendComparisonPeriods(
  currentStart: Date,
  currentEnd: Date,
  mode: SearchTrendComparisonMode = "previousMonth",
): SearchTrendComparisonPeriods {
  const currentStartDate = shiftUtcDays(currentStart, 0);
  const currentEndDate = shiftUtcDays(currentEnd, 0);
  const monthOffset = mode === "previousYear" ? -12 : -1;
  const previousStartDate = shiftUtcMonthsClamped(currentStartDate, monthOffset);
  const previousEndDate = shiftUtcMonthsClamped(currentEndDate, monthOffset);
  return { previousStartDate, previousEndDate, currentStartDate, currentEndDate };
}

export function calculateSearchTrendGrowthRate(previousDailyAverage: number | null, currentDailyAverage: number | null) {
  // A newly observed term has no comparison-period data; use the agreed 100%
  // business value when the current period has a positive daily average.
  if (previousDailyAverage === null && currentDailyAverage !== null && Number.isFinite(currentDailyAverage) && currentDailyAverage > 0) {
    return 100;
  }
  if (previousDailyAverage === null || currentDailyAverage === null || !Number.isFinite(previousDailyAverage) || !Number.isFinite(currentDailyAverage) || previousDailyAverage <= 0) {
    return null;
  }
  return ((currentDailyAverage - previousDailyAverage) / previousDailyAverage) * 100;
}
