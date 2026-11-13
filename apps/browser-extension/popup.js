const $ = (id) => document.getElementById(id);
let activeOrigin = "";

function showMessage(text, isError = false) {
  const box = $("message");
  box.textContent = text;
  box.classList.remove("hidden", "error");
  if (isError) box.classList.add("error");
}

function setStatus(status, lastSyncAt, lastError, lastRequestStatus, lastCookieSource) {
  const dot = $("statusDot");
  dot.className = "dot";
  const map = {
    VALID: ["登录状态正常", "good", "已自动同步达摩盘登录凭证。"],
    INVALID: ["检测到登录页跳转", "bad", "请求被重定向到淘宝登录页，请确认达摩盘登录状态。"],
    ERROR: ["请求异常（不等于登录失效）", "warn", "扩展已捕获异常，请查看下面的具体原因。"],
    WAITING_FOR_LOGIN: ["等待达摩盘登录", "warn", "打开达摩盘并完成登录，扩展会自动同步。"],
    NOT_CONFIGURED: ["等待首次同步", "warn", "请打开达摩盘，登录后扩展会自动获取登录状态。"],
    NOT_PAIRED: ["尚未绑定选品工具", "", "请先生成配对码并绑定当前选品工具账号。"],
  };
  const [title, color, description] = map[status] || map.ERROR;
  $("statusTitle").textContent = title;
  $("statusDescription").textContent = lastError || description;
  if (color) dot.classList.add(color);
  const syncText = lastSyncAt ? `最近同步：${new Date(lastSyncAt).toLocaleString()}` : "尚未同步";
  const sourceLabel = lastCookieSource === "request-header" ? "实际请求头" : lastCookieSource === "cookies-api" ? "浏览器 Cookie API" : lastCookieSource === "unavailable" ? "未获取到" : "";
  const requestText = lastRequestStatus ? `最近请求：HTTP ${lastRequestStatus}${sourceLabel ? ` · Cookie来源：${sourceLabel}` : ""}` : "";
  $("lastSync").textContent = [syncText, requestText].filter(Boolean).join("\n");
}

async function getActiveOrigin() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) throw new Error("请先打开并登录选品工具，再点击扩展图标。");
  const url = new URL(tab.url);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("选品工具必须使用 HTTPS；本地开发仅允许 localhost 或 127.0.0.1。");
  }
  if (url.pathname.startsWith("/login")) throw new Error("请先登录选品工具，再进行扩展配对。");
  return url.origin;
}

async function refreshView() {
  const config = await chrome.storage.local.get(["apiBaseUrl", "extensionToken", "userName", "lastStatus", "lastSyncAt", "lastError", "lastRequestStatus", "lastCookieSource"]);
  const paired = Boolean(config.apiBaseUrl && config.extensionToken);
  $("pairSection").classList.toggle("hidden", paired);
  $("pairedSection").classList.toggle("hidden", !paired);
  if (paired) {
    $("userName").textContent = config.userName || "已绑定账号";
    setStatus(config.lastStatus || "WAITING_FOR_LOGIN", config.lastSyncAt, config.lastError, config.lastRequestStatus, config.lastCookieSource);
  } else {
    setStatus("NOT_PAIRED", null);
  }
}

async function refreshRemoteStatus() {
  const config = await chrome.storage.local.get(["apiBaseUrl", "extensionToken"]);
  if (!config.apiBaseUrl || !config.extensionToken) return;
  try {
    const response = await fetch(`${config.apiBaseUrl}/api/dmp/extension/heartbeat`, {
      headers: { Authorization: `Bearer ${config.extensionToken}` },
      cache: "no-store",
    });
    if (response.status === 401) {
      await chrome.storage.local.remove(["apiBaseUrl", "extensionToken", "userName"]);
      await chrome.storage.local.set({ lastStatus: "NOT_PAIRED", lastError: "扩展授权已撤销或过期，请重新配对。" });
      return;
    }
    if (!response.ok) return;
    const data = await response.json();
    await chrome.storage.local.set({ lastStatus: data.lastStatus, lastSyncAt: data.lastSyncAt, lastError: data.lastError });
  } catch {
    // 服务端暂时不可用时保留本地绑定信息，避免误解绑。
  }
}

$("pairButton").addEventListener("click", async () => {
  const button = $("pairButton");
  button.disabled = true;
  try {
    const code = $("pairCode").value.trim().toUpperCase();
    if (!/^[0-9A-F]{12}$/.test(code)) throw new Error("请输入12位配对码。");
    const apiBaseUrl = activeOrigin;
    if (!apiBaseUrl) throw new Error("请先打开已登录的选品工具页面，再点击扩展图标。");
    const parsed = new URL(apiBaseUrl);
    const originPattern = `${parsed.protocol}//${parsed.hostname}/*`;
    const permissionRequest = chrome.permissions.request({ origins: [originPattern] });
    const granted = await permissionRequest;
    if (!granted) throw new Error("未授予选品工具域名访问权限，无法完成配对。");
    const response = await fetch(`${apiBaseUrl}/api/dmp/extension/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.token) throw new Error(data.message || "配对失败，请确认配对码尚未过期。");
    await chrome.storage.local.set({ apiBaseUrl, extensionToken: data.token, userName: data.userName, lastStatus: "WAITING_FOR_LOGIN", lastSyncAt: null, lastError: null });
    await chrome.alarms.create("selection-tool-dmp-heartbeat", { periodInMinutes: 15 });
    showMessage("配对成功。现在打开达摩盘并正常登录即可。扩展不会要求手动复制 Cookie。");
    await refreshView();
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "配对失败。", true);
  } finally {
    button.disabled = false;
  }
});

$("openDmpButton").addEventListener("click", async () => {
  await chrome.tabs.create({ url: "https://dmp.taobao.com/index_new.html" });
  showMessage("已打开达摩盘。登录成功并加载模型列表后，扩展会自动同步。");
});

$("refreshButton").addEventListener("click", async () => {
  const button = $("refreshButton");
  button.disabled = true;
  try {
    const config = await chrome.storage.local.get(["apiBaseUrl", "extensionToken"]);
    if (!config.extensionToken) throw new Error("扩展尚未绑定。");
    const response = await fetch(`${config.apiBaseUrl}/api/dmp/extension/heartbeat`, {
      headers: { Authorization: `Bearer ${config.extensionToken}` },
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      await chrome.storage.local.remove(["apiBaseUrl", "extensionToken", "userName"]);
      await chrome.storage.local.set({ lastStatus: "NOT_PAIRED", lastError: "扩展授权已撤销或过期，请重新配对。" });
      await refreshView();
      throw new Error("扩展授权已撤销或过期，请重新配对。");
    }
    if (!response.ok) throw new Error(data.message || "刷新状态失败。");
    await chrome.storage.local.set({ lastStatus: data.lastStatus, lastSyncAt: data.lastSyncAt, lastError: data.lastError });
    const diagnostics = await chrome.storage.local.get(["lastRequestStatus", "lastCookieSource"]);
    setStatus(data.lastStatus, data.lastSyncAt, data.lastError, diagnostics.lastRequestStatus, diagnostics.lastCookieSource);
    showMessage("授权状态已刷新。");
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "刷新失败。", true);
  } finally {
    button.disabled = false;
  }
});

void (async () => {
  await refreshRemoteStatus();
  await refreshView();
  try { activeOrigin = await getActiveOrigin(); } catch { activeOrigin = ""; }
  $("pairButton").disabled = !activeOrigin;
  if (!activeOrigin) showMessage("请先打开并登录选品工具，然后从该页面点击扩展图标进行配对。", true);
})();
