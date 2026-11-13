import { Body, Controller, Delete, Get, Headers, Param, Post, Put, Req } from "@nestjs/common";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from "class-validator";
import { Type } from "class-transformer";
import type { AuthenticatedRequest } from "../auth/request-user";
import { Public, Roles } from "../auth/auth.decorators";
import { DmpAiService } from "./dmp-ai.service";
import { DmpAuthService } from "./dmp-auth.service";
import { DmpJobsService } from "./dmp-jobs.service";

class SaveDmpCredentialsDto {
  @IsString() @MinLength(1) @MaxLength(4000) requestUrl!: string;
  @IsString() @MinLength(1) @MaxLength(20000) cookieHeader!: string;
  @IsOptional() @IsString() @MaxLength(20000) gatewayCookieHeader?: string;
  @IsOptional() @IsString() @MaxLength(512) userAgent?: string;
}

class FetchDmpBatchDto {
  @IsString() @MinLength(8) @MaxLength(100) clientRunId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsString({ each: true }) productIds!: string[];
  @Type(() => Number) @IsInt() @Min(1) batchNumber!: number;
}

class CreateDmpCollectionTaskDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(2000) @IsString({ each: true }) productIds!: string[];
}

class DmpExtensionPairingDto {
  @IsString() @Matches(/^[0-9A-Fa-f]{12}$/) code!: string;
}

class DmpExtensionReportDto {
  @IsString() @IsIn(["VALID", "INVALID", "ERROR"]) status!: "VALID" | "INVALID" | "ERROR";
  @IsOptional() @IsString() @MaxLength(300) message?: string;
}

@Controller("dmp")
@Roles("ADMIN", "SUPER_ADMIN")
export class DmpController {
  constructor(private readonly auth: DmpAuthService, private readonly ai: DmpAiService, private readonly jobs: DmpJobsService) {}

  @Get("credentials") status(@Req() request: AuthenticatedRequest) { return this.auth.getStatus(request.user.id); }
  @Put("credentials") save(@Req() request: AuthenticatedRequest, @Body() body: SaveDmpCredentialsDto) { return this.auth.save(request.user.id, body); }
  @Delete("credentials") remove(@Req() request: AuthenticatedRequest) { return this.auth.remove(request.user.id); }
  @Post("credentials/test") test(@Req() request: AuthenticatedRequest) { return this.auth.test(request.user.id); }
  @Get("credits/balance") balance(@Req() request: AuthenticatedRequest) { return this.auth.getBalance(request.user.id); }

  @Get("tasks") listTasks() { return this.jobs.listTasks(); }
  @Post("tasks") createTask(@Req() request: AuthenticatedRequest, @Body() body: CreateDmpCollectionTaskDto) {
    return this.jobs.createTask(request.user.id, body.productIds);
  }
  @Get("tasks/:taskId") getTask(@Param("taskId") taskId: string) { return this.jobs.getTask(taskId); }
  @Post("tasks/:taskId/batches/:batchNumber/recover") recoverTaskBatch(@Param("taskId") taskId: string, @Param("batchNumber") batchNumber: string) {
    return this.jobs.recoverBatch(taskId, Number(batchNumber));
  }
  @Post("tasks/:taskId/batches/:batchNumber/retry") retryTaskBatch(@Param("taskId") taskId: string, @Param("batchNumber") batchNumber: string) {
    return this.jobs.retryBatch(taskId, Number(batchNumber));
  }

  @Post("extension/pairing") createExtensionPairing(@Req() request: AuthenticatedRequest) { return this.auth.createExtensionPairing(request.user.id); }
  @Post("extension/revoke") revokeExtension(@Req() request: AuthenticatedRequest) { return this.auth.revokeExtension(request.user.id); }

  @Public()
  @Post("extension/pair")
  pairExtension(@Req() request: AuthenticatedRequest, @Body() body: DmpExtensionPairingDto) { return this.auth.pairExtension(body.code, request.ip); }

  @Public()
  @Put("extension/credentials")
  syncExtensionCredentials(@Req() request: AuthenticatedRequest, @Headers("authorization") authorization: string | undefined, @Body() body: SaveDmpCredentialsDto) {
    return this.auth.saveExtensionCredentials(this.extensionToken(authorization), body, request.ip);
  }

  @Public()
  @Post("extension/report")
  reportExtensionState(@Req() request: AuthenticatedRequest, @Headers("authorization") authorization: string | undefined, @Body() body: DmpExtensionReportDto) {
    return this.auth.reportExtensionState(this.extensionToken(authorization), body.status, body.message, request.ip);
  }

  @Public()
  @Get("extension/heartbeat")
  extensionHeartbeat(@Req() request: AuthenticatedRequest, @Headers("authorization") authorization: string | undefined) {
    return this.auth.extensionHeartbeat(this.extensionToken(authorization), request.ip);
  }

  @Post("ai/fetch-batch") fetchBatch(@Req() request: AuthenticatedRequest, @Body() body: FetchDmpBatchDto) { return this.ai.fetchBatch(request.user.id, body); }
  @Get("ai/runs/:clientRunId") getRun(@Req() request: AuthenticatedRequest, @Param("clientRunId") clientRunId: string) { return this.ai.getRun(request.user.id, clientRunId); }
  @Post("ai/runs/:clientRunId/recover") recover(@Req() request: AuthenticatedRequest, @Param("clientRunId") clientRunId: string) { return this.ai.recoverRun(request.user.id, clientRunId); }

  private extensionToken(authorization?: string) {
    const match = /^Bearer\s+([A-Za-z0-9_-]{40,100})$/i.exec(authorization ?? "");
    return match?.[1] ?? "";
  }
}
