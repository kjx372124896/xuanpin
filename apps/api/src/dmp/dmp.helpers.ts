import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const DMP_SKILL_ID = "1546";
export const DMP_SKILL_NAME = "MsU_6259609296_competitor_core_metrics_comparison";
export const DMP_SKILL_LABEL = "竞品核心指标环比分析";
export const DMP_PAGE_URL = "https://dmp.taobao.com/index_new.html";

export function isDmpLoginRedirect(location?: string): boolean {
  if (!location) return false;
  try {
    const target = new URL(location, DMP_PAGE_URL);
    const host = target.hostname.toLowerCase();
    return /(^|\.)login\.taobao\.com$|(^|\.)login\.tmall\.com$|(^|\.)passport\.taobao\.com$|(^|\.)passport\.tmall\.com$/.test(host)
      || /\/(member\/login|passport\/login|login\/login|login\.htm)(\/|$)/i.test(target.pathname);
  } catch {
    return false;
  }
}

export function hashDmpExtensionSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function createDmpExtensionPairingCode(): string {
  return randomBytes(6).toString("hex").toUpperCase();
}

export function createDmpExtensionToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface DmpCredentialPayload {
  requestUrl: string;
  cookieHeader: string;
  gatewayCookieHeader?: string;
  userAgent?: string;
}

export function normalizeDmpCredentialInput(input: DmpCredentialPayload): DmpCredentialPayload {
  const requestUrl = String(input.requestUrl ?? "").trim();
  let parsed: URL;
  try { parsed = new URL(requestUrl); } catch { throw new Error("请粘贴完整的达摩盘 model/list Request URL。"); }
  if (parsed.protocol !== "https:" || parsed.hostname !== "dmp.taobao.com" || parsed.pathname !== "/api_2/ai/assistant/model/list") {
    throw new Error("Request URL 必须来自 https://dmp.taobao.com 的 /api_2/ai/assistant/model/list 请求。");
  }
  if (!parsed.searchParams.get("_tb_token_")) throw new Error("Request URL 缺少 _tb_token_，请复制完整 Request URL。");
  if (!parsed.searchParams.get("_csrf") && !parsed.searchParams.get("csrfId")) throw new Error("Request URL 缺少 CSRF 参数，请复制完整 Request URL。");

  const rawCookie = String(input.cookieHeader ?? "").trim();
  if (!rawCookie || /[\r\n]/.test(rawCookie)) throw new Error("请粘贴完整的 Cookie 请求头，且不要包含换行。");
  const cookieHeader = rawCookie.replace(/^cookie\s*:\s*/i, "").trim();
  if (!/^[^=;\s]+=/.test(cookieHeader) || cookieHeader.length > 20000) throw new Error("Cookie 格式不正确或长度超过限制。");
  const rawGatewayCookie = String(input.gatewayCookieHeader ?? "").trim();
  if (/[\r\n]/.test(rawGatewayCookie) || rawGatewayCookie.length > 20000) throw new Error("达摩盘 AI 网关 Cookie 格式不正确或长度超过限制。");
  const gatewayCookieHeader = rawGatewayCookie.replace(/^cookie\s*:\s*/i, "").trim();
  if (gatewayCookieHeader && !/^[^=;\s]+=/.test(gatewayCookieHeader)) throw new Error("达摩盘 AI 网关 Cookie 格式不正确。");
  const userAgent = String(input.userAgent ?? "").trim();
  if (/[\r\n]/.test(userAgent) || userAgent.length > 512) throw new Error("User-Agent 格式不正确。");
  return { requestUrl: parsed.toString(), cookieHeader, ...(gatewayCookieHeader ? { gatewayCookieHeader } : {}), ...(userAgent ? { userAgent } : {}) };
}

export function parseDmpEncryptionKey(raw = process.env.DMP_CREDENTIAL_ENCRYPTION_KEY ?? ""): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) throw new Error("服务端未正确配置 DMP_CREDENTIAL_ENCRYPTION_KEY（需要64位十六进制字符）。");
  return Buffer.from(raw, "hex");
}

export function encryptDmpCredentials(payload: DmpCredentialPayload, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: ciphertext.toString("base64") });
}

export function decryptDmpCredentials(envelopeText: string, key: Buffer): DmpCredentialPayload {
  try {
    const envelope = JSON.parse(envelopeText) as { v?: number; iv?: string; tag?: string; data?: string };
    if (envelope.v !== 1 || !envelope.iv || !envelope.tag || !envelope.data) throw new Error("invalid envelope");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8");
    return JSON.parse(plaintext) as DmpCredentialPayload;
  } catch {
    throw new Error("达摩盘凭证无法解密，请检查服务端加密密钥是否与保存时一致，必要时重新授权。");
  }
}

