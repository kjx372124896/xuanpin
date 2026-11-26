BEGIN;

ALTER TABLE "商品上榜历史表"
  ADD COLUMN "三级类目" VARCHAR(255) NOT NULL DEFAULT '无三级类目';
ALTER TABLE "搜索词日历史表"
  ADD COLUMN "三级类目" VARCHAR(255) NOT NULL DEFAULT '无三级类目';
ALTER TABLE "商品主表"
  ADD COLUMN "最新三级类目" VARCHAR(255);
ALTER TABLE "商品榜单统计表"
  ADD COLUMN "最新三级类目" VARCHAR(255);
ALTER TABLE "类目表"
  ADD COLUMN "三级类目" VARCHAR(255);

CREATE TABLE "类目路径迁移异常表" (
  "来源表" VARCHAR(80) NOT NULL,
  "来源记录ID" VARCHAR(30) NOT NULL,
  "原始类目路径" VARCHAR(255) NOT NULL,
  "异常类型" VARCHAR(80) NOT NULL,
  "记录时间" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "类目路径迁移异常表_pkey" PRIMARY KEY ("来源表", "来源记录ID")
);

-- The original path is authoritative. Only whitespace-surrounded slashes are
-- hierarchy separators. Invalid legacy paths keep their old level-1/level-2
-- values and are recorded for manual review rather than silently truncated.
WITH parsed AS (
  SELECT "历史记录ID" AS record_id, BTRIM("类目名称") AS raw_path,
    REGEXP_SPLIT_TO_ARRAY(BTRIM("类目名称"), '[[:space:]]+/[[:space:]]+') AS parts
  FROM "商品上榜历史表"
), checked AS (
  SELECT *, CASE
    WHEN ARRAY_LENGTH(parts, 1) > 3 THEN '超过三级'
    WHEN EXISTS (SELECT 1 FROM UNNEST(parts) AS segments(value) WHERE BTRIM(value) = '') THEN '存在空层级'
    WHEN raw_path ~ '(^/[[:space:]]+|[[:space:]]+/$|[[:space:]]+/[[:space:]]+/[[:space:]]+)' THEN '存在空层级'
    ELSE NULL
  END AS issue_type
  FROM parsed
)
INSERT INTO "类目路径迁移异常表" ("来源表", "来源记录ID", "原始类目路径", "异常类型")
SELECT '商品上榜历史表', record_id, raw_path, issue_type
FROM checked WHERE issue_type IS NOT NULL
ON CONFLICT ("来源表", "来源记录ID") DO NOTHING;

WITH parsed AS (
  SELECT "历史记录ID" AS record_id, BTRIM("类目名称") AS raw_path,
    REGEXP_SPLIT_TO_ARRAY(BTRIM("类目名称"), '[[:space:]]+/[[:space:]]+') AS parts
  FROM "商品上榜历史表"
), checked AS (
  SELECT *, CASE
    WHEN ARRAY_LENGTH(parts, 1) > 3 THEN FALSE
    WHEN EXISTS (SELECT 1 FROM UNNEST(parts) AS segments(value) WHERE BTRIM(value) = '') THEN FALSE
    WHEN raw_path ~ '(^/[[:space:]]+|[[:space:]]+/$|[[:space:]]+/[[:space:]]+/[[:space:]]+)' THEN FALSE
    ELSE TRUE
  END AS valid
  FROM parsed
)
UPDATE "商品上榜历史表" AS history
SET "一级类目" = BTRIM(checked.parts[1]),
    "二级类目" = COALESCE(NULLIF(BTRIM(checked.parts[2]), ''), '无二级类目'),
    "三级类目" = COALESCE(NULLIF(BTRIM(checked.parts[3]), ''), '无三级类目')
FROM checked
WHERE history."历史记录ID" = checked.record_id AND checked.valid;

WITH parsed AS (
  SELECT "搜索历史ID" AS record_id, BTRIM("类目") AS raw_path,
    REGEXP_SPLIT_TO_ARRAY(BTRIM("类目"), '[[:space:]]+/[[:space:]]+') AS parts
  FROM "搜索词日历史表"
), checked AS (
  SELECT *, CASE
    WHEN ARRAY_LENGTH(parts, 1) > 3 THEN '超过三级'
    WHEN EXISTS (SELECT 1 FROM UNNEST(parts) AS segments(value) WHERE BTRIM(value) = '') THEN '存在空层级'
    WHEN raw_path ~ '(^/[[:space:]]+|[[:space:]]+/$|[[:space:]]+/[[:space:]]+/[[:space:]]+)' THEN '存在空层级'
    ELSE NULL
  END AS issue_type
  FROM parsed
)
INSERT INTO "类目路径迁移异常表" ("来源表", "来源记录ID", "原始类目路径", "异常类型")
SELECT '搜索词日历史表', record_id, raw_path, issue_type
FROM checked WHERE issue_type IS NOT NULL
ON CONFLICT ("来源表", "来源记录ID") DO NOTHING;

