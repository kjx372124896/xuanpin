ALTER TABLE "类目表"
ADD COLUMN "负责人ID" VARCHAR(30);

CREATE INDEX "类目表_负责人ID_idx"
ON "类目表"("负责人ID");

ALTER TABLE "类目表"
ADD CONSTRAINT "类目表_负责人ID_fkey"
FOREIGN KEY ("负责人ID") REFERENCES "系统用户表"("用户ID")
ON DELETE SET NULL ON UPDATE CASCADE;

-- 为历史导入的二级类目补齐一级类目登记行，保留后续负责人分配入口。
INSERT INTO "类目表" (
  "类目ID", "类目名称", "一级类目", "二级类目", "是否启用", "创建时间", "更新时间"
)
SELECT
  substring(md5(random()::text || clock_timestamp()::text || c."一级类目"), 1, 30),
  c."一级类目",
  c."一级类目",
  NULL,
  TRUE,
  NOW(),
  NOW()
FROM "类目表" c
WHERE c."二级类目" IS NOT NULL
GROUP BY c."一级类目"
ON CONFLICT ("类目名称") DO NOTHING;
