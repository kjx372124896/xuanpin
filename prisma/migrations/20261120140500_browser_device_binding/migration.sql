ALTER TABLE "登录会话表" ADD COLUMN "设备令牌哈希" CHAR(64);

CREATE TABLE "用户设备绑定表" (
    "设备绑定ID" VARCHAR(30) NOT NULL,
    "用户ID" VARCHAR(30) NOT NULL,
    "设备令牌哈希" CHAR(64) NOT NULL,
    "浏览器名称" VARCHAR(80) NOT NULL,
    "浏览器版本" VARCHAR(80),
    "操作系统" VARCHAR(80) NOT NULL,
    "浏览器标识" VARCHAR(500) NOT NULL,
    "首次绑定时间" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "最近使用时间" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "最近登录IP" VARCHAR(100),
    CONSTRAINT "用户设备绑定表_pkey" PRIMARY KEY ("设备绑定ID")
);

CREATE TABLE "设备更换申请表" (
    "申请ID" VARCHAR(30) NOT NULL,
    "用户ID" VARCHAR(30) NOT NULL,
    "申请设备令牌哈希" CHAR(64) NOT NULL,
    "浏览器名称" VARCHAR(80) NOT NULL,
    "浏览器版本" VARCHAR(80),
    "操作系统" VARCHAR(80) NOT NULL,
    "浏览器标识" VARCHAR(500) NOT NULL,
    "申请IP" VARCHAR(100),
    "申请状态" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "申请时间" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "审批时间" TIMESTAMP(3),
    "审批管理员ID" VARCHAR(30),
    "审批备注" VARCHAR(500),
    CONSTRAINT "设备更换申请表_pkey" PRIMARY KEY ("申请ID")
);

CREATE TABLE "设备操作日志表" (
    "日志ID" VARCHAR(30) NOT NULL,
    "目标用户ID" VARCHAR(30) NOT NULL,
    "操作人ID" VARCHAR(30),
    "操作类型" VARCHAR(40) NOT NULL,
    "操作详情" TEXT,
    "操作IP" VARCHAR(100),
    "操作时间" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "设备操作日志表_pkey" PRIMARY KEY ("日志ID")
);

CREATE UNIQUE INDEX "用户设备绑定表_用户ID_key" ON "用户设备绑定表"("用户ID");
CREATE INDEX "用户设备绑定表_设备令牌哈希_idx" ON "用户设备绑定表"("设备令牌哈希");
CREATE INDEX "用户设备绑定表_最近使用时间_idx" ON "用户设备绑定表"("最近使用时间");
CREATE INDEX "设备更换申请表_用户ID_申请状态_申请时间_idx" ON "设备更换申请表"("用户ID", "申请状态", "申请时间");
CREATE INDEX "设备更换申请表_申请状态_申请时间_idx" ON "设备更换申请表"("申请状态", "申请时间");
CREATE INDEX "设备操作日志表_目标用户ID_操作时间_idx" ON "设备操作日志表"("目标用户ID", "操作时间");
CREATE INDEX "设备操作日志表_操作时间_idx" ON "设备操作日志表"("操作时间");

ALTER TABLE "用户设备绑定表" ADD CONSTRAINT "用户设备绑定表_用户ID_fkey"
FOREIGN KEY ("用户ID") REFERENCES "系统用户表"("用户ID") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "设备更换申请表" ADD CONSTRAINT "设备更换申请表_用户ID_fkey"
FOREIGN KEY ("用户ID") REFERENCES "系统用户表"("用户ID") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "设备更换申请表" ADD CONSTRAINT "设备更换申请表_审批管理员ID_fkey"
FOREIGN KEY ("审批管理员ID") REFERENCES "系统用户表"("用户ID") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "设备操作日志表" ADD CONSTRAINT "设备操作日志表_目标用户ID_fkey"
FOREIGN KEY ("目标用户ID") REFERENCES "系统用户表"("用户ID") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "设备操作日志表" ADD CONSTRAINT "设备操作日志表_操作人ID_fkey"
FOREIGN KEY ("操作人ID") REFERENCES "系统用户表"("用户ID") ON DELETE SET NULL ON UPDATE CASCADE;
