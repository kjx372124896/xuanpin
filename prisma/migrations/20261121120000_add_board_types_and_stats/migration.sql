CREATE TYPE "榜单类型" AS ENUM ('NEW_PRODUCT_TRAFFIC', 'TRANSACTION_GROWTH');

ALTER TABLE "商品上榜历史表"
  ADD COLUMN "榜单类型" "榜单类型" NOT NULL DEFAULT 'NEW_PRODUCT_TRAFFIC',
  ADD COLUMN "商品关键词" TEXT;

ALTER TABLE "导入文件表"
  ADD COLUMN "榜单类型" "榜单类型";

DROP INDEX IF EXISTS "商品上榜历史_业务唯一键";
CREATE UNIQUE INDEX "商品上榜历史_榜单业务唯一键"
  ON "商品上榜历史表"("榜单类型", "商品ID", "周开始日期", "类目名称");
CREATE INDEX "商品上榜历史表_榜单类型_周开始日期_类目名称_idx"
  ON "商品上榜历史表"("榜单类型", "周开始日期", "类目名称");

CREATE TABLE "商品榜单统计表" (
  "商品ID" VARCHAR(80) NOT NULL,
  "榜单类型" "榜单类型" NOT NULL,
  "最新类目名称" VARCHAR(255),
  "最新一级类目" VARCHAR(255),
  "最新二级类目" VARCHAR(255),
  "首次上榜日期" DATE,
  "最近上榜日期" DATE,
  "最近上榜结束日期" DATE,
  "最近行业排名" INTEGER,
  "历史上榜周数" INTEGER NOT NULL DEFAULT 0,
  "历史记录条数" INTEGER NOT NULL DEFAULT 0,
  "连续上榜周数" INTEGER NOT NULL DEFAULT 0,
  "最新访客数原值" VARCHAR(100),
  "最新访客数下限" DECIMAL(20,2),
  "最新访客数上限" DECIMAL(20,2),
  "最新访客数中值" DECIMAL(20,2),
  "最新支付买家数原值" VARCHAR(100),
  "最新支付买家数下限" DECIMAL(20,2),
  "最新支付买家数上限" DECIMAL(20,2),
  "最新支付买家数中值" DECIMAL(20,2),
  "创建时间" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "更新时间" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "商品榜单统计表_pkey" PRIMARY KEY ("商品ID", "榜单类型"),
  CONSTRAINT "商品榜单统计表_商品ID_fkey" FOREIGN KEY ("商品ID") REFERENCES "商品主表"("商品ID") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "商品榜单统计表_榜单类型_最近上榜日期_idx"
  ON "商品榜单统计表"("榜单类型", "最近上榜日期");
CREATE INDEX "商品榜单统计表_榜单类型_最新一级类目_最新二级类目_idx"
  ON "商品榜单统计表"("榜单类型", "最新一级类目", "最新二级类目");
CREATE INDEX "商品榜单统计表_榜单类型_最新支付买家数中值_idx"
  ON "商品榜单统计表"("榜单类型", "最新支付买家数中值");

-- 迁移前的历史记录全部属于原有新品流量榜单；为现有商品建立对应统计快照。
WITH latest AS (
  SELECT DISTINCT ON (h."商品ID", h."榜单类型")
    h."商品ID", h."榜单类型", h."周开始日期", h."周结束日期", h."类目名称",
    h."一级类目", h."二级类目", h."行业排名",
    h."访客数原值", h."访客数下限", h."访客数上限", h."访客数中值",
    h."支付买家数原值", h."支付买家数下限", h."支付买家数上限", h."支付买家数中值"
  FROM "商品上榜历史表" h
  ORDER BY h."商品ID", h."榜单类型", h."周开始日期" DESC, h."导出时间" DESC NULLS LAST, h."导入时间" DESC, h."类目名称" ASC
),
counts AS (
  SELECT h."商品ID", h."榜单类型", MIN(h."周开始日期") AS first_week,
    COUNT(*)::int AS record_count, COUNT(DISTINCT h."周开始日期")::int AS week_count
  FROM "商品上榜历史表" h
  GROUP BY h."商品ID", h."榜单类型"
),
week_rows AS (
  SELECT DISTINCT h."商品ID", h."榜单类型", h."周开始日期",
    ROW_NUMBER() OVER (PARTITION BY h."商品ID", h."榜单类型" ORDER BY h."周开始日期" DESC) AS rn,
    MAX(h."周开始日期") OVER (PARTITION BY h."商品ID", h."榜单类型") AS latest_week
  FROM "商品上榜历史表" h
),
streak AS (
  SELECT "商品ID", "榜单类型",
    COUNT(*) FILTER (WHERE "周开始日期" = latest_week - ((rn - 1) * INTERVAL '7 days'))::int AS streak_count
  FROM week_rows
  GROUP BY "商品ID", "榜单类型"
)
INSERT INTO "商品榜单统计表" (
  "商品ID", "榜单类型", "最新类目名称", "最新一级类目", "最新二级类目",
  "首次上榜日期", "最近上榜日期", "最近上榜结束日期", "最近行业排名",
  "历史上榜周数", "历史记录条数", "连续上榜周数",
  "最新访客数原值", "最新访客数下限", "最新访客数上限", "最新访客数中值",
  "最新支付买家数原值", "最新支付买家数下限", "最新支付买家数上限", "最新支付买家数中值",
  "创建时间", "更新时间"
)
SELECT
  l."商品ID", l."榜单类型", l."类目名称", l."一级类目", l."二级类目",
  c.first_week, l."周开始日期", l."周结束日期", l."行业排名",
  c.week_count, c.record_count, COALESCE(s.streak_count, 0),
  l."访客数原值", l."访客数下限", l."访客数上限", l."访客数中值",
  l."支付买家数原值", l."支付买家数下限", l."支付买家数上限", l."支付买家数中值",
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM latest l
JOIN counts c ON c."商品ID" = l."商品ID" AND c."榜单类型" = l."榜单类型"
LEFT JOIN streak s ON s."商品ID" = l."商品ID" AND s."榜单类型" = l."榜单类型";
