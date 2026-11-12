-- CreateEnum
CREATE TYPE "用户角色" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "员工状态" AS ENUM ('ACTIVE', 'RESIGNED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "账号状态" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "导入批次状态" AS ENUM ('PREVIEW', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "导入文件状态" AS ENUM ('PREVIEW', 'DUPLICATE', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "商品主表" (
    "商品ID" VARCHAR(80) NOT NULL,
    "商品名称" TEXT NOT NULL,
    "商品链接" TEXT,
    "店铺名称" VARCHAR(255),
    "店铺类型" VARCHAR(80),
    "商品图片链接" TEXT,
    "最新类目名称" VARCHAR(255),
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
    "最新支付买家数原值" VARCHAR(100),
    "最新支付买家数下限" DECIMAL(20,2),
    "最新支付买家数上限" DECIMAL(20,2),
    "最新加购人数原值" VARCHAR(100),
    "最新加购人数下限" DECIMAL(20,2),
    "最新加购人数上限" DECIMAL(20,2),
    "创建时间" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "更新时间" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "商品主表_pkey" PRIMARY KEY ("商品ID")
);

-- CreateTable
CREATE TABLE "商品上榜历史表" (
    "历史记录ID" VARCHAR(30) NOT NULL,
    "商品ID" VARCHAR(80) NOT NULL,
    "周开始日期" DATE NOT NULL,
    "周结束日期" DATE NOT NULL,
    "原始日期范围" VARCHAR(80) NOT NULL,
    "类目名称" VARCHAR(255) NOT NULL,
    "行业排名" INTEGER,
    "趋势" VARCHAR(80),
    "访客数原值" VARCHAR(100),
    "访客数下限" DECIMAL(20,2),
    "访客数上限" DECIMAL(20,2),
    "访客数估算值" DECIMAL(20,2),
    "支付买家数原值" VARCHAR(100),
    "支付买家数下限" DECIMAL(20,2),
    "支付买家数上限" DECIMAL(20,2),
    "支付买家数估算值" DECIMAL(20,2),
    "加购人数原值" VARCHAR(100),
    "加购人数下限" DECIMAL(20,2),
    "加购人数上限" DECIMAL(20,2),
    "加购人数估算值" DECIMAL(20,2),
    "导出时间" TIMESTAMP(3),
    "来源文件ID" VARCHAR(30),
    "来源文件名" TEXT,
    "来源行号" INTEGER,
    "导入时间" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "商品上榜历史表_pkey" PRIMARY KEY ("历史记录ID")
);

-- CreateTable
CREATE TABLE "类目表" (
    "类目ID" VARCHAR(30) NOT NULL,
    "类目名称" VARCHAR(255) NOT NULL,
    "是否启用" BOOLEAN NOT NULL DEFAULT true,
    "创建时间" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "更新时间" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "类目表_pkey" PRIMARY KEY ("类目ID")
);

-- CreateTable
CREATE TABLE "导入批次表" (
    "批次ID" VARCHAR(30) NOT NULL,
    "操作人ID" VARCHAR(30),
    "批次状态" "导入批次状态" NOT NULL DEFAULT 'PREVIEW',
    "总文件数" INTEGER NOT NULL DEFAULT 0,
    "总数据行数" INTEGER NOT NULL DEFAULT 0,
    "成功入库行数" INTEGER NOT NULL DEFAULT 0,
    "重复行数" INTEGER NOT NULL DEFAULT 0,
    "失败行数" INTEGER NOT NULL DEFAULT 0,
    "新增商品数" INTEGER NOT NULL DEFAULT 0,
    "新增历史记录数" INTEGER NOT NULL DEFAULT 0,
    "更新历史记录数" INTEGER NOT NULL DEFAULT 0,
    "错误摘要" TEXT,
    "上传时间" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "开始时间" TIMESTAMP(3),
    "完成时间" TIMESTAMP(3),

    CONSTRAINT "导入批次表_pkey" PRIMARY KEY ("批次ID")
);

-- CreateTable
CREATE TABLE "导入文件表" (
    "文件记录ID" VARCHAR(30) NOT NULL,
    "批次ID" VARCHAR(30) NOT NULL,
    "原始文件名" TEXT NOT NULL,
    "文件SHA256" CHAR(64) NOT NULL,
    "文件大小" BIGINT NOT NULL,
    "工作表名称" VARCHAR(255),
    "周开始日期" DATE,
    "周结束日期" DATE,
    "类目名称" VARCHAR(255),
    "原始数据行数" INTEGER NOT NULL DEFAULT 0,
    "成功行数" INTEGER NOT NULL DEFAULT 0,
    "失败行数" INTEGER NOT NULL DEFAULT 0,
    "文件状态" "导入文件状态" NOT NULL DEFAULT 'PREVIEW',
    "存储路径" TEXT NOT NULL,
    "合并来源文件名" TEXT,
    "错误明细" TEXT,

    CONSTRAINT "导入文件表_pkey" PRIMARY KEY ("文件记录ID")
);

