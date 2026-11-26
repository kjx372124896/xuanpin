BEGIN;

-- Keep the full registry row before removing an obsolete generated node.
ALTER TABLE "类目路径迁移异常表" ADD COLUMN IF NOT EXISTS "原始记录" JSONB;

CREATE TEMP TABLE legacy_category_roots ON COMMIT DROP AS
WITH source_paths AS (
  SELECT DISTINCT "类目名称" AS raw_path, "一级类目" AS level1 FROM "商品上榜历史表"
  UNION
  SELECT DISTINCT "类目", "一级类目" FROM "搜索词日历史表"
), legacy_prefixes AS (
  SELECT DISTINCT BTRIM(SPLIT_PART(raw_path, '/', 1)) AS old_level1, level1
  FROM source_paths
  WHERE STRPOS(raw_path, '/') > 0
    AND BTRIM(SPLIT_PART(raw_path, '/', 1)) <> level1
    AND BTRIM((REGEXP_SPLIT_TO_ARRAY(BTRIM(raw_path), '[[:space:]]+/[[:space:]]+'))[1]) = level1
)
SELECT DISTINCT old."类目ID" AS old_id, old."一级类目" AS old_level1, corrected."类目ID" AS corrected_id
FROM legacy_prefixes AS prefixes
JOIN "类目表" AS old
  ON old."类目名称" = prefixes.old_level1 AND old."一级类目" = prefixes.old_level1
  AND old."二级类目" IS NULL AND old."三级类目" IS NULL AND old."是否启用"
JOIN "类目表" AS corrected
  ON corrected."一级类目" = prefixes.level1 AND corrected."二级类目" IS NULL AND corrected."三级类目" IS NULL
WHERE NOT EXISTS (SELECT 1 FROM "商品上榜历史表" h WHERE h."一级类目" = old."一级类目")
  AND NOT EXISTS (SELECT 1 FROM "搜索词日历史表" h WHERE h."一级类目" = old."一级类目")
  -- Retain explicitly registered branches even when they have no imported data.
  AND NOT EXISTS (
    SELECT 1 FROM "类目表" child
    WHERE child."一级类目" = old."一级类目"
      AND ((child."二级类目" IS NOT NULL AND child."二级类目" <> '无二级类目')
        OR (child."三级类目" IS NOT NULL AND child."三级类目" <> '无三级类目'))
  );

-- A renamed root must retain the owner it previously inherited from the old root.
-- An explicit owner on the corrected node always takes precedence.
UPDATE "类目表" AS corrected
SET "负责人ID" = old."负责人ID", "更新时间" = NOW()
FROM legacy_category_roots roots
JOIN "类目表" AS old ON old."类目ID" = roots.old_id
WHERE corrected."类目ID" = roots.corrected_id
  AND corrected."负责人ID" IS NULL AND old."负责人ID" IS NOT NULL;

INSERT INTO "类目路径迁移异常表" ("来源表", "来源记录ID", "原始类目路径", "异常类型", "原始记录")
SELECT '类目表', category."类目ID", category."类目名称", '旧版斜杠拆分产生的无数据节点', TO_JSONB(category)
FROM "类目表" AS category
WHERE EXISTS (SELECT 1 FROM legacy_category_roots roots WHERE roots.old_level1 = category."一级类目")
  AND ((category."二级类目" IS NULL AND category."三级类目" IS NULL)
    OR (category."二级类目" = '无二级类目' AND (category."三级类目" IS NULL OR category."三级类目" = '无三级类目')))
ON CONFLICT ("来源表", "来源记录ID") DO UPDATE SET
  "原始记录" = COALESCE("类目路径迁移异常表"."原始记录", EXCLUDED."原始记录");

DELETE FROM "类目表" AS category
WHERE EXISTS (SELECT 1 FROM legacy_category_roots roots WHERE roots.old_level1 = category."一级类目")
  AND ((category."二级类目" IS NULL AND category."三级类目" IS NULL)
    OR (category."二级类目" = '无二级类目' AND (category."三级类目" IS NULL OR category."三级类目" = '无三级类目')));

COMMIT;
