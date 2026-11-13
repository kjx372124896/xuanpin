-- CreateTable
CREATE TABLE "达摩盘授权表" (
    "授权ID" VARCHAR(30) NOT NULL,
    "用户ID" VARCHAR(30) NOT NULL,
    "加密凭证" TEXT NOT NULL,
    "最近验证状态" VARCHAR(30) NOT NULL DEFAULT 'NOT_TESTED',
    "最近验证时间" TIMESTAMP(3),
    "最近错误" VARCHAR(300),
    "创建时间" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "更新时间" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "达摩盘授权表_pkey" PRIMARY KEY ("授权ID")
);

-- CreateTable
CREATE TABLE "达摩盘AI任务表" (
    "任务ID" VARCHAR(30) NOT NULL,
    "用户ID" VARCHAR(30) NOT NULL,
    "客户端任务ID" VARCHAR(100) NOT NULL,
    "批次序号" INTEGER NOT NULL,
    "商品ID列表" TEXT NOT NULL,
    "达摩盘会话ID" VARCHAR(120),
    "任务状态" VARCHAR(30) NOT NULL DEFAULT 'CREATED',
    "AI返回Markdown" TEXT,
    "错误信息" VARCHAR(500),
    "创建时间" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "更新时间" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "达摩盘AI任务表_pkey" PRIMARY KEY ("任务ID")
);

-- CreateIndex
CREATE UNIQUE INDEX "达摩盘授权表_用户ID_key" ON "达摩盘授权表"("用户ID");

-- CreateIndex
CREATE INDEX "达摩盘AI任务表_用户ID_创建时间_idx" ON "达摩盘AI任务表"("用户ID", "创建时间");

-- CreateIndex
CREATE UNIQUE INDEX "达摩盘AI任务表_用户ID_客户端任务ID_key" ON "达摩盘AI任务表"("用户ID", "客户端任务ID");

-- AddForeignKey
ALTER TABLE "达摩盘授权表" ADD CONSTRAINT "达摩盘授权表_用户ID_fkey" FOREIGN KEY ("用户ID") REFERENCES "系统用户表"("用户ID") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "达摩盘AI任务表" ADD CONSTRAINT "达摩盘AI任务表_用户ID_fkey" FOREIGN KEY ("用户ID") REFERENCES "系统用户表"("用户ID") ON DELETE CASCADE ON UPDATE CASCADE;
