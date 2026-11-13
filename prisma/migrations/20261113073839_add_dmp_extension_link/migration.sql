-- CreateTable
CREATE TABLE "达摩盘浏览器扩展绑定表" (
    "扩展绑定ID" VARCHAR(30) NOT NULL,
    "用户ID" VARCHAR(30) NOT NULL,
    "配对码哈希" CHAR(64),
    "配对码过期时间" TIMESTAMP(3),
    "扩展令牌哈希" CHAR(64),
    "扩展令牌过期时间" TIMESTAMP(3),
    "扩展最近在线时间" TIMESTAMP(3),
    "最近同步时间" TIMESTAMP(3),
    "扩展状态" VARCHAR(30) NOT NULL DEFAULT 'NOT_PAIRED',
    "最近错误" VARCHAR(300),
    "创建时间" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "更新时间" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "达摩盘浏览器扩展绑定表_pkey" PRIMARY KEY ("扩展绑定ID")
);

-- CreateIndex
CREATE UNIQUE INDEX "达摩盘浏览器扩展绑定表_用户ID_key" ON "达摩盘浏览器扩展绑定表"("用户ID");

-- CreateIndex
CREATE UNIQUE INDEX "达摩盘浏览器扩展绑定表_配对码哈希_key" ON "达摩盘浏览器扩展绑定表"("配对码哈希");

-- CreateIndex
CREATE UNIQUE INDEX "达摩盘浏览器扩展绑定表_扩展令牌哈希_key" ON "达摩盘浏览器扩展绑定表"("扩展令牌哈希");

-- AddForeignKey
ALTER TABLE "达摩盘浏览器扩展绑定表" ADD CONSTRAINT "达摩盘浏览器扩展绑定表_用户ID_fkey" FOREIGN KEY ("用户ID") REFERENCES "系统用户表"("用户ID") ON DELETE CASCADE ON UPDATE CASCADE;