WITH parsed AS (
  SELECT "搜索历史ID" AS record_id, BTRIM("类目") AS raw_path,
    REGEXP_SPLIT_TO_ARRAY(BTRIM("类目"), '[[:space:]]+/[[:space:]]+') AS parts
  FROM "搜索词日历史表"
), checked AS (
  SELECT *, CASE
    WHEN ARRAY_LENGTH(parts, 1) > 3 THEN FALSE
    WHEN EXISTS (SELECT 1 FROM UNNEST(parts) AS segments(value) WHERE BTRIM(value) = '') THEN FALSE
    WHEN raw_path ~ '(^/[[:space:]]+|[[:space:]]+/$|[[:space:]]+/[[:space:]]+/[[:space:]]+)' THEN FALSE
    ELSE TRUE
  END AS valid
  FROM parsed
)
UPDATE "搜索词日历史表" AS history
SET "一级类目" = BTRIM(checked.parts[1]),
    "二级类目" = COALESCE(NULLIF(BTRIM(checked.parts[2]), ''), '无二级类目'),
    "三级类目" = COALESCE(NULLIF(BTRIM(checked.parts[3]), ''), '无三级类目')
FROM checked
WHERE history."搜索历史ID" = checked.record_id AND checked.valid;

-- Re-map existing category records by original full path first. This keeps the
-- exact record (and its owner/enabled state) whenever its name still matches.
WITH source_paths AS (
  SELECT DISTINCT BTRIM("类目名称") AS raw_path FROM "商品上榜历史表"
  UNION
  SELECT DISTINCT BTRIM("类目") AS raw_path FROM "搜索词日历史表"
), parsed AS (
  SELECT raw_path, REGEXP_SPLIT_TO_ARRAY(raw_path, '[[:space:]]+/[[:space:]]+') AS parts
  FROM source_paths
), valid AS (
  SELECT * FROM parsed
  WHERE ARRAY_LENGTH(parts, 1) <= 3
    AND NOT EXISTS (SELECT 1 FROM UNNEST(parts) AS segments(value) WHERE BTRIM(value) = '')
    AND raw_path !~ '(^/[[:space:]]+|[[:space:]]+/$|[[:space:]]+/[[:space:]]+/[[:space:]]+)'
)
UPDATE "类目表" AS category
SET "一级类目" = BTRIM(valid.parts[1]),
    "二级类目" = CASE WHEN ARRAY_LENGTH(valid.parts, 1) >= 2 THEN BTRIM(valid.parts[2]) ELSE NULL END,
    "三级类目" = CASE WHEN ARRAY_LENGTH(valid.parts, 1) >= 3 THEN BTRIM(valid.parts[3]) ELSE NULL END
FROM valid
WHERE category."类目名称" = valid.raw_path;

-- Rebuild missing hierarchy nodes. ON CONFLICT updates only hierarchy columns,
-- preserving manually assigned owners and enabled flags.
WITH all_levels AS (
  SELECT "一级类目" AS level1 FROM "商品上榜历史表"
  UNION
  SELECT "一级类目" FROM "搜索词日历史表"
)
INSERT INTO "类目表" ("类目ID", "类目名称", "一级类目", "二级类目", "三级类目", "是否启用", "创建时间", "更新时间")
SELECT SUBSTRING(MD5(level1), 1, 30), level1, level1, NULL, NULL, TRUE, NOW(), NOW()
FROM (SELECT DISTINCT level1 FROM all_levels WHERE level1 <> '') AS parents
ON CONFLICT ("类目名称") DO UPDATE SET
  "一级类目" = EXCLUDED."一级类目", "二级类目" = NULL, "三级类目" = NULL, "更新时间" = NOW();

WITH all_levels AS (
  SELECT "一级类目" AS level1, "二级类目" AS level2 FROM "商品上榜历史表"
  UNION
  SELECT "一级类目", "二级类目" FROM "搜索词日历史表"
), child_names AS (
  SELECT DISTINCT level1, level2,
    CASE WHEN level2 = '无二级类目' THEN
      CASE WHEN CHAR_LENGTH(level1 || ' / 无二级类目') <= 255 THEN level1 || ' / 无二级类目'
        ELSE LEFT(level1, 255 - CHAR_LENGTH('~' || LEFT(MD5(level1), 8) || ' / 无二级类目'))
          || '~' || LEFT(MD5(level1), 8) || ' / 无二级类目' END
    ELSE level1 || ' / ' || level2 END AS category_name
  FROM all_levels
), resolved_child_names AS (
  SELECT child_names.level1, child_names.level2,
    COALESCE((
      SELECT category."类目名称" FROM "类目表" category
      WHERE category."一级类目" = child_names.level1
        AND category."二级类目" = child_names.level2
        AND category."三级类目" IS NULL
      ORDER BY category."创建时间" ASC
      LIMIT 1
    ), child_names.category_name) AS category_name
  FROM child_names
)
INSERT INTO "类目表" ("类目ID", "类目名称", "一级类目", "二级类目", "三级类目", "是否启用", "创建时间", "更新时间")
SELECT SUBSTRING(MD5(category_name), 1, 30), category_name, level1, level2, NULL, TRUE, NOW(), NOW()
FROM resolved_child_names
ON CONFLICT ("类目名称") DO UPDATE SET
  "一级类目" = EXCLUDED."一级类目", "二级类目" = EXCLUDED."二级类目", "三级类目" = NULL, "更新时间" = NOW();

