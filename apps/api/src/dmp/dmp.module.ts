import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { ProductsModule } from "../products/products.module";
import { DmpController } from "./dmp.controller";
import { DmpAiService } from "./dmp-ai.service";
import { DmpAuthService } from "./dmp-auth.service";
import { DmpJobsService } from "./dmp-jobs.service";

@Module({ imports: [PrismaModule, AuthModule, ProductsModule], controllers: [DmpController], providers: [DmpAuthService, DmpAiService, DmpJobsService] })
export class DmpModule {}
