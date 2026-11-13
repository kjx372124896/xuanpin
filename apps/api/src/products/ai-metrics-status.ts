import type { Prisma } from "@prisma/client";

export type AiMetricsStatus = "NOT_FETCHED" | "FETCHED";

export function aiMetricsStatusWhere(status?: AiMetricsStatus): Prisma.ProductWhereInput {
  if (status === "NOT_FETCHED") return { aiMetricsFetchedAt: null };
  if (status === "FETCHED") return { aiMetricsFetchedAt: { not: null } };
  return {};
}
