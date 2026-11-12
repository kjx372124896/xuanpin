import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { IpService } from "./ip.service";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, IpService],
  exports: [AuthService, AuthGuard, IpService],
})
export class AuthModule {}
