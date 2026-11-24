import { Prisma } from "@prisma/client";

export function productMetadataQuery(metadataJson: string) {
  return Prisma.sql`
    UPDATE "商品主表" AS p
    SET "商品名称" = v."商品名称", "商品链接" = v."商品链接", "店铺名称" = v."店铺名称",
        "店铺类型" = v."店铺类型", "商品图片链接" = v."商品图片链接",
        "上架日期" = COALESCE(p."上架日期", v."上架日期"), "更新时间" = now()
    FROM jsonb_to_recordset(${metadataJson}::jsonb) AS v(
      "商品ID" text, "商品名称" text, "商品链接" text, "店铺名称" text,
      "店铺类型" text, "商品图片链接" text, "上架日期" date, "周开始日期" date, "导出时间" timestamp
    )
    WHERE p."商品ID" = v."商品ID"
      AND NOT EXISTS (
        SELECT 1 FROM "商品上榜历史表" h
        WHERE h."商品ID" = p."商品ID" AND (
          h."周开始日期" > v."周开始日期"
          OR (h."周开始日期" = v."周开始日期"
            AND COALESCE(h."导出时间", '-infinity'::timestamp) >= COALESCE(v."导出时间", '-infinity'::timestamp))
        )
      )
  `;
}
