-- Backfill the shared category registry from search-term history already imported
-- before search imports began maintaining the registry automatically.

WITH source_categories AS (
  SELECT DISTINCT BTRIM("类目") AS raw_name
  FROM "搜索词日历史表"
  WHERE NULLIF(BTRIM("类目"), '') IS NOT NULL
), parsed_categories AS (
  SELECT
    raw_name,
    BTRIM(SPLIT_PART(raw_name, '/', 1)) AS level1,
    CASE
      WHEN STRPOS(raw_name, '/') > 0
        THEN NULLIF(BTRIM(SUBSTRING(raw_name FROM STRPOS(raw_name, '/') + 1)), '')
      ELSE NULL
    END AS level2
  FROM source_categories
), valid_categories AS (
  SELECT raw_name, level1, COALESCE(level2, '无二级类目') AS level2
  FROM parsed_categories
  WHERE level1 <> ''
)
INSERT INTO "类目表" (
  "类目ID", "类目名称", "一级类目", "二级类目", "是否启用", "创建时间", "更新时间"
)
SELECT
  substring(md5(random()::text || clock_timestamp()::text || parent.level1), 1, 30),
  parent.level1,
  parent.level1,
  NULL,
  TRUE,
  NOW(),
  NOW()
FROM (SELECT DISTINCT level1 FROM valid_categories) AS parent
ON CONFLICT ("类目名称") DO NOTHING;

WITH source_categories AS (
  SELECT DISTINCT BTRIM("类目") AS raw_name
  FROM "搜索词日历史表"
  WHERE NULLIF(BTRIM("类目"), '') IS NOT NULL
), parsed_categories AS (
  SELECT
    raw_name,
    BTRIM(SPLIT_PART(raw_name, '/', 1)) AS level1,
    CASE
      WHEN STRPOS(raw_name, '/') > 0
        THEN NULLIF(BTRIM(SUBSTRING(raw_name FROM STRPOS(raw_name, '/') + 1)), '')
      ELSE NULL
    END AS level2
  FROM source_categories
), valid_categories AS (
  SELECT raw_name, level1, COALESCE(level2, '无二级类目') AS level2
  FROM parsed_categories
  WHERE level1 <> ''
)
INSERT INTO "类目表" (
  "类目ID", "类目名称", "一级类目", "二级类目", "是否启用", "创建时间", "更新时间"
)
SELECT
  substring(md5(random()::text || clock_timestamp()::text || child.raw_name), 1, 30),
  CASE
    WHEN child.level2 <> '无二级类目' THEN child.raw_name
    WHEN char_length(child.level1 || ' / 无二级类目') <= 255 THEN child.level1 || ' / 无二级类目'
    ELSE left(child.level1, 255 - char_length('~' || left(md5(child.level1), 8) || ' / 无二级类目'))
      || '~' || left(md5(child.level1), 8) || ' / 无二级类目'
  END,
  child.level1,
  child.level2,
  TRUE,
  NOW(),
  NOW()
FROM valid_categories AS child
ON CONFLICT ("类目名称") DO NOTHING;
