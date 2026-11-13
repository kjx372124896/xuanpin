ALTER TABLE "商品主表"
ADD COLUMN "AI数据获取时间" TIMESTAMP(3);

-- 兼容升级前已成功获取的数据：任意一个指标存在有效内容，即视为已获取。
-- 不要求十个指标全部有值，避免把部分指标缺失的成功结果误判为未获取。
UPDATE "商品主表" AS product
SET "AI数据获取时间" = COALESCE(product."更新时间", product."创建时间", CURRENT_TIMESTAMP)
WHERE
  (
    NULLIF(BTRIM(product."上期销售额"), '') IS NOT NULL AND BTRIM(product."上期销售额") NOT IN ('-', '--', '—', '–', '－', '暂无', '暂无数据', '无数据', 'N/A', 'n/a')
    OR NULLIF(BTRIM(product."销售额"), '') IS NOT NULL AND BTRIM(product."销售额") NOT IN ('-', '--', '—', '–', '－', '暂无', '暂无数据', '无数据', 'N/A', 'n/a')
    OR NULLIF(BTRIM(product."点击率"), '') IS NOT NULL AND BTRIM(product."点击率") NOT IN ('-', '--', '—', '–', '－', '暂无', '暂无数据', '无数据', 'N/A', 'n/a')
    OR NULLIF(BTRIM(product."转化率"), '') IS NOT NULL AND BTRIM(product."转化率") NOT IN ('-', '--', '—', '–', '－', '暂无', '暂无数据', '无数据', 'N/A', 'n/a')
    OR NULLIF(BTRIM(product."加购率"), '') IS NOT NULL AND BTRIM(product."加购率") NOT IN ('-', '--', '—', '–', '－', '暂无', '暂无数据', '无数据', 'N/A', 'n/a')
    OR NULLIF(BTRIM(product."加购成本"), '') IS NOT NULL AND BTRIM(product."加购成本") NOT IN ('-', '--', '—', '–', '－', '暂无', '暂无数据', '无数据', 'N/A', 'n/a')
    OR NULLIF(BTRIM(product."投产比"), '') IS NOT NULL AND BTRIM(product."投产比") NOT IN ('-', '--', '—', '–', '－', '暂无', '暂无数据', '无数据', 'N/A', 'n/a')
    OR NULLIF(BTRIM(product."件单价"), '') IS NOT NULL AND BTRIM(product."件单价") NOT IN ('-', '--', '—', '–', '－', '暂无', '暂无数据', '无数据', 'N/A', 'n/a')
    OR NULLIF(BTRIM(product."花费"), '') IS NOT NULL AND BTRIM(product."花费") NOT IN ('-', '--', '—', '–', '－', '暂无', '暂无数据', '无数据', 'N/A', 'n/a')
    OR NULLIF(BTRIM(product."CPC"), '') IS NOT NULL AND BTRIM(product."CPC") NOT IN ('-', '--', '—', '–', '－', '暂无', '暂无数据', '无数据', 'N/A', 'n/a')
  )
  OR EXISTS (
    SELECT 1
    FROM "达摩盘AI任务表" AS run
    WHERE run."AI返回Markdown" IS NOT NULL
      AND BTRIM(run."AI返回Markdown") <> ''
      AND run."商品ID列表" LIKE '%"' || product."商品ID" || '"%'
  );

CREATE INDEX "商品主表_AI数据获取时间_idx"
ON "商品主表"("AI数据获取时间");
