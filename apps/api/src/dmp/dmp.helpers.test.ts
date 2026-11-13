import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDmpAiTalkPayload,
  buildDmpRequestUrl,
  createDmpExtensionPairingCode,
  createDmpExtensionToken,
  decryptDmpCredentials,
  encryptDmpCredentials,
  extractDmpAssistantMarkdown,
  hashDmpExtensionSecret,
  isDmpLoginRedirect,
  normalizeDmpCredentialInput,
  parseDmpAssistantSse,
} from "./dmp.helpers";

test("浏览器扩展配对码和令牌具备足够随机性，数据库只保存哈希", () => {
  const code = createDmpExtensionPairingCode();
  const token = createDmpExtensionToken();
  assert.match(code, /^[0-9A-F]{12}$/);
  assert.match(token, /^[A-Za-z0-9_-]{40,50}$/);
  assert.equal(hashDmpExtensionSecret(token).length, 64);
  assert.notEqual(hashDmpExtensionSecret(token), token);
});

test("只有明确跳转到淘宝登录域名或登录路径才判定为登录失效", () => {
  assert.equal(isDmpLoginRedirect("https://login.taobao.com/member/login.jhtml"), true);
  assert.equal(isDmpLoginRedirect("https://passport.tmall.com/passport/login"), true);
  assert.equal(isDmpLoginRedirect("https://sec.taobao.com/query?next=login"), false);
  assert.equal(isDmpLoginRedirect("https://dmp.taobao.com/api/agent/redirect"), false);
  assert.equal(isDmpLoginRedirect(undefined), false);
});

const requestUrl = "https://dmp.taobao.com/api_2/ai/assistant/model/list?bizCode=dmp&_tb_token_=token-value&_csrf=csrf-value&csrfId=csrf-id";
const credentials = { requestUrl, cookieHeader: "cookie_a=value-a; cookie_b=value-b", gatewayCookieHeader: "gateway_cookie=gateway-value" };

test("达摩盘凭证输入仅接受已验证的 model/list URL 并规范 Cookie 头", () => {
  const value = normalizeDmpCredentialInput({ requestUrl, cookieHeader: "Cookie: cookie_a=value-a; cookie_b=value-b", gatewayCookieHeader: "gateway_cookie=gateway-value" });
  assert.equal(value.cookieHeader, credentials.cookieHeader);
  assert.equal(value.gatewayCookieHeader, "gateway_cookie=gateway-value");
  assert.throws(() => normalizeDmpCredentialInput({ requestUrl: "https://example.com/model/list", cookieHeader: "a=b" }));
  assert.throws(() => normalizeDmpCredentialInput({ requestUrl, cookieHeader: "a=b\r\nX-Injected: yes" }));
});

test("AES-256-GCM 凭证加密可往返且密文不包含 Cookie 明文", () => {
  const key = Buffer.alloc(32, 7);
  const encrypted = encryptDmpCredentials(credentials, key);
  assert.equal(encrypted.includes("value-a"), false);
  assert.equal(encrypted.includes("gateway-value"), false);
  assert.deepEqual(decryptDmpCredentials(encrypted, key), credentials);
  assert.throws(() => decryptDmpCredentials(encrypted, Buffer.alloc(32, 8)));
});

test("达摩盘跨子域请求复用已验证的认证查询参数", () => {
  const url = new URL(buildDmpRequestUrl("dmp.advgateway.taobao.com", "/api/agent/dmp/assistant/talk", credentials));
  assert.equal(url.hostname, "dmp.advgateway.taobao.com");
  assert.equal(url.searchParams.get("_tb_token_"), "token-value");
  assert.equal(url.searchParams.get("_csrf"), "csrf-value");
  assert.equal(url.searchParams.get("csrfId"), "csrf-id");
  assert.equal(url.searchParams.get("bizCode"), "dmp");
});

test("AI 管家请求使用已抓包验证的单技能选择器和50个以内商品ID文本", () => {
  const body = buildDmpAiTalkPayload("session-1", ["1081234567890", "1081234567891"]);
  assert.equal(body.query.wordList[0].wordType, "subject");
  assert.equal(body.query.wordList[0].subjectType, "singleSkillPicker");
  assert.equal(body.query.wordList[0].params.skillId, "1546");
  assert.equal(body.query.wordList[0].params.skillName, "MsU_6259609296_competitor_core_metrics_comparison");
  assert.match(body.query.wordList[1].word, /1081234567890,1081234567891/);
  assert.equal(body.model, "standard");
});

test("SSE 多帧 Markdown 被合并，支持最终会话历史只取最新 assistant", () => {
  const markdown = "| 品ID | 销售额 |\n|---|---|\n| 1081234567890 | 5万-6万 |";
  const sse = [
    `data: ${JSON.stringify({ renderCode: "markdown", content: markdown.slice(0, 26) })}`,
    "",
    `data: ${JSON.stringify({ renderCode: "markdown", content: markdown.slice(26) })}`,
    "",
    "data: [DONE]",
    "",
  ].join("\n");
  const parsed = parseDmpAssistantSse(sse);
  assert.equal(parsed.payloadCount, 2);
  assert.equal(parsed.markdown, markdown);
  const history = { data: { result: { messageList: [
    { role: "assistant", talkData: { contentList: [{ renderCode: "markdown", content: "旧回复" }] } },
    { role: "user", wordList: [{ wordType: "text", word: "新问题" }] },
  ] } } };
  assert.equal(extractDmpAssistantMarkdown(history), "");
  history.data.result.messageList.push({ role: "assistant", talkData: { contentList: [{ renderCode: "markdown", content: markdown }] } });
  assert.equal(extractDmpAssistantMarkdown(history), markdown);
});
