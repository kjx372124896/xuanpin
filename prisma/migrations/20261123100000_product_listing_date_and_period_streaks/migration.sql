-- Store the existing product-ID-based listing-date estimate so filtering can
-- use a normal indexed column instead of materializing thousands of IDs.
ALTER TABLE "商品主表"
ADD COLUMN "上架日期" DATE;

UPDATE "商品主表"
SET "上架日期" = DATE '2026-07-29'
  + ROUND(("商品ID"::numeric - 1070000000000::numeric) / 278550000::numeric)::integer
WHERE CASE
  WHEN "商品ID" ~ '^[0-9]+$' THEN
    ROUND(("商品ID"::numeric - 1070000000000::numeric) / 278550000::numeric)
      BETWEEN -100000000 AND 100000000
  ELSE FALSE
END;

CREATE INDEX "商品主表_上架日期_idx"
ON "商品主表"("上架日期");

-- Keep one streak row per product, board and ending week. This makes a
-- user-selected historical period filterable through a relation EXISTS query.
CREATE TABLE "商品周期连续上榜统计表" (
  "商品ID" VARCHAR(80) NOT NULL,
  "榜单类型" "榜单类型" NOT NULL,
  "周开始日期" DATE NOT NULL,
  "连续上榜周数" INTEGER NOT NULL,
  "更新时间" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "商品周期连续上榜统计表_pkey"
    PRIMARY KEY ("商品ID", "榜单类型", "周开始日期"),
  CONSTRAINT "商品周期连续上榜统计表_商品ID_fkey"
    FOREIGN KEY ("商品ID") REFERENCES "商品主表"("商品ID")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "商品周期连续上榜_周期索引"
ON "商品周期连续上榜统计表"("榜单类型", "周开始日期", "连续上榜周数");

-- Backfill streak length for every historical week. Gaps create a new island;
-- the row number within that island is the streak ending at that week.
WITH distinct_weeks AS (
  SELECT DISTINCT "商品ID", "榜单类型", "周开始日期"
  FROM "商品上榜历史表"
),
islands AS (
  SELECT
    "商品ID",
    "榜单类型",
    "周开始日期",
    "周开始日期" - (ROW_NUMBER() OVER (
      PARTITION BY "商品ID", "榜单类型"
      ORDER BY "周开始日期"
    )::integer * 7) AS island_key
  FROM distinct_weeks
),
streaks AS (
  SELECT
    "商品ID",
    "榜单类型",
    "周开始日期",
    ROW_NUMBER() OVER (
      PARTITION BY "商品ID", "榜单类型", island_key
      ORDER BY "周开始日期"
    )::integer AS consecutive_week_count
  FROM islands
)
INSERT INTO "商品周期连续上榜统计表" (
  "商品ID", "榜单类型", "周开始日期", "连续上榜周数"
)
SELECT "商品ID", "榜单类型", "周开始日期", consecutive_week_count
FROM streaks;