export function buildDmpRequestUrl(host: "dmp.taobao.com" | "dmp.advgateway.taobao.com", path: string, credentials: DmpCredentialPayload): string {
  const url = new URL(path, `https://${host}`);
  const authUrl = new URL(credentials.requestUrl);
  const bizCode = authUrl.searchParams.get("bizCode") || "dmp";
  const token = authUrl.searchParams.get("_tb_token_") || "";
  const csrf = authUrl.searchParams.get("_csrf") || authUrl.searchParams.get("csrfId") || "";
  const csrfId = authUrl.searchParams.get("csrfId") || csrf;
  url.searchParams.set("bizCode", bizCode);
  if (token) url.searchParams.set("_tb_token_", token);
  if (csrf) url.searchParams.set("_csrf", csrf);
  if (csrfId) url.searchParams.set("csrfId", csrfId);
  return url.toString();
}

export function buildDmpAiTalkPayload(sessionId: string, productIds: string[]) {
  const text = `帮我分析这几个竞品最近30天的核心指标：${productIds.join(",")}`;
  return {
    sessionId,
    query: {
      type: "wordList",
      content: `${DMP_SKILL_NAME} ${text}`,
      wordList: [
        { wordType: "subject", params: { skillName: DMP_SKILL_NAME, skillId: DMP_SKILL_ID }, word: DMP_SKILL_NAME, subjectType: "singleSkillPicker" },
        { wordType: "text", word: text, subjectType: null },
      ],
    },
    model: "standard",
  };
}

function mergeMarkdown(current: string, next: string): string {
  if (!current) return next;
  if (!next) return current;
  if (next.includes(current)) return next;
  if (current.includes(next) || current.endsWith(next)) return current;
  const max = Math.min(current.length, next.length);
  for (let overlap = max; overlap > 0; overlap--) {
    if (current.slice(-overlap) === next.slice(0, overlap)) return current + next.slice(overlap);
  }
  return current + next;
}

function collectMarkdown(value: unknown, output: string[], depth = 0): void {
  if (depth > 24 || value === null || value === undefined) return;
  if (Array.isArray(value)) { for (const item of value) collectMarkdown(item, output, depth + 1); return; }
  if (typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  if (object.renderCode === "markdown" && typeof object.content === "string") {
    output.push(object.content);
    return;
  }
  if (Array.isArray(object.contentList)) collectMarkdown(object.contentList, output, depth + 1);
  for (const [key, child] of Object.entries(object)) {
    if (key === "contentList" || key === "content") continue;
    collectMarkdown(child, output, depth + 1);
  }
  if (typeof object.content === "string" && object.renderCode !== "think") output.push(object.content);
}

export function parseDmpAssistantSse(text: string): { markdown: string; payloadCount: number } {
  const lines = text.replace(/\r/g, "").split("\n");
  const dataLines: string[] = [];
  const chunks: string[] = [];
  let payloadCount = 0;
  const flush = () => {
    if (!dataLines.length) return;
    const raw = dataLines.join("\n").trim();
    dataLines.length = 0;
    if (!raw || raw === "[DONE]") return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      payloadCount++;
      const found: string[] = [];
      collectMarkdown(parsed, found);
      if (found.length) chunks.push(found.join("\n\n"));
      else if (typeof parsed === "string") chunks.push(parsed);
    } catch {
      chunks.push(raw);
    }
  };
  for (const line of lines) {
    if (!line.trim()) { flush(); continue; }
    if (line.startsWith(":")) continue;
    if (line.startsWith("data:")) { dataLines.push(line.slice(5).replace(/^ /, "")); continue; }
    if (/^(event|id|retry):/.test(line)) continue;
    if (dataLines.length) dataLines[dataLines.length - 1] += `\n${line}`;
  }
  flush();
  if (!chunks.length && text.trim() && !/^\s*:\s*(?:keep-alive|ping)/i.test(text)) {
    try {
      const parsed = JSON.parse(text) as unknown;
      payloadCount++;
      collectMarkdown(parsed, chunks);
    } catch { chunks.push(text.trim()); }
  }
  return { markdown: chunks.reduce(mergeMarkdown, "").trim(), payloadCount };
}

export function extractDmpAssistantMarkdown(history: unknown): string {
  const messageLists: unknown[][] = [];
  const visit = (node: unknown, depth = 0) => {
    if (depth > 24 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const child of node) visit(child, depth + 1); return; }
    const object = node as Record<string, unknown>;
    if (Array.isArray(object.messageList)) messageLists.push(object.messageList);
    for (const child of Object.values(object)) visit(child, depth + 1);
  };
  visit(history);
  for (const list of messageLists.reverse()) {
    const latest = [...list].reverse().find((item) => item && typeof item === "object") as Record<string, unknown> | undefined;
    if (!latest) continue;
    if (latest.role === "user") return "";
    if (latest.role === "assistant") {
      const parts: string[] = [];
      collectMarkdown(latest, parts);
      return parts.join("\n\n").trim();
    }
  }
  const fallback: string[] = [];
  collectMarkdown(history, fallback);
  return fallback.join("\n\n").trim();
}
