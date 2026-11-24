import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";

type Column = readonly [property: string, column: string, sqlType: string];
const commonColumns: readonly Column[] = [
  ["exportTime", "导出时间", "timestamp"], ["sourceFileId", "来源文件ID", "text"],
  ["sourceFileName", "来源文件名", "text"], ["sourceRowNumber", "来源行号", "integer"],
  ["importedAt", "导入时间", "timestamp"],
];
const productColumns: readonly Column[] = [
  ["id", "历史记录ID", "text"], ["productId", "商品ID", "text"], ["boardType", "榜单类型", '"榜单类型"'],
  ["weekStart", "周开始日期", "date"], ["weekEnd", "周结束日期", "date"], ["rawPeriod", "原始日期范围", "text"],
  ["categoryName", "类目名称", "text"], ["categoryLevel1", "一级类目", "text"], ["categoryLevel2", "二级类目", "text"],
  ["rank", "行业排名", "integer"], ["trend", "趋势", "text"],
  ...(["visitor", "buyer", "cart"] as const).flatMap((prefix, index): Column[] => {
    const label = ["访客数", "支付买家数", "加购人数"][index];
    return [[`${prefix}Raw`, `${label}原值`, "text"], [`${prefix}Min`, `${label}下限`, "numeric"],
      [`${prefix}Max`, `${label}上限`, "numeric"], [`${prefix}Median`, `${label}中值`, "numeric"]];
  }),
  ["productKeyword", "商品关键词", "text"], ...commonColumns,
];
const searchColumns: readonly Column[] = [
  ["id", "搜索历史ID", "text"], ["searchTerm", "搜索词", "text"], ["categoryName", "类目", "text"],
  ["categoryLevel1", "一级类目", "text"], ["categoryLevel2", "二级类目", "text"],
  ["classificationName", "分类名称", "text"], ["searchTermType", "搜索词类型", "text"],
  ["boardType", "搜索榜单类型", "text"], ["dimension", "统计维度", "text"], ["searchDate", "统计日期", "date"],
  ["rank", "排名", "integer"], ["searchPeopleRaw", "搜索人数原值", "text"],
  ["searchPeopleMin", "搜索人数下限", "numeric"], ["searchPeopleMax", "搜索人数上限", "numeric"],
  ["searchPeopleMedian", "搜索人数中值", "numeric"], ["clickRate", "点击率", "text"],
  ["paymentConversionRate", "支付转化率", "text"], ...commonColumns,
];

export type HistoryWrite = { fileId: string; inserted: boolean };
type RawClient = Pick<Prisma.TransactionClient, "$queryRaw">;

// Identifiers and SQL types below come exclusively from the constant mappings.
// Data is always one JSON parameter. A conflicting row is locked and its export
// time is checked by PostgreSQL, including rows inserted by a concurrent writer.
export function historyUpsertQuery(kind: "product" | "search", rows: readonly object[]): Prisma.Sql {
  const columns = kind === "product" ? productColumns : searchColumns;
  const table = kind === "product" ? "商品上榜历史表" : "搜索词日历史表";
  const unique = kind === "product" ? ["榜单类型", "商品ID", "周开始日期", "类目名称"]
    : ["搜索词", "类目", "搜索词类型", "搜索榜单类型", "统计维度", "统计日期"];
  const quoted = (name: string) => Prisma.raw(`"${name}"`);
  const values = rows.map((row) => {
    const data = { ...row, id: randomBytes(12).toString("hex"), importedAt: new Date() } as Record<string, unknown>;
    return Object.fromEntries(columns.map(([property, column]) => [column, data[property] ?? null]));
  });
  const updates = columns.filter(([, column], index) => index > 0 && !unique.includes(column));
  return Prisma.sql`
    INSERT INTO ${quoted(table)} AS existing (${Prisma.join(columns.map(([, column]) => quoted(column)))})
    SELECT ${Prisma.join(columns.map(([, column]) => Prisma.sql`v.${quoted(column)}`))}
    FROM jsonb_to_recordset(${JSON.stringify(values)}::jsonb) AS v(
      ${Prisma.join(columns.map(([, column, type]) => Prisma.sql`${quoted(column)} ${Prisma.raw(type)}`))}
    )
    ON CONFLICT (${Prisma.join(unique.map(quoted))}) DO UPDATE SET
      ${Prisma.join(updates.map(([, column]) => Prisma.sql`${quoted(column)} = EXCLUDED.${quoted(column)}`))}
    WHERE EXCLUDED."导出时间" IS NOT NULL
      AND (existing."导出时间" IS NULL OR EXCLUDED."导出时间" > existing."导出时间")
    RETURNING "来源文件ID" AS "fileId", (xmax = 0) AS inserted
  `;
}

export async function upsertHistories(client: RawClient, kind: "product" | "search", rows: readonly object[]) {
  const result = { created: 0, updated: 0, duplicates: 0, fileCounts: new Map<string, number>() };
  for (let index = 0; index < rows.length; index += 500) {
    const chunk = rows.slice(index, index + 500);
    const written = await client.$queryRaw<HistoryWrite[]>(historyUpsertQuery(kind, chunk));
    result.duplicates += chunk.length - written.length;
    for (const row of written) {
      if (row.inserted) result.created += 1;
      else result.updated += 1;
      result.fileCounts.set(row.fileId, (result.fileCounts.get(row.fileId) ?? 0) + 1);
    }
  }
  return result;
}
