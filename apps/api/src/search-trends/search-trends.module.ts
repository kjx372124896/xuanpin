import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { SearchTrendsController } from "./search-trends.controller";
import { SearchTrendsService } from "./search-trends.service";

@Module({
  imports: [PrismaModule],
  controllers: [SearchTrendsController],
  providers: [SearchTrendsService],
})
export class SearchTrendsModule {}
