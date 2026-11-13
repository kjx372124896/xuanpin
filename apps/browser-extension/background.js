const DMP_PAGE_URL = "https://dmp.taobao.com/index_new.html";
const MODEL_LIST_FILTER = { urls: ["https://dmp.taobao.com/api_2/ai/assistant/model/list*"] };
const HEARTBEAT_ALARM = "selection-tool-dmp-heartbeat";

// Cookie headers stay in memory only for the lifetime of a matching request.
// They are never written to chrome.storage or logged.
const requestContexts = new Map();
let syncQueue = Promise.resolve();

async function readConfig() {
  return chrome.storage.local.get(["apiBaseUrl", "extensionToken", "userName", "lastStatus", "lastSyncAt", "lastError"]);
}

async function apiRequest(path, method = "GET", body) {
  const config = await readConfig();
  if (!config.apiBaseUrl || !config.extensionToken) throw new Error("扩展尚未绑定选品工具。");
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${config.extensionToken}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = Array.isArray(data.message) ? data.message.join("；") : data.message;
    throw new Error(message || `选品工具 API 返回 HTTP ${response.status}`);
  }
  return data;
}

async function setBadge(status) {
  const settings = {
    VALID: { text: "OK", color: "#15803d" },
    INVALID: { text: "!", color: "#dc2626" },
    ERROR: { text: "…", color: "#d97706" },
    WAITING_FOR_LOGIN: { text: "…", color: "#d97706" },
    NOT_PAIRED: { text: "", color: "#64748b" },
  };
  const value = settings[status] || settings.ERROR;
  await chrome.action.setBadgeText({ text: value.text });
  await chrome.action.setBadgeBackgroundColor({ color: value.color });
}

async function notify(id, title, message) {
  await chrome.notifications.create(id, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message,
    priority: 2,
  });
}

async function reportState(status, message) {
  try {
    await apiRequest("/api/dmp/extension/report", "POST", { status, message });
  } catch {
    // Network failures must not be described as an expired DMP login.
  }
  await chrome.storage.local.set({ lastStatus: status, lastError: status === "VALID" ? null : message || null });
  await setBadge(status);
}

async function markLoginInvalid(message) {
  await reportState("INVALID", message);
  await notify("dmp-login-invalid", "检测到达摩盘登录跳转", "请求被明确重定向到淘宝登录页。请确认登录状态；重新登录后刷新达摩盘页面即可自动同步。");
}

function getHeader(headers, name) {
  const values = (headers || [])
    .filter((header) => String(header.name || "").toLowerCase() === name.toLowerCase())
    .map((header) => String(header.value || "").trim())
    .filter(Boolean);
  return values.join("; ");
}

async function readBrowserCookies() {
  if (typeof chrome.cookies?.getAll !== "function") return { cookieHeader: "", gatewayCookieHeader: "" };
  const [pageResult, gatewayResult] = await Promise.allSettled([
    Promise.resolve().then(() => chrome.cookies.getAll({ url: DMP_PAGE_URL })),
    Promise.resolve().then(() => chrome.cookies.getAll({ url: "https://dmp.advgateway.taobao.com/" })),
  ]);
  const pageCookies = pageResult.status === "fulfilled" ? pageResult.value : [];
  const gatewayCookies = gatewayResult.status === "fulfilled" ? gatewayResult.value : [];
  return {
    cookieHeader: pageCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
    gatewayCookieHeader: gatewayCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
  };
}

async function syncOneRequest({ requestUrl, requestCookieHeader, responseStatus, contentType, requestAt }) {
  const config = await readConfig();
  if (!config.extensionToken || !config.apiBaseUrl) {
    await setBadge("NOT_PAIRED");
    return;
  }

  const parsed = new URL(requestUrl);
  if (parsed.origin !== "https://dmp.taobao.com" || parsed.pathname !== "/api_2/ai/assistant/model/list") return;

  let cookieHeader = String(requestCookieHeader || "").trim();
  const cookieSource = cookieHeader ? "request-header" : "cookies-api";
  const browserCookies = await readBrowserCookies();
  if (!cookieHeader) cookieHeader = browserCookies.cookieHeader;

  if (!cookieHeader) {
    const message = "未能从达摩盘实际请求头或浏览器 Cookie API 读取到登录 Cookie。请确认扩展权限已启用，并刷新达摩盘页面；这不代表账号已退出。";
    await chrome.storage.local.set({
      lastRequestAt: new Date(requestAt).toISOString(),
      lastRequestStatus: responseStatus,
      lastCookieSource: "unavailable",
    });
    await reportState("ERROR", message);
    return;
  }

  await chrome.storage.local.set({
    lastRequestAt: new Date(requestAt).toISOString(),
    lastRequestStatus: responseStatus,
    lastCookieSource: cookieSource,
  });

  try {
    const saved = await apiRequest("/api/dmp/extension/credentials", "PUT", {
      requestUrl: parsed.toString(),
      cookieHeader,
      ...(browserCookies.gatewayCookieHeader ? { gatewayCookieHeader: browserCookies.gatewayCookieHeader } : {}),
      userAgent: navigator.userAgent,
    });
    const wasInvalid = config.lastStatus === "INVALID";
    const htmlResponse = String(contentType || "").toLowerCase().includes("text/html");
    const rejectedResponse = responseStatus === 401 || responseStatus === 403;
    const lastSyncAt = saved.lastSyncAt || new Date().toISOString();

    await chrome.storage.local.set({
      lastSyncAt,
    });

    if (rejectedResponse || htmlResponse) {
      const message = rejectedResponse
        ? `最新浏览器 Cookie 已同步，但达摩盘 model/list 返回 HTTP ${responseStatus}。这可能是接口权限或安全风控，不等同于登录失效。`
        : "最新浏览器 Cookie 已同步，但 model/list 返回了 HTML 页面，可能是安全验证或页面异常；不能仅凭此判断登录失效。";
      await reportState("ERROR", message);
      await notify("dmp-request-warning", "达摩盘请求需要检查", "最新登录凭证已同步，但模型列表请求被拒绝或返回验证页面。请查看扩展状态详情，不要反复退出登录。");
      return;
    }

    await reportState("VALID", null);
    if (wasInvalid) await notify("dmp-login-restored", "达摩盘登录凭证已更新", "已从浏览器实际请求中同步登录凭证，可以继续测试选品工具连接。");
  } catch (error) {
    const message = error instanceof Error ? error.message : "授权同步失败。";
    await reportState("ERROR", message.slice(0, 180));
    await notify("dmp-sync-error", "达摩盘授权同步失败", "请打开扩展查看状态；不要手动复制 Cookie。");
  }
}

