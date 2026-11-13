import { BadGatewayException, BadRequestException, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  DMP_PAGE_URL,
  decryptDmpCredentials,
  encryptDmpCredentials,
  buildDmpRequestUrl,
  createDmpExtensionPairingCode,
  createDmpExtensionToken,
  hashDmpExtensionSecret,
  isDmpLoginRedirect,
  normalizeDmpCredentialInput,
  parseDmpEncryptionKey,
  type DmpCredentialPayload,
} from "./dmp.helpers";

export interface DmpHttpResponse { status: number; contentType: string; text: string; redirected: boolean; location?: string }

@Injectable()
export class DmpAuthService {
  constructor(private readonly prisma: PrismaService) {}

  private key(): Buffer {
    try { return parseDmpEncryptionKey(); }
    catch (error) { throw new ServiceUnavailableException(error instanceof Error ? error.message : "服务端加密配置不可用。"); }
  }

  async getStatus(userId: string) {
    const [row, extension] = await Promise.all([
      this.prisma.dmpCredential.findUnique({ where: { userId }, select: { lastStatus: true, lastCheckedAt: true, lastError: true, updatedAt: true } }),
      this.prisma.dmpExtensionLink.findUnique({ where: { userId }, select: { extensionTokenHash: true, extensionTokenExpiresAt: true, lastSeenAt: true, lastSyncAt: true, lastStatus: true, lastError: true } }),
    ]);
    const now = new Date();
    const extensionPaired = Boolean(extension?.extensionTokenHash && extension.extensionTokenExpiresAt && extension.extensionTokenExpiresAt > now);
    return {
      configured: Boolean(row),
      encryptionReady: /^[0-9a-fA-F]{64}$/.test(process.env.DMP_CREDENTIAL_ENCRYPTION_KEY ?? ""),
      lastStatus: row?.lastStatus ?? "NOT_CONFIGURED",
      lastCheckedAt: row?.lastCheckedAt?.toISOString() ?? null,
      lastError: row?.lastError ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      extensionPaired,
      extensionStatus: extension?.extensionTokenHash && !extensionPaired ? "TOKEN_EXPIRED" : extension?.lastStatus ?? "NOT_PAIRED",
      extensionLastSeenAt: extension?.lastSeenAt?.toISOString() ?? null,
      extensionLastSyncAt: extension?.lastSyncAt?.toISOString() ?? null,
      extensionTokenExpiresAt: extension?.extensionTokenExpiresAt?.toISOString() ?? null,
      extensionLastError: extension?.lastError ?? null,
    };
  }

  async createExtensionPairing(userId: string) {
    const code = createDmpExtensionPairingCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await this.prisma.dmpExtensionLink.upsert({
      where: { userId },
      create: { userId, pairingCodeHash: hashDmpExtensionSecret(code), pairingExpiresAt: expiresAt, lastStatus: "PAIRING" },
      update: { pairingCodeHash: hashDmpExtensionSecret(code), pairingExpiresAt: expiresAt, lastStatus: "PAIRING", lastError: null },
    });
    return { code, expiresAt: expiresAt.toISOString(), expiresInSeconds: 300 };
  }

  async pairExtension(rawCode: string, rawIp?: string) {
    const code = String(rawCode ?? "").replace(/\s/g, "").toUpperCase();
    if (!/^[0-9A-F]{12}$/.test(code)) throw new UnauthorizedException("配对码无效或已过期，请在选品工具中重新生成。");
    const link = await this.prisma.dmpExtensionLink.findUnique({ where: { pairingCodeHash: hashDmpExtensionSecret(code) }, include: { user: true } });
    if (!link || !link.pairingExpiresAt || link.pairingExpiresAt <= new Date()) throw new UnauthorizedException("配对码无效或已过期，请在选品工具中重新生成。");
    if (link.user.role !== "ADMIN" && link.user.role !== "SUPER_ADMIN") throw new UnauthorizedException("只有管理员账号可以绑定达摩盘浏览器扩展。");
    if (link.user.accountStatus !== "ACTIVE" || link.user.employmentStatus !== "ACTIVE") throw new UnauthorizedException("当前员工账号已停用，不能绑定浏览器扩展。");
    const token = createDmpExtensionToken();
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    await this.prisma.dmpExtensionLink.update({
      where: { id: link.id },
      data: { pairingCodeHash: null, pairingExpiresAt: null, extensionTokenHash: hashDmpExtensionSecret(token), extensionTokenExpiresAt: expiresAt, lastSeenAt: new Date(), lastStatus: "WAITING_FOR_LOGIN", lastError: null },
    });
    return { token, expiresAt: expiresAt.toISOString(), userName: link.user.name };
  }

