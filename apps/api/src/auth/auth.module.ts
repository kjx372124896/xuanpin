import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { DeviceBindingService } from "./device-binding.service";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, DeviceBindingService],
  exports: [AuthService, AuthGuard, DeviceBindingService],
})
export class AuthModule {}
