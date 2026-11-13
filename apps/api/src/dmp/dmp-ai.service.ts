import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { parseAiMetricsMarkdown } from "../products/ai-metrics-parser";
import {
  buildDmpAiTalkPayload,
  DMP_SKILL_LABEL,
  extractDmpAssistantMarkdown,
  isDmpLoginRedirect,
  parseDmpAssistantSse,
} from "./dmp.helpers";
import { DmpApiError, DmpAuthService, safeDmpError } from "./dmp-auth.service";

interface FetchBatchInput { clientRunId: string; productIds: string[]; batchNumber: number }

@Injectable()
export class DmpAiService {
  constructor(private readonly prisma: PrismaService, private readonly auth: DmpAuthService) {}

  async fetchBatch(userId: string, input: FetchBatchInput) {
    const productIds = this.validateInput(input);
    const existing = await this.prisma.dmpAiRun.findUnique({ where: { userId_clientRunId: { userId, clientRunId: input.clientRunId } } });
    if (existing) {
      if (JSON.stringify(JSON.parse(existing.productIdsJson)) !== JSON.stringify(productIds)) throw new BadRequestException("客户端任务ID已被另一批商品使用，请重新发起。");
      if (existing.status === "COMPLETED" || existing.status === "NEEDS_REVIEW") return this.mapRun(existing);
      if (existing.sessionId && existing.status === "UNCERTAIN") return this.recoverRun(userId, input.clientRunId);
      return this.mapRun(existing);
    }

    const credentials = await this.auth.getCredentials(userId);
    const run = await this.prisma.dmpAiRun.create({
      data: { userId, clientRunId: input.clientRunId, batchNumber: input.batchNumber, productIdsJson: JSON.stringify(productIds), status: "CREATED" },
    });
    let sessionId = "";
    try {
      const response = await this.auth.request(credentials, "dmp.taobao.com", "/api_2/ai/assistant/session/create", "POST", { sessionName: `${DMP_SKILL_LABEL} · 第${input.batchNumber}批` }, 30000);
      const data = this.auth.readJsonData(response, "创建 AI 管家会话") as { result?: { sessionId?: string }; sessionId?: string };
      sessionId = data.result?.sessionId ?? data.sessionId ?? "";
      if (!sessionId) throw new DmpApiError("达摩盘创建会话成功响应中没有 sessionId。", false, true);
      await this.prisma.dmpAiRun.update({ where: { id: run.id }, data: { sessionId, status: "TALKING", errorMessage: null } });
    } catch (error) {
      const message = safeDmpError(error);
      await this.prisma.dmpAiRun.update({ where: { id: run.id }, data: { status: "CREATE_UNCERTAIN", errorMessage: message.slice(0, 500) } });
      if (error instanceof DmpApiError && error.authFailure) await this.auth.markInvalid(userId, message);
      return this.getRun(userId, input.clientRunId);
    }

    let markdown = "";
    let payloadCount = 0;
    try {
      const body = buildDmpAiTalkPayload(sessionId, productIds);
      const response = await this.auth.request(credentials, "dmp.advgateway.taobao.com", "/api/agent/dmp/assistant/talk", "POST", body, 600000, "text/event-stream");
      if (response.redirected || response.status === 401 || response.status === 403) {
        const confirmedLoginFailure = response.status === 401 || (response.redirected && isDmpLoginRedirect(response.location));
        const message = confirmedLoginFailure
          ? "AI 管家请求被拒绝或跳转到淘宝登录页，达摩盘登录态可能失效。请确认授权；本批不会自动重发。"
          : `AI 管家请求返回 HTTP ${response.status} 或非登录重定向，可能是账号权限、安全验证或服务器出口 IP 限制；不能据此判断登录态失效。本批不会自动重发。`;
        await this.prisma.dmpAiRun.update({ where: { id: run.id }, data: { status: "FAILED", errorMessage: message } });
        if (confirmedLoginFailure) await this.auth.markInvalid(userId, message);
        return this.getRun(userId, input.clientRunId);
      }
      if (response.status >= 500 || response.status < 200 || response.status >= 300) {
        const message = `AI 管家请求返回 HTTP ${response.status}，服务端是否已受理无法确认；本批不会自动重发。`;
        await this.prisma.dmpAiRun.update({ where: { id: run.id }, data: { status: "UNCERTAIN", errorMessage: message } });
        return this.getRun(userId, input.clientRunId);
      }
      const parsed = parseDmpAssistantSse(response.text);
      markdown = parsed.markdown;
      payloadCount = parsed.payloadCount;
    } catch (error) {
      const message = safeDmpError(error);
      await this.prisma.dmpAiRun.update({ where: { id: run.id }, data: { status: "UNCERTAIN", errorMessage: `${message} AI 对话是否已受理无法确认；本批不会自动重发。`.slice(0, 500) } });
      return this.getRun(userId, input.clientRunId);
    }

    const parsedFromStream = markdown ? parseAiMetricsMarkdown(markdown, productIds) : null;
    if (!markdown || !parsedFromStream || parsedFromStream.errors.length || parsedFromStream.missingProductIds.length) {
      try {
        const history = await this.readSessionHistory(credentials, sessionId);
        const historyMarkdown = extractDmpAssistantMarkdown(history);
        if (historyMarkdown) {
          const historyParsed = parseAiMetricsMarkdown(historyMarkdown, productIds);
          if (!markdown || historyParsed.rows.length > (parsedFromStream?.rows.length ?? 0) || (historyParsed.errors.length < (parsedFromStream?.errors.length ?? Number.MAX_SAFE_INTEGER))) {
            markdown = historyMarkdown;
          }
        }
      } catch (error) {
        if (error instanceof DmpApiError && error.authFailure) await this.auth.markInvalid(userId, error.message);
        // 只读历史恢复失败时保留 SSE 原文，不重发可能收费的 talk POST。
      }
    }
    if (!markdown) {
      await this.prisma.dmpAiRun.update({ where: { id: run.id }, data: { status: "UNCERTAIN", errorMessage: `SSE 未取得可读取的 Markdown 正文（数据帧 ${payloadCount} 个）；请稍后读取会话历史，不要重新获取。` } });
      return this.getRun(userId, input.clientRunId);
    }
    return this.saveMarkdown(userId, input.clientRunId, markdown, payloadCount);
  }

