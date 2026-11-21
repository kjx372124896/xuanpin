-- Normalize rows that contain only a first-level category.
-- Category table NULL values remain reserved for first-level parent nodes.

UPDATE "商品上榜历史表"
SET "二级类目" = '无二级类目'
WHERE "二级类目" IS NULL;

-- Keep the denormalized latest category on the product table in sync with history.
WITH latest AS (
  SELECT DISTINCT ON (h."商品ID")
    h."商品ID", h."二级类目"
  FROM "商品上榜历史表" h
  ORDER BY h."商品ID", h."周开始日期" DESC,
    h."导出时间" DESC NULLS LAST, h."导入时间" DESC, h."类目名称" ASC
)
UPDATE "商品主表" p
SET "最新二级类目" = latest."二级类目",
    "更新时间" = now()
FROM latest
WHERE p."商品ID" = latest."商品ID";

-- Create a visible/statistical child-category node for the normalized value.
-- The parent node (categoryLevel2 IS NULL) is intentionally retained for owner inheritance.
INSERT INTO "类目表" (
  "类目ID", "类目名称", "一级类目", "二级类目", "负责人ID", "是否启用", "创建时间", "更新时间"
)
SELECT
  'c' || substr(md5('no-second-level:' || source."一级类目"), 1, 24),
  CASE
    WHEN char_length(source."一级类目") + char_length(' / 无二级类目') <= 255
      THEN source."一级类目" || ' / 无二级类目'
    ELSE left(
      source."一级类目",
      255 - char_length('~' || substr(md5(source."一级类目"), 1, 8) || ' / 无二级类目')
    ) || '~' || substr(md5(source."一级类目"), 1, 8) || ' / 无二级类目'
  END,
  source."一级类目",
  '无二级类目',
  NULL,
  true,
  now(),
  now()
FROM (
  SELECT DISTINCT "一级类目"
  FROM "商品上榜历史表"
  WHERE "二级类目" = '无二级类目'
) source
ON CONFLICT ("类目名称") DO UPDATE SET
  "一级类目" = EXCLUDED."一级类目",
  "二级类目" = EXCLUDED."二级类目",
  "更新时间" = now();

ALTER TABLE "商品上榜历史表"
ALTER COLUMN "二级类目" SET NOT NULL;
