-- CreateTable
CREATE TABLE "商品收藏表" (
    "用户ID" VARCHAR(30) NOT NULL,
    "商品ID" VARCHAR(80) NOT NULL,
    "收藏时间" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "商品收藏表_pkey" PRIMARY KEY ("用户ID","商品ID")
);

-- CreateIndex
CREATE INDEX "商品收藏表_商品ID_idx" ON "商品收藏表"("商品ID");

-- AddForeignKey
ALTER TABLE "商品收藏表" ADD CONSTRAINT "商品收藏表_用户ID_fkey" FOREIGN KEY ("用户ID") REFERENCES "系统用户表"("用户ID") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "商品收藏表" ADD CONSTRAINT "商品收藏表_商品ID_fkey" FOREIGN KEY ("商品ID") REFERENCES "商品主表"("商品ID") ON DELETE CASCADE ON UPDATE CASCADE;
