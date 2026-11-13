import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AdminModule } from "./admin/admin.module";
import { AuthGuard } from "./auth/auth.guard";
import { AuthModule } from "./auth/auth.module";
import { ImportsModule } from "./imports/imports.module";
import { HealthController } from "./health.controller";
import { PrismaModule } from "./prisma/prisma.module";
import { ProductsModule } from "./products/products.module";
import { DmpModule } from "./dmp/dmp.module";

@Module({
  imports: [PrismaModule, AuthModule, AdminModule, ProductsModule, ImportsModule, DmpModule],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useExisting: AuthGuard }],
})
export class AppModule {}
