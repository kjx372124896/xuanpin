-- CreateEnum
CREATE TYPE "导入类型" AS ENUM ('PRODUCT_BOARD', 'SEARCH_BOARD');

-- AlterTable
ALTER TABLE "导入批次表" ADD COLUMN     "导入类型" "导入类型" NOT NULL DEFAULT 'PRODUCT_BOARD';

-- AlterTable
ALTER TABLE "导入文件表" ADD COLUMN     "搜索榜单类型" VARCHAR(80),
ADD COLUMN     "搜索类目" VARCHAR(255),
ADD COLUMN     "搜索词类型" VARCHAR(80),
ADD COLUMN     "数据开始日期" DATE,
ADD COLUMN     "数据结束日期" DATE,
ADD COLUMN     "统计维度" VARCHAR(20);

-- CreateTable
CREATE TABLE "搜索词日历史表" (
    "搜索历史ID" VARCHAR(30) NOT NULL,
    "搜索词" VARCHAR(500) NOT NULL,
    "类目" VARCHAR(255) NOT NULL,
    "分类名称" VARCHAR(255),
    "搜索词类型" VARCHAR(80) NOT NULL,
    "搜索榜单类型" VARCHAR(80) NOT NULL,
    "统计维度" VARCHAR(20) NOT NULL DEFAULT '日',
    "统计日期" DATE NOT NULL,
    "排名" INTEGER,
    "搜索人数原值" VARCHAR(100),
    "搜索人数下限" DECIMAL(20,2),
    "搜索人数上限" DECIMAL(20,2),
    "搜索人数中值" DECIMAL(20,2),
    "点击率" VARCHAR(100),
    "支付转化率" VARCHAR(100),
    "导出时间" TIMESTAMP(3),
    "来源文件ID" VARCHAR(30),
    "来源文件名" TEXT,
    "来源行号" INTEGER,
    "导入时间" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "搜索词日历史表_pkey" PRIMARY KEY ("搜索历史ID")
);

-- CreateIndex
CREATE INDEX "搜索词日历史表_统计日期_类目_idx" ON "搜索词日历史表"("统计日期", "类目");

-- CreateIndex
CREATE INDEX "搜索词日历史表_搜索词_统计日期_idx" ON "搜索词日历史表"("搜索词", "统计日期");

-- CreateIndex
CREATE INDEX "搜索词日历史表_搜索词类型_搜索榜单类型__idx" ON "搜索词日历史表"("搜索词类型", "搜索榜单类型", "统计日期");

-- CreateIndex
CREATE INDEX "搜索词日历史表_搜索人数中值_idx" ON "搜索词日历史表"("搜索人数中值");

-- CreateIndex
CREATE UNIQUE INDEX "搜索词日历史_业务唯一键" ON "搜索词日历史表"("搜索词", "类目", "搜索词类型", "搜索榜单类型", "统计维度", "统计日期");

-- AddForeignKey
ALTER TABLE "搜索词日历史表" ADD CONSTRAINT "搜索词日历史表_来源文件ID_fkey" FOREIGN KEY ("来源文件ID") REFERENCES "导入文件表"("文件记录ID") ON DELETE SET NULL ON UPDATE CASCADE;
