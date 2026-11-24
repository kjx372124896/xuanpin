CREATE TABLE "搜索词收藏表" (
    "用户ID" VARCHAR(30) NOT NULL,
    "搜索词" VARCHAR(500) NOT NULL,
    "类目" VARCHAR(255) NOT NULL,
    "搜索词类型" VARCHAR(80) NOT NULL,
    "搜索榜单类型" VARCHAR(80) NOT NULL,
    "统计维度" VARCHAR(20) NOT NULL,
    "收藏时间" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "搜索词收藏表_pkey" PRIMARY KEY ("用户ID", "搜索词", "类目", "搜索词类型", "搜索榜单类型", "统计维度")
);

CREATE INDEX "搜索词收藏_搜索分组索引" ON "搜索词收藏表"("搜索词", "类目", "搜索词类型", "搜索榜单类型", "统计维度");

ALTER TABLE "搜索词收藏表" ADD CONSTRAINT "搜索词收藏表_用户ID_fkey" FOREIGN KEY ("用户ID") REFERENCES "系统用户表"("用户ID") ON DELETE CASCADE ON UPDATE CASCADE;
