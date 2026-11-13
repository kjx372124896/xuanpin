# 选品工具 · 达摩盘登录助手

这是选品工具配套的 Chrome / Chromium / EGO Manifest V3 扩展。它只负责自动捕获达摩盘登录态并同步到已配对的选品工具账号；AI 管家会话、SSE、Markdown 解析和商品数据入库仍由选品工具后端负责。

## 安装（加载已解压扩展）

1. 打开 `chrome://extensions`。
2. 启用右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择本文件夹。
4. 固定工具栏中的「选品工具 · 达摩盘登录助手」图标。

EGO 等 Chromium 内核浏览器也可使用对应的扩展管理页加载本文件夹。

## 首次配对

1. 登录选品工具，进入「达摩盘授权」。
2. 点击「生成一次性配对码」。配对码只有12位，有效期5分钟，只能使用一次。
3. 在当前选品工具标签页点击扩展图标，输入配对码并绑定。
4. 点击「打开达摩盘并自动同步」，正常登录达摩盘。
5. 达摩盘成功加载 AI 模型列表后，扩展优先从浏览器实际发出的 `model/list` 请求头中短暂捕获 Cookie（包括 HttpOnly）；如果当前 Chromium 内核未开放请求头读取，再回退到 Cookies API。随后通过 HTTPS 更新当前选品工具用户的加密凭证。

配对码不是 Cookie。用户不需要打开开发者工具，也不需要复制 Cookie 或 Request URL。

## 权限说明

- `cookies`：分别读取 `https://dmp.taobao.com` 和 `https://dmp.advgateway.taobao.com` 当前 URL 适用的 Cookie，包括 HttpOnly Cookie；服务端按请求目标主机分别使用，不混发 host-only Cookie。
- `webRequest` + `https://dmp.taobao.com/*`：只监听 AI `model/list` 请求，并短暂读取这一个请求实际发送的 Cookie 请求头、状态码和重定向；不读取其他网站请求内容。
- `alarms` / `notifications`：每15分钟检查选品工具记录的登录状态，并在失效时提醒。
- `optional_host_permissions`：配对时只申请当前选品工具站点的访问权限；不默认获得所有网站的权限。
- `storage`：仅保存选品工具 API 地址、扩展专用绑定令牌和状态，不保存 Cookie。

扩展 ID 固定为 `nggbkgocgdebofoppmjjfoobhblppicf`，与 API 的 `DMP_EXTENSION_ID` CORS 允许项对应。不要随意删除 manifest 中的 `key` 字段，否则扩展 ID 会变化。

## 安全边界

- 两个达摩盘主机的 Cookie 只在扩展后台内存中短暂处理，通过 HTTPS 发送；本地开发仅允许 `localhost` / `127.0.0.1`。
- 未读取到 Cookie、HTTP 403、HTML 验证页或非登录重定向只标记为「请求异常」，不会单凭这些情况提示登录失效；只有明确跳转到淘宝登录页才标记登录失效。
- 服务端仅保存 AES-256-GCM 加密后的凭证；数据库不保存扩展绑定令牌明文，只保存 SHA-256 哈希。
- 扩展绑定令牌有效期90天；用户可在选品工具授权页解绑。
- 配对、凭证同步和心跳接口继续执行员工 IP 白名单校验；管理员账号不受员工 IP 白名单限制。
- 不要在控制台、日志、截图或问题反馈中输出 Cookie、配对令牌或扩展令牌。
- 当前 AI 管家请求仍由选品工具 API 后端发起，使用服务器出口 IP；浏览器扩展负责自动维护登录 Cookie，不会改变后端请求的出口 IP。
