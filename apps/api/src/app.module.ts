import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AdminModule } from "./admin/admin.module";
import { AuthGuard } from "./auth/auth.guard";
import { AuthModule } from "./auth/auth.module";
import { ImportsModule } from "./imports/imports.module";
import { HealthController } from "./health.controller";
import { PrismaModule } from "./prisma/prisma.module";
import { ProductsModule } from "./products/products.module";

@Module({
  imports: [PrismaModule, AuthModule, AdminModule, ProductsModule, ImportsModule],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useExisting: AuthGuard }],
})
export class AppModule {}