  async getRun(userId: string, clientRunId: string) {
    const run = await this.prisma.dmpAiRun.findUnique({ where: { userId_clientRunId: { userId, clientRunId } } });
    if (!run) throw new NotFoundException("没有找到该批 AI 任务。");
    return this.mapRun(run);
  }

  async recoverRun(userId: string, clientRunId: string) {
    const run = await this.prisma.dmpAiRun.findUnique({ where: { userId_clientRunId: { userId, clientRunId } } });
    if (!run) throw new NotFoundException("没有找到该批 AI 任务。");
    if (run.markdown) return this.mapRun(run);
    if (!run.sessionId) return this.mapRun(run);
    const credentials = await this.auth.getCredentials(userId);
    try {
      const history = await this.readSessionHistory(credentials, run.sessionId);
      const markdown = extractDmpAssistantMarkdown(history);
      if (!markdown) return this.mapRun(run);
      return this.saveMarkdown(userId, clientRunId, markdown, 0);
    } catch (error) {
      if (error instanceof DmpApiError && error.authFailure) await this.auth.markInvalid(userId, error.message);
      return this.mapRun(run);
    }
  }

  private async readSessionHistory(credentials: Awaited<ReturnType<DmpAuthService["getCredentials"]>>, sessionId: string) {
    const path = `/api_2/ai/assistant/session/messages?sessionId=${encodeURIComponent(sessionId)}`;
    const response = await this.auth.request(credentials, "dmp.taobao.com", path, "GET", undefined, 30000);
    return this.auth.readJsonData(response, "读取 AI 管家会话历史");
  }

  private async saveMarkdown(userId: string, clientRunId: string, markdown: string, payloadCount: number) {
    const run = await this.prisma.dmpAiRun.findUniqueOrThrow({ where: { userId_clientRunId: { userId, clientRunId } } });
    if (/AI豆余额不足|余额不足/.test(markdown)) {
      await this.prisma.dmpAiRun.update({ where: { id: run.id }, data: { status: "FAILED", markdown, errorMessage: "AI 管家 AI 豆余额不足，请充值后再发起新的批次。" } });
      return this.getRun(userId, clientRunId);
    }
    const productIds = JSON.parse(run.productIdsJson) as string[];
    const parsed = parseAiMetricsMarkdown(markdown, productIds);
    const status = parsed.errors.length ? "NEEDS_REVIEW" : "COMPLETED";
    await this.prisma.dmpAiRun.update({ where: { id: run.id }, data: { status, markdown, errorMessage: parsed.errors.length ? parsed.errors.join("；").slice(0, 500) : null } });
    return { ...(await this.getRun(userId, clientRunId)), missingProductIds: parsed.missingProductIds, parseErrors: parsed.errors, payloadCount };
  }

  private validateInput(input: FetchBatchInput): string[] {
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(String(input.clientRunId ?? ""))) throw new BadRequestException("客户端任务ID格式不正确。");
    if (!Number.isInteger(input.batchNumber) || input.batchNumber < 1) throw new BadRequestException("批次序号必须为正整数。");
    if (!Array.isArray(input.productIds) || input.productIds.length < 1 || input.productIds.length > 50) throw new BadRequestException("每批必须包含1～50个商品ID。");
    const ids = input.productIds.map((id) => String(id).trim());
    if (ids.some((id) => !/^\d{6,20}$/.test(id))) throw new BadRequestException("商品ID必须为6～20位数字。");
    if (new Set(ids).size !== ids.length) throw new BadRequestException("同一批次不能包含重复商品ID。");
    return ids;
  }

  private mapRun(run: { id: string; clientRunId: string; batchNumber: number; productIdsJson: string; sessionId: string | null; status: string; markdown: string | null; errorMessage: string | null; updatedAt: Date }) {
    return {
      runId: run.id,
      clientRunId: run.clientRunId,
      batchNumber: run.batchNumber,
      productIds: JSON.parse(run.productIdsJson) as string[],
      sessionId: run.sessionId,
      status: run.status,
      markdown: run.markdown,
      errorMessage: run.errorMessage,
      updatedAt: run.updatedAt.toISOString(),
    };
  }
}
