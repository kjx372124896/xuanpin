import { BadRequestException, Controller, Get, Param, Post, Req, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import path from "node:path";
import { CanImport } from "../auth/auth.decorators";
import type { AuthenticatedRequest } from "../auth/request-user";
import { getUploadRoot } from "../common/paths";
import { ImportsService } from "./imports.service";

@Controller("imports")
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @CanImport()
  @Post("preview")
  @UseInterceptors(FilesInterceptor("files", 100, {
    storage: diskStorage({
      destination: (_req, _file, callback) => callback(null, getUploadRoot()),
      filename: (_req, file, callback) => callback(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${path.extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: 50 * 1024 * 1024, files: 100 },
    fileFilter: (_req, file, callback) => {
      if (file.originalname.startsWith("~$")) return callback(new BadRequestException("Excel 临时锁定文件不能导入。"), false);
      if (path.extname(file.originalname).toLowerCase() !== ".xlsx") return callback(new BadRequestException("目前仅支持 .xlsx 文件。"), false);
      callback(null, true);
    },
  }))
  preview(@UploadedFiles() files: Express.Multer.File[], @Req() req: AuthenticatedRequest) {
    if (!files?.length) throw new BadRequestException("请至少选择一个 Excel 文件。");
    return this.importsService.createPreview(files, req.user.id);
  }

  @CanImport()
  @Post(":batchId/confirm")
  confirm(@Param("batchId") batchId: string) { return this.importsService.confirm(batchId); }

  @Get()
  @CanImport()
  list() { return this.importsService.listBatches(); }

  @Get(":batchId")
  @CanImport()
  detail(@Param("batchId") batchId: string) { return this.importsService.getBatch(batchId); }
}