function rememberRequestHeaders(details) {
  if (details.method === "OPTIONS") return;
  requestContexts.set(details.requestId, {
    cookieHeader: getHeader(details.requestHeaders, "cookie"),
    startedAt: Date.now(),
  });
  while (requestContexts.size > 200) requestContexts.delete(requestContexts.keys().next().value);
}

try {
  chrome.webRequest.onBeforeSendHeaders.addListener(rememberRequestHeaders, MODEL_LIST_FILTER, ["requestHeaders", "extraHeaders"]);
} catch {
  // Older Chromium/EGO builds may not expose restricted headers through extraHeaders.
  chrome.webRequest.onBeforeSendHeaders.addListener(rememberRequestHeaders, MODEL_LIST_FILTER, ["requestHeaders"]);
}

chrome.webRequest.onCompleted.addListener((details) => {
  const context = requestContexts.get(details.requestId);
  requestContexts.delete(details.requestId);
  if (details.method === "OPTIONS") return;
  const contentType = getHeader(details.responseHeaders, "content-type");

  if ((details.statusCode >= 200 && details.statusCode < 300) || details.statusCode === 401 || details.statusCode === 403) {
    const task = {
      requestUrl: details.url,
      requestCookieHeader: context?.cookieHeader || "",
      responseStatus: details.statusCode,
      contentType,
      requestAt: context?.startedAt || Date.now(),
    };
    syncQueue = syncQueue.then(() => syncOneRequest(task)).catch(() => {});
    return;
  }

  if (details.statusCode >= 500) {
    void reportState("ERROR", `达摩盘 model/list 返回 HTTP ${details.statusCode}，当前无法确认登录状态。`);
  }
}, MODEL_LIST_FILTER, ["responseHeaders"]);

chrome.webRequest.onBeforeRedirect.addListener((details) => {
  requestContexts.delete(details.requestId);
  let redirectLooksLikeLogin = false;
  try {
    const target = new URL(details.redirectUrl);
    const host = target.hostname.toLowerCase();
    redirectLooksLikeLogin = /(^|\.)login\.taobao\.com$|(^|\.)login\.tmall\.com$|(^|\.)passport\.taobao\.com$|(^|\.)passport\.tmall\.com$/.test(host)
      || /\/(member\/login|passport\/login|login\/login|login\.htm)(\/|$)/i.test(target.pathname);
  } catch {
    redirectLooksLikeLogin = false;
  }

  if (redirectLooksLikeLogin) {
    void markLoginInvalid("达摩盘请求被重定向到淘宝登录页面，登录状态可能已失效。");
  } else {
    void reportState("ERROR", "达摩盘 model/list 请求发生了非登录重定向，可能是安全验证或网关跳转；不能据此判断账号已退出。");
  }
}, MODEL_LIST_FILTER);

chrome.webRequest.onErrorOccurred.addListener((details) => {
  requestContexts.delete(details.requestId);
}, MODEL_LIST_FILTER);

async function heartbeat() {
  const config = await readConfig();
  if (!config.extensionToken) return;
  try {
    const result = await apiRequest("/api/dmp/extension/heartbeat");
    const status = result.lastStatus || "NOT_CONFIGURED";
    await chrome.storage.local.set({ lastStatus: status, lastSyncAt: result.lastSyncAt || config.lastSyncAt || null, lastError: result.lastError || null });
    await setBadge(status === "NOT_CONFIGURED" ? "WAITING_FOR_LOGIN" : status);
    if (status === "INVALID") {
      await notify("dmp-login-invalid", "达摩盘登录可能已失效", "检测到跳转到淘宝登录页。请确认达摩盘登录状态；重新登录后刷新页面即可自动同步。");
    }
  } catch (error) {
    if (error instanceof Error && /扩展授权已过期|扩展授权无效/.test(error.message)) {
      await chrome.storage.local.remove(["apiBaseUrl", "extensionToken", "userName"]);
      await chrome.storage.local.set({ lastStatus: "NOT_PAIRED", lastError: "扩展授权已过期，请重新配对。" });
      await setBadge("NOT_PAIRED");
      await notify("dmp-extension-expired", "选品工具扩展授权已过期", "请回到选品工具的达摩盘授权页重新配对扩展。");
    }
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) void heartbeat();
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith("dmp-login") || notificationId === "dmp-extension-expired") {
    void chrome.tabs.create({ url: DMP_PAGE_URL });
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    await chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 15 });
    if (details?.reason === "update") {
      await reportState("ERROR", "扩展已更新，正在等待新的达摩盘模型列表请求。请刷新达摩盘页面以同步登录凭证。");
    }
    await heartbeat();
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 15 });
  void heartbeat();
});
