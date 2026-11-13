CREATE TABLE "达摩盘采集任务表" (
    "任务ID" VARCHAR(30) NOT NULL,
    "创建管理员ID" VARCHAR(30) NOT NULL,
    "任务名称" VARCHAR(255) NOT NULL,
    "任务状态" VARCHAR(30) NOT NULL DEFAULT 'QUEUED',
    "商品ID列表" TEXT NOT NULL,
    "商品总数" INTEGER NOT NULL DEFAULT 0,
    "批次总数" INTEGER NOT NULL DEFAULT 0,
    "完成批次数" INTEGER NOT NULL DEFAULT 0,
    "失败批次数" INTEGER NOT NULL DEFAULT 0,
    "已入库商品数" INTEGER NOT NULL DEFAULT 0,
    "最近错误" TEXT,
    "创建时间" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "开始时间" TIMESTAMP(3),
    "完成时间" TIMESTAMP(3),
    "更新时间" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "达摩盘采集任务表_pkey" PRIMARY KEY ("任务ID")
);

CREATE TABLE "达摩盘采集批次表" (
    "批次ID" VARCHAR(30) NOT NULL,
    "任务ID" VARCHAR(30) NOT NULL,
    "批次序号" INTEGER NOT NULL,
    "商品ID列表" TEXT NOT NULL,
    "客户端任务ID" VARCHAR(100) NOT NULL,
    "历史客户端任务ID" TEXT NOT NULL DEFAULT '[]',
    "批次状态" VARCHAR(30) NOT NULL DEFAULT 'QUEUED',
    "执行次数" INTEGER NOT NULL DEFAULT 0,
    "恢复查询次数" INTEGER NOT NULL DEFAULT 0,
    "已入库商品数" INTEGER NOT NULL DEFAULT 0,
    "下次执行时间" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "最近错误" TEXT,
    "开始时间" TIMESTAMP(3),
    "完成时间" TIMESTAMP(3),
    "创建时间" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "更新时间" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "达摩盘采集批次表_pkey" PRIMARY KEY ("批次ID")
);

CREATE INDEX "达摩盘采集任务表_任务状态_创建时间_idx" ON "达摩盘采集任务表"("任务状态", "创建时间");
CREATE INDEX "达摩盘采集任务表_创建管理员ID_创建时间_idx" ON "达摩盘采集任务表"("创建管理员ID", "创建时间");
CREATE UNIQUE INDEX "达摩盘采集批次表_客户端任务ID_key" ON "达摩盘采集批次表"("客户端任务ID");
CREATE UNIQUE INDEX "达摩盘采集批次表_任务ID_批次序号_key" ON "达摩盘采集批次表"("任务ID", "批次序号");
CREATE INDEX "达摩盘采集批次表_批次状态_下次执行时间_idx" ON "达摩盘采集批次表"("批次状态", "下次执行时间");
CREATE INDEX "达摩盘采集批次表_任务ID_批次状态_idx" ON "达摩盘采集批次表"("任务ID", "批次状态");

ALTER TABLE "达摩盘采集任务表" ADD CONSTRAINT "达摩盘采集任务表_创建管理员ID_fkey"
FOREIGN KEY ("创建管理员ID") REFERENCES "系统用户表"("用户ID") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "达摩盘采集批次表" ADD CONSTRAINT "达摩盘采集批次表_任务ID_fkey"
FOREIGN KEY ("任务ID") REFERENCES "达摩盘采集任务表"("任务ID") ON DELETE CASCADE ON UPDATE CASCADE;