  async saveExtensionCredentials(token: string, input: DmpCredentialPayload, rawIp?: string) {
    const link = await this.findActiveExtensionLink(token, rawIp);
    await this.save(link.userId, input);
    const now = new Date();
    await Promise.all([
      this.prisma.dmpCredential.update({ where: { userId: link.userId }, data: { lastStatus: "VALID", lastCheckedAt: now, lastError: null } }),
      this.prisma.dmpExtensionLink.update({ where: { id: link.id }, data: { lastSeenAt: now, lastSyncAt: now, lastStatus: "VALID", lastError: null } }),
    ]);
    return { saved: true, status: "VALID", lastSyncAt: now.toISOString() };
  }

  async reportExtensionState(token: string, status: "VALID" | "INVALID" | "ERROR", errorMessage?: string, rawIp?: string) {
    const link = await this.findActiveExtensionLink(token, rawIp);
    const now = new Date();
    const safeError = String(errorMessage ?? "").replace(/[\r\n]/g, " ").slice(0, 300) || null;
    await this.prisma.dmpExtensionLink.update({ where: { id: link.id }, data: { lastSeenAt: now, lastStatus: status, lastError: status === "VALID" ? null : safeError } });
    if (status === "INVALID" || status === "VALID" || status === "ERROR") {
      await this.prisma.dmpCredential.updateMany({ where: { userId: link.userId }, data: { lastStatus: status, lastCheckedAt: now, lastError: status === "VALID" ? null : safeError } });
    }
    return { ok: true, status, updatedAt: now.toISOString() };
  }

  async extensionHeartbeat(token: string, rawIp?: string) {
    const link = await this.findActiveExtensionLink(token, rawIp);
    const now = new Date();
    await this.prisma.dmpExtensionLink.update({ where: { id: link.id }, data: { lastSeenAt: now } });
    const credential = await this.prisma.dmpCredential.findUnique({ where: { userId: link.userId }, select: { lastStatus: true, lastError: true, lastCheckedAt: true } });
    let extensionStatus = link.lastStatus;
    let extensionError = link.lastError ?? credential?.lastError ?? null;
    if (extensionStatus === "INVALID" && /浏览器没有读取到达摩盘登录 Cookie/.test(link.lastError ?? "")) {
      extensionStatus = "ERROR";
      extensionError = "旧版本扩展的 Cookies API 没有读取到 Cookie，这不代表达摩盘账号已退出。新版本会从实际请求头同步；请刷新达摩盘页面。";
      await Promise.all([
        this.prisma.dmpExtensionLink.update({ where: { id: link.id }, data: { lastStatus: "ERROR", lastError: extensionError } }),
        this.prisma.dmpCredential.updateMany({ where: { userId: link.userId }, data: { lastStatus: "ERROR", lastCheckedAt: now, lastError: extensionError } }),
      ]);
    }
    return {
      paired: true,
      credentialConfigured: Boolean(credential),
      lastStatus: extensionStatus === "INVALID" || extensionStatus === "ERROR" ? extensionStatus : credential?.lastStatus ?? extensionStatus,
      lastError: extensionError,
      lastCheckedAt: credential?.lastCheckedAt?.toISOString() ?? null,
      lastSyncAt: link.lastSyncAt?.toISOString() ?? null,
      tokenExpiresAt: link.extensionTokenExpiresAt?.toISOString() ?? null,
    };
  }

  async revokeExtension(userId: string) {
    await this.prisma.$transaction([
      this.prisma.dmpExtensionLink.updateMany({
        where: { userId },
        data: { pairingCodeHash: null, pairingExpiresAt: null, extensionTokenHash: null, extensionTokenExpiresAt: null, lastStatus: "NOT_PAIRED", lastError: null },
      }),
      this.prisma.dmpCredential.deleteMany({ where: { userId } }),
    ]);
    return { revoked: true };
  }

