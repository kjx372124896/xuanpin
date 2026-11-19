const BASE_PRODUCT_ID = 1_052_407_159_281n;
const PRODUCT_ID_STEP = 300_000_000n;
const BASE_DATE_UTC = Date.UTC(2026, 4, 24);
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 根据商品ID估算上架日期，严格遵循 WPS ROUND 的四舍五入规则（负数半值远离0）。
 * 等价于：DATE(2026,5,24)+ROUND((VALUE(商品ID)-1052407159281)/300000000,0)
 */
export function calculateListingDate(productId: string | number | null | undefined): string | null {
  if (productId === null || productId === undefined) return null;

  let normalizedId: string;
  if (typeof productId === "number") {
    if (!Number.isSafeInteger(productId) || productId < 0) return null;
    normalizedId = String(productId);
  } else {
    normalizedId = productId.trim();
    if (!/^\d+$/.test(normalizedId)) return null;
  }

  let numericId: bigint;
  try {
    numericId = BigInt(normalizedId);
  } catch {
    return null;
  }

  const difference = numericId - BASE_PRODUCT_ID;
  const absoluteDifference = difference < 0n ? -difference : difference;
  const roundedAbsoluteDays = (absoluteDifference + PRODUCT_ID_STEP / 2n) / PRODUCT_ID_STEP;
  const roundedDays = difference < 0n ? -roundedAbsoluteDays : roundedAbsoluteDays;
  const dayOffset = Number(roundedDays);
  if (!Number.isSafeInteger(dayOffset)) return null;

  const timestamp = BASE_DATE_UTC + dayOffset * DAY_MS;
  if (!Number.isFinite(timestamp) || Math.abs(timestamp) > 8.64e15) return null;

  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}
