-- Structured category levels and explicit midpoint fields.
-- Existing raw category/period/metric values are retained for traceability.

ALTER TABLE "商品主表"
  ADD COLUMN "最新一级类目" VARCHAR(255),
  ADD COLUMN "最新二级类目" VARCHAR(255),
  ADD COLUMN "最新访客数中值" DECIMAL(20,2),
  ADD COLUMN "最新支付买家数中值" DECIMAL(20,2),
  ADD COLUMN "最新加购人数中值" DECIMAL(20,2);

ALTER TABLE "商品上榜历史表"
  RENAME COLUMN "访客数估算值" TO "访客数中值";
ALTER TABLE "商品上榜历史表"
  RENAME COLUMN "支付买家数估算值" TO "支付买家数中值";
ALTER TABLE "商品上榜历史表"
  RENAME COLUMN "加购人数估算值" TO "加购人数中值";

ALTER TABLE "商品上榜历史表"
  ADD COLUMN "一级类目" VARCHAR(255),
  ADD COLUMN "二级类目" VARCHAR(255);

ALTER TABLE "类目表"
  ADD COLUMN "一级类目" VARCHAR(255),
  ADD COLUMN "二级类目" VARCHAR(255);

-- Split at the first slash only. Everything after the first slash remains the second-level label.
UPDATE "商品上榜历史表"
SET
  "一级类目" = COALESCE(NULLIF(BTRIM(SPLIT_PART("类目名称", '/', 1)), ''), BTRIM("类目名称")),
  "二级类目" = CASE
    WHEN STRPOS("类目名称", '/') > 0
      THEN NULLIF(BTRIM(SUBSTRING("类目名称" FROM STRPOS("类目名称", '/') + 1)), '')
    ELSE NULL
  END;

UPDATE "类目表"
SET
  "一级类目" = COALESCE(NULLIF(BTRIM(SPLIT_PART("类目名称", '/', 1)), ''), BTRIM("类目名称")),
  "二级类目" = CASE
    WHEN STRPOS("类目名称", '/') > 0
      THEN NULLIF(BTRIM(SUBSTRING("类目名称" FROM STRPOS("类目名称", '/') + 1)), '')
    ELSE NULL
  END;

ALTER TABLE "商品上榜历史表"
  ALTER COLUMN "一级类目" SET NOT NULL;
ALTER TABLE "类目表"
  ALTER COLUMN "一级类目" SET NOT NULL;

-- Populate the product summary fields from each product's latest history row.
WITH latest AS (
  SELECT DISTINCT ON (h."商品ID")
    h."商品ID", h."一级类目", h."二级类目",
    h."访客数中值", h."支付买家数中值", h."加购人数中值"
  FROM "商品上榜历史表" h
  ORDER BY h."商品ID", h."周开始日期" DESC,
    h."导出时间" DESC NULLS LAST, h."导入时间" DESC, h."类目名称" ASC
)
UPDATE "商品主表" p
SET
  "最新一级类目" = l."一级类目",
  "最新二级类目" = l."二级类目",
  "最新访客数中值" = l."访客数中值",
  "最新支付买家数中值" = l."支付买家数中值",
  "最新加购人数中值" = l."加购人数中值",
  "更新时间" = now()
FROM latest l
WHERE p."商品ID" = l."商品ID";

CREATE INDEX "商品主表_最新一级类目_最新二级类目_idx"
  ON "商品主表"("最新一级类目", "最新二级类目");
CREATE INDEX "商品上榜历史表_一级类目_二级类目_idx"
  ON "商品上榜历史表"("一级类目", "二级类目");
CREATE INDEX "类目表_一级类目_二级类目_idx"
  ON "类目表"("一级类目", "二级类目");
