import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import path from "node:path";
import { getProjectRoot } from "./common/paths";

config({ path: path.join(getProjectRoot(), ".env") });

const prisma = new PrismaClient();

async function main() {
  const [username, confirmation] = process.argv.slice(2).filter((argument) => argument !== "--");
  if (!username || confirmation !== "--confirm") {
    throw new Error("用法：pnpm device:reset -- <登录账号> --confirm");
  }

  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true, username: true, name: true, role: true },
  });
  if (!user) throw new Error(`账号不存在：${username}`);

  await prisma.$transaction(async (tx) => {
    await tx.userDeviceBinding.deleteMany({ where: { userId: user.id } });
    await tx.loginSession.deleteMany({ where: { userId: user.id } });
    await tx.deviceChangeRequest.updateMany({
      where: { userId: user.id, status: "PENDING" },
      data: { status: "EXPIRED", reviewedAt: new Date(), reviewNote: "服务器紧急恢复操作已重置设备绑定。" },
    });
    await tx.deviceAuditLog.create({
      data: {
        userId: user.id,
        action: "SERVER_RECOVERY_RESET",
        detailsJson: JSON.stringify({ username: user.username, role: user.role }),
      },
    });
  });

  console.log(`已重置账号 ${user.username}（${user.name}）的设备绑定和登录会话。该账号下次登录将自动绑定当前浏览器。`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
