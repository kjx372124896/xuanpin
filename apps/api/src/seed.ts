import { config } from "dotenv";
import path from "node:path";
import * as bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { getProjectRoot } from "./common/paths";

config({ path: path.join(getProjectRoot(), ".env") });

async function main() {
  const username = process.env.ADMIN_USERNAME?.trim() || "admin";
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 8 || password.includes("请替换")) {
    throw new Error("请先在项目根目录 .env 中设置至少 8 位的 ADMIN_PASSWORD。");
  }
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      console.log(`超级管理员账号已存在：${username}（不会覆盖现有密码）`);
      return;
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: {
        username, passwordHash, name: process.env.ADMIN_NAME || "超级管理员",
        role: "SUPER_ADMIN", employmentStatus: "ACTIVE", accountStatus: "ACTIVE", canImport: true,
      },
    });
    console.log(`已创建超级管理员账号：${username}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => { console.error(error); process.exit(1); });