  private async findActiveExtensionLink(token: string, rawIp?: string) {
    if (!token || token.length > 256) throw new UnauthorizedException("浏览器扩展授权无效，请重新配对。");
    const link = await this.prisma.dmpExtensionLink.findUnique({ where: { extensionTokenHash: hashDmpExtensionSecret(token) }, include: { user: true } });
    if (!link || !link.extensionTokenExpiresAt || link.extensionTokenExpiresAt <= new Date()) throw new UnauthorizedException("浏览器扩展授权已过期，请重新配对。");
    if (link.user.role !== "ADMIN" && link.user.role !== "SUPER_ADMIN") throw new UnauthorizedException("当前绑定账号不具备管理员达摩盘授权权限。");
    if (link.user.accountStatus !== "ACTIVE" || link.user.employmentStatus !== "ACTIVE") throw new UnauthorizedException("当前员工账号已停用，浏览器扩展授权已失效。");
    return link;
  }

  async save(userId: string, input: DmpCredentialPayload) {
    const key = this.key();
    let normalized: DmpCredentialPayload;
    try { normalized = normalizeDmpCredentialInput(input); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : "达摩盘凭证格式不正确。"); }
    const encryptedPayload = encryptDmpCredentials(normalized, key);
    await this.prisma.dmpCredential.upsert({
      where: { userId },
      create: { userId, encryptedPayload, lastStatus: "NOT_TESTED" },
      update: { encryptedPayload, lastStatus: "NOT_TESTED", lastCheckedAt: null, lastError: null },
    });
    return this.getStatus(userId);
  }

  async remove(userId: string) {
    await this.prisma.dmpCredential.deleteMany({ where: { userId } });
    return { removed: true };
  }

  async getCredentials(userId: string): Promise<DmpCredentialPayload> {
    const row = await this.prisma.dmpCredential.findUnique({ where: { userId }, select: { encryptedPayload: true } });
    if (!row) throw new BadRequestException("尚未配置达摩盘授权，请先进入左侧「达摩盘授权」完成设置。");
    try { return decryptDmpCredentials(row.encryptedPayload, this.key()); }
    catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException(error instanceof Error ? error.message : "达摩盘凭证无法解密，请重新授权。");
    }
  }

  async request(
    credentials: DmpCredentialPayload,
    host: "dmp.taobao.com" | "dmp.advgateway.taobao.com",
    path: string,
    method: "GET" | "POST",
    body?: unknown,
    timeoutMs = 30000,
    accept = "application/json, text/javascript, */*; q=0.01",
  ): Promise<DmpHttpResponse> {
    const url = new URL(buildDmpRequestUrl(host, path, credentials));
    const headers: Record<string, string> = {
      accept,
      "x-requested-with": "XMLHttpRequest",
      origin: "https://dmp.taobao.com",
      referer: DMP_PAGE_URL,
      cookie: host === "dmp.advgateway.taobao.com" ? credentials.gatewayCookieHeader || credentials.cookieHeader : credentials.cookieHeader,
    };
    if (credentials.userAgent) headers["user-agent"] = credentials.userAgent;
    if (body !== undefined) headers["content-type"] = "application/json";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
        signal: controller.signal,
      });
      const text = await response.text();
      return {
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        text,
        redirected: response.status >= 300 && response.status < 400,
        location: response.headers.get("location") ?? undefined,
      };
    } catch {
      throw new DmpTransportError("达摩盘网络请求未收到完整响应。", method === "POST");
    } finally {
      clearTimeout(timer);
    }
  }

  async test(userId: string) {
    const credentials = await this.getCredentials(userId);
    try {
      const response = await this.request(credentials, "dmp.taobao.com", "/api_2/ai/assistant/model/list", "GET", undefined, 20000);
      const data = this.readJsonData(response, "达摩盘登录验证");
      if (!Array.isArray((data as { list?: unknown[] }).list)) throw new DmpApiError("达摩盘返回格式异常，未找到模型列表。", false, false);
      await this.prisma.dmpCredential.update({ where: { userId }, data: { lastStatus: "VALID", lastCheckedAt: new Date(), lastError: null } });
      return { ok: true, models: ((data as { list: Array<{ displayName?: string; model?: string }> }).list).map((item) => ({ name: item.displayName ?? item.model ?? "模型", model: item.model ?? "" })) };
    } catch (error) {
      const message = safeDmpError(error);
      const status = error instanceof DmpApiError && error.authFailure ? "INVALID" : "ERROR";
      if (status === "INVALID") await this.markInvalid(userId, message);
      else await this.prisma.dmpCredential.update({ where: { userId }, data: { lastStatus: status, lastCheckedAt: new Date(), lastError: message.slice(0, 300) } });
      throw new BadGatewayException(message);
    }
  }

  async getBalance(userId: string) {
    const credentials = await this.getCredentials(userId);
    try {
      const response = await this.request(credentials, "dmp.taobao.com", "/api_2/credits/balance-overview", "GET", undefined, 20000);
      const data = this.readJsonData(response, "读取 AI 豆余额") as { balance?: unknown; activeUser?: unknown; estimatedDays?: unknown };
      const balance = Number(data.balance);
      if (!Number.isFinite(balance) || typeof data.activeUser !== "boolean") throw new DmpApiError("达摩盘余额接口返回格式异常。", false, false);
      await this.prisma.dmpCredential.update({ where: { userId }, data: { lastStatus: "VALID", lastCheckedAt: new Date(), lastError: null } });
      return { balance, activeUser: data.activeUser, estimatedDays: Number.isFinite(Number(data.estimatedDays)) ? Number(data.estimatedDays) : null };
    } catch (error) {
      const message = safeDmpError(error);
      if (error instanceof DmpApiError && error.authFailure) await this.markInvalid(userId, message);
      else await this.prisma.dmpCredential.update({ where: { userId }, data: { lastStatus: "ERROR", lastCheckedAt: new Date(), lastError: message.slice(0, 300) } });
      throw new BadGatewayException(message);
    }
  }

  readJsonData(response: DmpHttpResponse, action: string): unknown {
    if (response.redirected) {
      const loginRedirect = isDmpLoginRedirect(response.location);
      throw new DmpApiError(
        loginRedirect ? `${action}跳转到了淘宝登录页面，达摩盘登录态可能已失效。` : `${action}返回了非登录重定向，可能是安全验证、网关跳转或服务器出口 IP 限制；不能据此判断 Cookie 已过期。`,
        loginRedirect,
        false,
      );
    }
    if (response.status === 401) throw new DmpApiError(`${action}失败：达摩盘返回 HTTP 401，登录态可能失效，请在浏览器确认登录状态。`, true, false);
    if (response.status === 403) throw new DmpApiError(`${action}失败：达摩盘返回 HTTP 403，可能是账号权限、安全风控或服务器出口 IP 限制；不能仅凭403判断登录态失效。`, false, false);
    if (response.status < 200 || response.status >= 300) throw new DmpApiError(`${action}失败：达摩盘返回 HTTP ${response.status}。`, false, response.status >= 500);
    let parsed: { data?: unknown; info?: { ok?: boolean; message?: string } };
    try { parsed = JSON.parse(response.text) as typeof parsed; }
    catch { throw new DmpApiError(`${action}失败：返回内容不是有效 JSON。`, false, false); }
    if (parsed.info?.ok === false) {
      const upstreamMessage = String(parsed.info.message ?? "");
      const authFailure = /登录|未登录|过期|未授权|身份验证|token/i.test(upstreamMessage);
      throw new DmpApiError(authFailure ? `${action}失败：达摩盘登录态已失效，请在浏览器重新登录，扩展会自动更新 Cookie。` : `${action}失败：达摩盘接口返回业务错误，请检查账号权限或请求参数。`, authFailure, false);
    }
    return parsed.data ?? {};
  }

  async markInvalid(userId: string, error: string) {
    await Promise.all([
      this.prisma.dmpCredential.updateMany({ where: { userId }, data: { lastStatus: "INVALID", lastCheckedAt: new Date(), lastError: error.slice(0, 300) } }),
      this.prisma.dmpExtensionLink.updateMany({ where: { userId }, data: { lastStatus: "INVALID", lastError: error.slice(0, 300) } }),
    ]);
  }
}

export class DmpApiError extends Error {
  constructor(message: string, readonly authFailure: boolean, readonly uncertain: boolean) { super(message); }
}

export class DmpTransportError extends Error {
  constructor(message: string, readonly uncertain: boolean) { super(message); }
}

export function safeDmpError(error: unknown): string {
  if (error instanceof DmpApiError || error instanceof DmpTransportError) return error.message;
  if (error instanceof Error && error.message.includes("DMP_CREDENTIAL_ENCRYPTION_KEY")) return error.message;
  return "达摩盘请求失败，请检查授权凭证、服务器网络和达摩盘账号状态。";
}