-- CreateTable
CREATE TABLE "系统用户表" (
    "用户ID" VARCHAR(30) NOT NULL,
    "登录账号" VARCHAR(80) NOT NULL,
    "密码哈希" VARCHAR(255) NOT NULL,
    "员工姓名" VARCHAR(100) NOT NULL,
    "员工编号" VARCHAR(80),
    "所属部门" VARCHAR(120),
    "用户角色" "用户角色" NOT NULL DEFAULT 'EMPLOYEE',
    "员工状态" "员工状态" NOT NULL DEFAULT 'ACTIVE',
    "账号状态" "账号状态" NOT NULL DEFAULT 'ACTIVE',
    "允许导入" BOOLEAN NOT NULL DEFAULT false,
    "创建时间" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "更新时间" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "系统用户表_pkey" PRIMARY KEY ("用户ID")
);

-- CreateTable
CREATE TABLE "登录会话表" (
    "会话ID" VARCHAR(30) NOT NULL,
    "用户ID" VARCHAR(30) NOT NULL,
    "会话令牌哈希" CHAR(64) NOT NULL,
    "过期时间" TIMESTAMP(3) NOT NULL,
    "创建时间" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "登录会话表_pkey" PRIMARY KEY ("会话ID")
);

-- CreateTable
CREATE TABLE "公司IP白名单表" (
    "规则ID" VARCHAR(30) NOT NULL,
    "IP或网段" VARCHAR(100) NOT NULL,
    "备注" VARCHAR(120) NOT NULL,
    "是否启用" BOOLEAN NOT NULL DEFAULT true,
    "创建时间" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "更新时间" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "公司IP白名单表_pkey" PRIMARY KEY ("规则ID")
);

-- CreateIndex
CREATE INDEX "商品主表_商品名称_idx" ON "商品主表"("商品名称");

-- CreateIndex
CREATE INDEX "商品主表_店铺名称_idx" ON "商品主表"("店铺名称");

-- CreateIndex
CREATE INDEX "商品主表_最新类目名称_最近上榜日期_idx" ON "商品主表"("最新类目名称", "最近上榜日期");

-- CreateIndex
CREATE INDEX "商品上榜历史表_商品ID_周开始日期_idx" ON "商品上榜历史表"("商品ID", "周开始日期");

-- CreateIndex
CREATE INDEX "商品上榜历史表_周开始日期_类目名称_行业_idx" ON "商品上榜历史表"("周开始日期", "类目名称", "行业排名");

-- CreateIndex
CREATE UNIQUE INDEX "商品上榜历史_业务唯一键" ON "商品上榜历史表"("商品ID", "周开始日期", "类目名称");

-- CreateIndex
CREATE UNIQUE INDEX "类目表_类目名称_key" ON "类目表"("类目名称");

-- CreateIndex
CREATE INDEX "导入批次表_批次状态_上传时间_idx" ON "导入批次表"("批次状态", "上传时间");

-- CreateIndex
CREATE INDEX "导入文件表_文件SHA256_idx" ON "导入文件表"("文件SHA256");

-- CreateIndex
CREATE INDEX "导入文件表_批次ID_文件状态_idx" ON "导入文件表"("批次ID", "文件状态");

-- CreateIndex
CREATE UNIQUE INDEX "系统用户表_登录账号_key" ON "系统用户表"("登录账号");

-- CreateIndex
CREATE UNIQUE INDEX "系统用户表_员工编号_key" ON "系统用户表"("员工编号");

-- CreateIndex
CREATE INDEX "系统用户表_用户角色_账号状态_员工状态_idx" ON "系统用户表"("用户角色", "账号状态", "员工状态");

-- CreateIndex
CREATE UNIQUE INDEX "登录会话表_会话令牌哈希_key" ON "登录会话表"("会话令牌哈希");

-- CreateIndex
CREATE INDEX "登录会话表_用户ID_过期时间_idx" ON "登录会话表"("用户ID", "过期时间");

-- CreateIndex
CREATE UNIQUE INDEX "公司IP白名单表_IP或网段_key" ON "公司IP白名单表"("IP或网段");

-- AddForeignKey
ALTER TABLE "商品上榜历史表" ADD CONSTRAINT "商品上榜历史表_商品ID_fkey" FOREIGN KEY ("商品ID") REFERENCES "商品主表"("商品ID") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "商品上榜历史表" ADD CONSTRAINT "商品上榜历史表_来源文件ID_fkey" FOREIGN KEY ("来源文件ID") REFERENCES "导入文件表"("文件记录ID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "导入文件表" ADD CONSTRAINT "导入文件表_批次ID_fkey" FOREIGN KEY ("批次ID") REFERENCES "导入批次表"("批次ID") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "登录会话表" ADD CONSTRAINT "登录会话表_用户ID_fkey" FOREIGN KEY ("用户ID") REFERENCES "系统用户表"("用户ID") ON DELETE CASCADE ON UPDATE CASCADE;