WITH third_levels AS (
  SELECT DISTINCT BTRIM("类目名称") AS raw_path, "一级类目" AS level1, "二级类目" AS level2, "三级类目" AS level3
  FROM "商品上榜历史表" WHERE "二级类目" <> '无二级类目'
  UNION
  SELECT DISTINCT BTRIM("类目"), "一级类目", "二级类目", "三级类目"
  FROM "搜索词日历史表" WHERE "二级类目" <> '无二级类目'
), named_third_levels AS (
  SELECT level1, level2, level3,
    CASE WHEN level3 <> '无三级类目' THEN raw_path
      WHEN CHAR_LENGTH(level1 || ' / ' || level2 || ' / 无三级类目') <= 255
        THEN level1 || ' / ' || level2 || ' / 无三级类目'
      ELSE LEFT(level1 || ' / ' || level2,
        255 - CHAR_LENGTH('~' || LEFT(MD5(level1 || ' / ' || level2), 8) || ' / 无三级类目'))
        || '~' || LEFT(MD5(level1 || ' / ' || level2), 8) || ' / 无三级类目'
    END AS category_name
  FROM third_levels
)
INSERT INTO "类目表" ("类目ID", "类目名称", "一级类目", "二级类目", "三级类目", "是否启用", "创建时间", "更新时间")
SELECT DISTINCT ON (category_name)
  SUBSTRING(MD5(category_name), 1, 30), category_name, level1, level2, level3, TRUE, NOW(), NOW()
FROM named_third_levels
ORDER BY category_name, level1, level2, level3
ON CONFLICT ("类目名称") DO UPDATE SET
  "一级类目" = EXCLUDED."一级类目", "二级类目" = EXCLUDED."二级类目",
  "三级类目" = EXCLUDED."三级类目", "更新时间" = NOW();

-- Refresh the latest category snapshots without changing other statistics.
WITH latest AS (
  SELECT DISTINCT ON ("商品ID", "榜单类型")
    "商品ID", "榜单类型", "类目名称", "一级类目", "二级类目", "三级类目"
  FROM "商品上榜历史表"
  ORDER BY "商品ID", "榜单类型", "周开始日期" DESC,
    CASE WHEN "二级类目" = '无二级类目' THEN 1 ELSE 0 END ASC,
    CASE WHEN "三级类目" = '无三级类目' THEN 1 ELSE 0 END ASC,
    "导出时间" DESC NULLS LAST, "导入时间" DESC, "类目名称" ASC
)
UPDATE "商品榜单统计表" AS stats
SET "最新类目名称" = latest."类目名称", "最新一级类目" = latest."一级类目",
    "最新二级类目" = latest."二级类目", "最新三级类目" = latest."三级类目", "更新时间" = NOW()
FROM latest
WHERE stats."商品ID" = latest."商品ID" AND stats."榜单类型" = latest."榜单类型";

WITH latest AS (
  SELECT DISTINCT ON ("商品ID")
    "商品ID", "类目名称", "一级类目", "二级类目", "三级类目"
  FROM "商品上榜历史表"
  ORDER BY "商品ID", "周开始日期" DESC,
    CASE WHEN "二级类目" = '无二级类目' THEN 1 ELSE 0 END ASC,
    CASE WHEN "三级类目" = '无三级类目' THEN 1 ELSE 0 END ASC,
    "导出时间" DESC NULLS LAST, "导入时间" DESC, "类目名称" ASC
)
UPDATE "商品主表" AS product
SET "最新类目名称" = latest."类目名称", "最新一级类目" = latest."一级类目",
    "最新二级类目" = latest."二级类目", "最新三级类目" = latest."三级类目", "更新时间" = NOW()
FROM latest
WHERE product."商品ID" = latest."商品ID";

DROP INDEX IF EXISTS "商品主表_最新一级类目_最新二级类目_idx";
CREATE INDEX "商品主表_类目三级索引"
  ON "商品主表"("最新一级类目", "最新二级类目", "最新三级类目");

DROP INDEX IF EXISTS "商品上榜历史表_一级类目_二级类目_idx";
CREATE INDEX "商品历史_类目三级索引"
  ON "商品上榜历史表"("一级类目", "二级类目", "三级类目");

DROP INDEX IF EXISTS "商品榜单统计表_榜单类型_最新一级类目_最新二级类目_idx";
CREATE INDEX "商品榜单统计_类目三级索引"
  ON "商品榜单统计表"("榜单类型", "最新一级类目", "最新二级类目", "最新三级类目");

DROP INDEX IF EXISTS "类目表_一级类目_二级类目_idx";
CREATE INDEX "类目表_类目三级索引"
  ON "类目表"("一级类目", "二级类目", "三级类目");

DROP INDEX IF EXISTS "搜索词日历史_类目层级日期索引";
CREATE INDEX "搜索词日历史_类目层级日期索引"
  ON "搜索词日历史表"("一级类目", "二级类目", "三级类目", "统计日期");

COMMIT;
