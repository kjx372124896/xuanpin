BEGIN;

ALTER TABLE "搜索词日历史表"
  ADD COLUMN "一级类目" VARCHAR(255),
  ADD COLUMN "二级类目" VARCHAR(255);

-- Preserve the original category and split at the first slash, like market imports.
UPDATE "搜索词日历史表"
SET "一级类目" = BTRIM(SPLIT_PART(BTRIM("类目"), '/', 1)),
    "二级类目" = CASE WHEN STRPOS("类目", '/') > 0
      THEN COALESCE(NULLIF(BTRIM(SUBSTRING("类目" FROM STRPOS("类目", '/') + 1)), ''), '无二级类目')
      ELSE '无二级类目' END;

ALTER TABLE "搜索词日历史表"
  ALTER COLUMN "一级类目" SET NOT NULL,
  ALTER COLUMN "二级类目" SET NOT NULL;

CREATE INDEX "搜索词日历史_类目层级日期索引"
ON "搜索词日历史表"("一级类目", "二级类目", "统计日期");

-- Include the unclassified child for parent-only historical imports. Existing
-- assignments and enabled states are preserved through ON CONFLICT.
INSERT INTO "类目表" ("类目ID", "类目名称", "一级类目", "二级类目", "是否启用", "创建时间", "更新时间")
SELECT substring(md5(random()::text || clock_timestamp()::text || s."一级类目"), 1, 30),
       s."一级类目", s."一级类目", NULL, TRUE, NOW(), NOW()
FROM (SELECT DISTINCT "一级类目" FROM "搜索词日历史表" WHERE "一级类目" <> '') s
ON CONFLICT ("类目名称") DO NOTHING;

WITH categories AS (
  SELECT DISTINCT "类目", "一级类目", "二级类目" FROM "搜索词日历史表" WHERE "一级类目" <> ''
)
INSERT INTO "类目表" ("类目ID", "类目名称", "一级类目", "二级类目", "是否启用", "创建时间", "更新时间")
SELECT substring(md5(random()::text || clock_timestamp()::text || s."类目"), 1, 30),
       CASE WHEN s."二级类目" <> '无二级类目' THEN s."类目"
         WHEN char_length(s."一级类目" || ' / 无二级类目') <= 255 THEN s."一级类目" || ' / 无二级类目'
         ELSE left(s."一级类目", 255 - char_length('~' || left(md5(s."一级类目"), 8) || ' / 无二级类目'))
           || '~' || left(md5(s."一级类目"), 8) || ' / 无二级类目' END,
       s."一级类目", s."二级类目", TRUE, NOW(), NOW()
FROM categories s
ON CONFLICT ("类目名称") DO NOTHING;

COMMIT;
