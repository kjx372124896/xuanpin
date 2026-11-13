#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVICE_NAME = "xuanpin-api";
const SERVICE_FILE = `/etc/systemd/system/${SERVICE_NAME}.service`;
const isUpdate = process.argv.includes("--update");
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
process.umask(0o022);

function log(message) {
  console.log(`\n[选品工具] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const capture = options.capture === true;
  const input = options.input;
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    input,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    stdio: [input !== undefined ? "pipe" : "ignore", capture ? "pipe" : "inherit", capture ? "pipe" : "inherit"],
  });
  if (result.error) fail(`无法执行 ${command}：${result.error.message}`);
  if (result.status !== 0 && !options.allowFailure) {
    fail(`${command} ${args.join(" ")} 执行失败，退出码：${result.status ?? "unknown"}`);
  }
  return { status: result.status ?? 1, stdout: result.stdout?.trim() ?? "", stderr: result.stderr?.trim() ?? "" };
}

function replaceEnvValue(filePath, key, value) {
  const source = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const line = `${key}=${JSON.stringify(value)}`;
  const pattern = new RegExp(`^${key}\\s*=.*$`, "m");
  const updated = pattern.test(source)
    ? source.replace(pattern, line)
    : `${source.replace(/\s*$/, "")}${source.trim() ? "\n" : ""}${line}\n`;
  writeFileSync(filePath, updated, { mode: 0o600 });
  chmodSync(filePath, 0o600);
}

function loadDeploymentEnvironment(envPath) {
  let values;
  try {
    values = parseEnv(readFileSync(envPath, "utf8"));
  } catch (error) {
    fail(`.env 格式无法解析：${error instanceof Error ? error.message : String(error)}`);
  }
  const privateEnvPath = path.join(ROOT, ".deploy.env");
  let privateValues = {};
  if (existsSync(privateEnvPath)) {
    chmodSync(privateEnvPath, 0o600);
    try {
      privateValues = parseEnv(readFileSync(privateEnvPath, "utf8"));
    } catch (error) {
      fail(`.deploy.env 格式无法解析：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (values.POSTGRES_ADMIN_URL?.trim()) {
    replaceEnvValue(privateEnvPath, "POSTGRES_ADMIN_URL", values.POSTGRES_ADMIN_URL.trim());
    replaceEnvValue(envPath, "POSTGRES_ADMIN_URL", "");
    values.POSTGRES_ADMIN_URL = values.POSTGRES_ADMIN_URL.trim();
  } else {
    values.POSTGRES_ADMIN_URL = privateValues.POSTGRES_ADMIN_URL || "";
  }
  return values;
}

function privileged(command, args, options = {}) {
  return isRoot
    ? run(command, args, options)
    : run("sudo", [command, ...args], options);
}

function quoteSystemd(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%")}"`;
}

function validateEnvironment() {
  const envPath = path.join(ROOT, ".env");
  if (!existsSync(envPath)) {
    const template = path.join(ROOT, ".env.production.example");
    if (!existsSync(template)) fail("缺少 .env 和 .env.production.example，无法生成生产配置。");
    copyFileSync(template, envPath);
    chmodSync(envPath, 0o600);
    fail("已自动生成 .env。请填写 WEB_ORIGIN、ADMIN_PASSWORD 和 DMP_CREDENTIAL_ENCRYPTION_KEY；数据库账号和数据库由部署程序自动创建，然后重新执行 pnpm deploy:linux。");
  }

  const values = loadDeploymentEnvironment(envPath);
  const required = ["WEB_ORIGIN", "ADMIN_PASSWORD", "DMP_CREDENTIAL_ENCRYPTION_KEY"];
  const missing = required.filter((key) => !values[key]?.trim());
  if (missing.length) fail(`.env 缺少必填配置：${missing.join(", ")}`);

  const origins = values.WEB_ORIGIN.split(",").map((value) => value.trim()).filter(Boolean);
  for (const origin of origins) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      fail("WEB_ORIGIN 必须填写 HTTPS 网站源，例如 https://pick.example.com。");
    }
    if (parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      fail("WEB_ORIGIN 必须是 HTTPS 域名源，不能包含路径、查询参数或片段。");
    }
  }
  if (values.ADMIN_PASSWORD.length < 8 || /replace-with|请替换|你的管理员密码/i.test(values.ADMIN_PASSWORD)) {
    fail("请在 .env 中设置至少 8 位且非示例占位符的 ADMIN_PASSWORD。");
  }
  if (!/^[a-f\d]{64}$/i.test(values.DMP_CREDENTIAL_ENCRYPTION_KEY)) {
    fail("DMP_CREDENTIAL_ENCRYPTION_KEY 必须是64位十六进制字符。可运行：openssl rand -hex 32");
  }
  if (String(values.COOKIE_SECURE).toLowerCase() !== "true") {
    fail("生产环境 COOKIE_SECURE 必须设置为 true。");
  }

  const port = Number(values.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail("PORT 必须是 1 到 65535 之间的整数。");
  let legacyDatabaseUrl = null;
  const hasPostgresSettings = ["POSTGRES_DB", "POSTGRES_USER", "POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_PASSWORD"]
    .some((key) => values[key]?.trim());
  if (!hasPostgresSettings && values.DATABASE_URL?.trim()) {
    try {
      legacyDatabaseUrl = new URL(values.DATABASE_URL.trim());
    } catch {
      fail("旧版 DATABASE_URL 不是有效的 PostgreSQL 连接地址。");
    }
    if (!["postgres:", "postgresql:"].includes(legacyDatabaseUrl.protocol)) fail("旧版 DATABASE_URL 必须是 PostgreSQL 连接地址。");
    values.POSTGRES_DB = decodeURIComponent(legacyDatabaseUrl.pathname.replace(/^\//, ""));
    values.POSTGRES_USER = decodeURIComponent(legacyDatabaseUrl.username);
    values.POSTGRES_PASSWORD = decodeURIComponent(legacyDatabaseUrl.password);
    values.POSTGRES_HOST = legacyDatabaseUrl.hostname.replace(/^\[|\]$/g, "");
    values.POSTGRES_PORT = legacyDatabaseUrl.port;
    values.POSTGRES_SSLMODE = legacyDatabaseUrl.searchParams.get("sslmode") || "";
  }

  const databaseName = values.POSTGRES_DB?.trim() || "selection_tool";
  const databaseUser = values.POSTGRES_USER?.trim() || "selection_app";
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(databaseName)) fail("POSTGRES_DB 只能使用小写字母、数字和下划线，且必须以字母或下划线开头。");
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(databaseUser)) fail("POSTGRES_USER 只能使用小写字母、数字和下划线，且必须以字母或下划线开头。");
  if (["postgres", "template0", "template1"].includes(databaseName)) fail("POSTGRES_DB 不能使用 PostgreSQL 系统数据库名称。");
  if (databaseUser === "postgres") fail("POSTGRES_USER 不能使用 PostgreSQL 超级管理员账号 postgres；请使用独立应用账号。");
  let adminUrl = null;
  if (values.POSTGRES_ADMIN_URL?.trim()) {
    try {
      adminUrl = new URL(values.POSTGRES_ADMIN_URL.trim());
    } catch {
      fail("POSTGRES_ADMIN_URL 不是有效的 PostgreSQL 管理连接地址。");
    }
    if (!["postgres:", "postgresql:"].includes(adminUrl.protocol) || !adminUrl.hostname || !adminUrl.username) {
      fail("POSTGRES_ADMIN_URL 必须是包含主机和管理账号的 PostgreSQL URL。");
    }
  }
  const databaseHost = (values.POSTGRES_HOST?.trim() || adminUrl?.hostname || "127.0.0.1").replace(/^\[|\]$/g, "");
  if (!databaseHost || /[/?#@\\\s]/.test(databaseHost)) fail("POSTGRES_HOST 必须填写有效的主机名或 IP 地址。");
  const databasePort = Number(values.POSTGRES_PORT || adminUrl?.port || 5432);
  if (!Number.isInteger(databasePort) || databasePort < 1 || databasePort > 65535) fail("POSTGRES_PORT 必须是 1 到 65535 之间的整数。");
  const sslMode = values.POSTGRES_SSLMODE?.trim() || adminUrl?.searchParams.get("sslmode") || "prefer";
  if (!/^(disable|allow|prefer|require|verify-ca|verify-full)$/.test(sslMode)) fail("POSTGRES_SSLMODE 必须是有效的 PostgreSQL sslmode。");
  const databasePasswordProvided = Boolean(values.POSTGRES_PASSWORD?.trim());
  const databasePassword = values.POSTGRES_PASSWORD?.trim() || randomBytes(32).toString("base64url");
  values.POSTGRES_DB = databaseName;
  values.POSTGRES_USER = databaseUser;
  values.POSTGRES_HOST = databaseHost;
  values.POSTGRES_PORT = String(databasePort);
  values.POSTGRES_SSLMODE = sslMode;
  values.POSTGRES_PASSWORD = databasePassword;
  const uploadDir = path.resolve(ROOT, values.UPLOAD_DIR || "apps/api/storage/uploads");
  return { values, port, uploadDir, envPath, databasePasswordProvided };
}

function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) fail(`不安全的 PostgreSQL 标识符：${value}`);
  return `"${value}"`;
}

function runPsql(args, options = {}) {
  const psqlArgs = ["-X", "-v", "ON_ERROR_STOP=1", "-A", "-t", ...args];
  if (options.localPeer) {
    if (isRoot) return run("runuser", ["-u", "postgres", "--", "psql", ...psqlArgs], options);
    return run("sudo", ["-u", "postgres", "psql", ...psqlArgs], options);
  }
  return run("psql", psqlArgs, options);
}

function provisionPostgres(values, envPath, databasePasswordProvided) {
  const databaseName = values.POSTGRES_DB;
  const databaseUser = values.POSTGRES_USER;
  const databasePassword = values.POSTGRES_PASSWORD;
  const adminUrl = values.POSTGRES_ADMIN_URL?.trim() ? new URL(values.POSTGRES_ADMIN_URL.trim()) : null;
  const maintenanceDatabase = adminUrl?.pathname && adminUrl.pathname !== "/"
    ? decodeURIComponent(adminUrl.pathname.slice(1))
    : "postgres";
  const adminEnv = adminUrl
    ? {
        PGSSLMODE: adminUrl.searchParams.get("sslmode") || values.POSTGRES_SSLMODE,
        ...(adminUrl.password ? { PGPASSWORD: decodeURIComponent(adminUrl.password) } : {}),
      }
    : {};
  const adminHost = adminUrl?.hostname.replace(/^\[|\]$/g, "");
  const adminArgsFor = (database) => adminUrl
    ? ["-h", adminHost, "-p", String(adminUrl.port || 5432), "-U", decodeURIComponent(adminUrl.username), "-d", database]
    : ["-U", "postgres", "-p", values.POSTGRES_PORT, "-d", database];
  log("自动创建/检查 PostgreSQL 账号和数据库（不会删除或重置现有数据）");
  const ownerResult = runPsql(adminArgsFor(maintenanceDatabase), {
    capture: true,
    env: adminEnv,
    localPeer: !adminUrl,
    input: `SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = '${databaseName}';`,
  });
  const databaseOwner = ownerResult.stdout.trim();
  if (databaseOwner && databaseOwner !== databaseUser) {
    fail(`数据库 ${databaseName} 已存在，但所有者是 ${databaseOwner}，不是 ${databaseUser}。为保护已有数据，部署程序不会擅自更改现有数据库对象所有权。请配置正确的 POSTGRES_USER，或使用新的 POSTGRES_DB。`);
  }

  const roleResult = runPsql(adminArgsFor(maintenanceDatabase), {
    capture: true,
    env: adminEnv,
    localPeer: !adminUrl,
    input: `SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname = '${databaseUser}';`,
  });
  const roleStatus = roleResult.stdout.trim();
  const roleExists = roleStatus !== "";
  if (roleStatus === "t") {
    fail(`PostgreSQL 账号 ${databaseUser} 拥有超级用户或数据库管理权限。为避免应用使用高权限账号，请改用普通应用账号。`);
  }
  if (roleExists && !databasePasswordProvided) {
    fail(`PostgreSQL 账号 ${databaseUser} 已存在，但没有提供它的 POSTGRES_PASSWORD。为避免重置其他程序正在使用的账号密码，请在 .env 中填写该账号的原密码，或改用一个新的 POSTGRES_USER。`);
  }
  if (!roleExists && !databasePasswordProvided) {
    // 先持久化随机密码，再创建角色；若中途失败，下一次运行仍能复用同一密码。
    replaceEnvValue(envPath, "POSTGRES_PASSWORD", databasePassword);
  }

  const passwordHex = Buffer.from(databasePassword, "utf8").toString("hex");
  const userLiteral = `'${databaseUser}'`;
  const dbLiteral = `'${databaseName}'`;
  const passwordExpression = `convert_from(decode('${passwordHex}', 'hex'), 'UTF8')`;
  const createSql = [
    ...(!roleExists ? [`SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', ${userLiteral}, ${passwordExpression}) \\gexec`] : []),
    `SELECT format('CREATE DATABASE %I OWNER %I', ${dbLiteral}, ${userLiteral}) WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${dbLiteral}) \\gexec`,
    `GRANT ALL PRIVILEGES ON DATABASE ${quoteIdentifier(databaseName)} TO ${quoteIdentifier(databaseUser)};`,
  ].join("\n");
  runPsql(adminArgsFor(maintenanceDatabase), { input: createSql, env: adminEnv, localPeer: !adminUrl });

  runPsql(adminArgsFor(databaseName), {
    input: `GRANT USAGE, CREATE ON SCHEMA public TO ${quoteIdentifier(databaseUser)};`,
    env: adminEnv,
    localPeer: !adminUrl,
  });
  runPsql(["-h", values.POSTGRES_HOST, "-p", values.POSTGRES_PORT, "-U", databaseUser, "-d", databaseName, "-c", "SELECT 1;"], {
    capture: true,
    env: { PGPASSWORD: databasePassword, PGSSLMODE: values.POSTGRES_SSLMODE },
  });

  const host = values.POSTGRES_HOST.includes(":") ? `[${values.POSTGRES_HOST}]` : values.POSTGRES_HOST;
  const applicationUrl = new URL(`postgresql://${host}:${values.POSTGRES_PORT}`);
  applicationUrl.username = databaseUser;
  applicationUrl.password = databasePassword;
  applicationUrl.pathname = `/${databaseName}`;
  applicationUrl.searchParams.set("schema", "public");
  applicationUrl.searchParams.set("sslmode", values.POSTGRES_SSLMODE);
  values.DATABASE_URL = applicationUrl.toString();

  replaceEnvValue(envPath, "POSTGRES_DB", databaseName);
  replaceEnvValue(envPath, "POSTGRES_USER", databaseUser);
  replaceEnvValue(envPath, "POSTGRES_HOST", values.POSTGRES_HOST);
  replaceEnvValue(envPath, "POSTGRES_PORT", values.POSTGRES_PORT);
  replaceEnvValue(envPath, "POSTGRES_SSLMODE", values.POSTGRES_SSLMODE);
  replaceEnvValue(envPath, "POSTGRES_PASSWORD", databasePassword);
  replaceEnvValue(envPath, "DATABASE_URL", values.DATABASE_URL);
  log(`PostgreSQL 已就绪：${databaseName}（应用账号：${databaseUser}）`);
}

function checkRuntime() {
  if (process.platform !== "linux") fail("此命令仅用于 Linux 服务器；本机开发请勿执行 pnpm deploy:linux。");
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 12)) fail("需要 Node.js 22.12 或更高版本（推荐 Node.js 24 LTS）。");
  if (!existsSync("/run/systemd/system")) fail("未检测到 systemd。当前一键部署脚本使用 systemd 管理开机启动服务。");
  const pnpmVersion = run("pnpm", ["--version"], { capture: true }).stdout;
  if (pnpmVersion !== "10.34.9") fail(`项目要求 pnpm 10.34.9，当前检测到 ${pnpmVersion || "未知版本"}。请先通过 Corepack 启用 pnpm@10.34.9。`);
  run("psql", ["--version"], { capture: true });
}

function checkUpdateState() {
  if (!existsSync(SERVICE_FILE)) fail("尚未安装 xuanpin-api 服务，请首次部署时运行 pnpm deploy:linux。");
  const branch = run("git", ["branch", "--show-current"], { capture: true }).stdout;
  if (branch !== "main") fail(`当前分支为 ${branch || "未知"}，更新脚本只允许在 main 分支执行。`);
  const status = run("git", ["status", "--porcelain"], { capture: true }).stdout;
  if (status) fail("Git 工作区存在未提交修改。为避免覆盖本地改动，已停止更新；请先处理 git status 中的文件。");
  log("拉取 GitHub main 最新代码");
  run("git", ["pull", "--ff-only", "origin", "main"]);
}

function ensureServiceIdentity(uploadDir) {
  let user;
  let group;
  const currentUser = os.userInfo().username;
  if (existsSync(SERVICE_FILE)) {
    const currentUnit = readFileSync(SERVICE_FILE, "utf8");
    user = /^User=(.+)$/m.exec(currentUnit)?.[1]?.trim() || "";
    group = /^Group=(.+)$/m.exec(currentUnit)?.[1]?.trim() || "";
    if (!user) fail(`现有 ${SERVICE_FILE} 没有 User 配置，请检查服务文件后再更新。`);
    if (!isRoot && user !== currentUser) {
      fail(`该服务由 ${user} 账号管理。请使用首次部署时相同的账号（或 root）执行更新，避免更改服务文件权限。`);
    }
  } else if (isRoot) {
    if (!ROOT.startsWith("/opt/") && !ROOT.startsWith("/srv/")) {
      fail("root 用户首次部署时，请将项目放在 /opt 或 /srv 目录下（推荐 /opt/xuanpin），确保专用服务账号能够读取项目文件。");
    }
    user = "xuanpin";
    const existing = run("id", ["-u", user], { capture: true, allowFailure: true });
    if (existing.status !== 0) {
      const noLoginShell = existsSync("/usr/sbin/nologin") ? "/usr/sbin/nologin" : "/sbin/nologin";
      run("useradd", ["--system", "--user-group", "--home-dir", "/nonexistent", "--shell", noLoginShell, user]);
    }
  } else {
    user = currentUser;
    run("sudo", ["-v"]);
  }

  group ||= run("id", ["-gn", user], { capture: true }).stdout;
  mkdirSync(uploadDir, { recursive: true, mode: 0o750 });
  chmodSync(path.join(ROOT, ".env"), 0o600);
  if (isRoot) {
    run("chown", [`${user}:${group}`, path.join(ROOT, ".env")]);
    run("chown", ["-R", `${user}:${group}`, uploadDir]);
  }
  return { user, group };
}

function installSystemdService(user, group) {
  const nodePath = process.execPath;
  if (isRoot && (nodePath === "/root" || nodePath.startsWith("/root/"))) {
    fail("当前 Node.js 安装在 /root 下，专用服务账号无法访问。请使用系统级 Node.js（例如 /usr/bin/node）再部署。");
  }
  const unit = [
    "[Unit]",
    "Description=Xuanpin Selection Tool API and Web",
    "Wants=network-online.target",
    "After=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `User=${user}`,
    `Group=${group}`,
    `WorkingDirectory=${quoteSystemd(ROOT)}`,
    "Environment=NODE_ENV=production",
    "Environment=HOST=127.0.0.1",
    "Environment=SERVE_WEB=true",
    "Environment=TRUST_PROXY=1",
    `ExecStart=${quoteSystemd(nodePath)} ${quoteSystemd(path.join(ROOT, "apps", "api", "dist", "main.js"))}`,
    "Restart=on-failure",
    "RestartSec=5",
    "TimeoutStopSec=30",
    "KillSignal=SIGTERM",
    "UMask=0027",
    "NoNewPrivileges=true",
    "PrivateTmp=true",
    "LimitNOFILE=65535",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    "",
  ].join("\n");

  const tempFile = path.join(os.tmpdir(), `${SERVICE_NAME}-${process.pid}.service`);
  writeFileSync(tempFile, unit, { mode: 0o600 });
  try {
    privileged("install", ["-o", "root", "-g", "root", "-m", "0644", tempFile, SERVICE_FILE]);
  } finally {
    rmSync(tempFile, { force: true });
  }
  privileged("systemctl", ["daemon-reload"]);
  privileged("systemctl", ["enable", SERVICE_NAME]);
  const active = privileged("systemctl", ["is-active", "--quiet", SERVICE_NAME], { allowFailure: true }).status === 0;
  privileged("systemctl", [active ? "restart" : "start", SERVICE_NAME]);
}

async function waitForHealth(port) {
  const url = `http://127.0.0.1:${port}/api/health`;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (response.ok) {
        const body = await response.json();
        if (body?.ok === true) return;
      }
    } catch {
      // 服务刚启动时连接失败属于正常情况，继续等待。
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  privileged("journalctl", ["-u", SERVICE_NAME, "-n", "60", "--no-pager"], { allowFailure: true });
  fail(`服务启动后健康检查仍未通过：${url}`);
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("首次部署：pnpm deploy:linux\n更新版本：pnpm update:linux\n仅支持 Linux + systemd + Node.js >=22.12 + pnpm 10.34.9。");
    return;
  }

  checkRuntime();
  if (isUpdate) checkUpdateState();
  const { values, port, uploadDir, envPath, databasePasswordProvided } = validateEnvironment();
  provisionPostgres(values, envPath, databasePasswordProvided);
  log("安装锁定版本依赖");
  run("pnpm", ["install", "--frozen-lockfile"]);
  log("生成 Prisma Client");
  run("pnpm", ["exec", "prisma", "generate", "--schema", "prisma/schema.prisma"]);
  log("自动执行数据库迁移（不会重置或删除现有数据）");
  run("pnpm", ["exec", "prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"]);
  log("初始化超级管理员（已有账号不会被覆盖）");
  run("pnpm", ["db:seed"]);
  log("构建前端和后端");
  run("pnpm", ["-r", "build"]);

  if (!existsSync(path.join(ROOT, "apps", "web", "dist", "index.html"))) {
    fail("前端构建结束，但 apps/web/dist/index.html 不存在。");
  }
  if (!existsSync(path.join(ROOT, "apps", "api", "dist", "main.js"))) {
    fail("后端构建结束，但 apps/api/dist/main.js 不存在。");
  }

  const { user, group } = ensureServiceIdentity(uploadDir);
  log("安装并启动 systemd 服务");
  installSystemdService(user, group);
  await waitForHealth(port);

  log("部署成功");
  console.log(`网页地址：${values.WEB_ORIGIN}`);
  console.log(`本机健康检查：http://127.0.0.1:${port}/api/health`);
  console.log(`服务状态：systemctl status ${SERVICE_NAME}`);
  console.log(`服务日志：journalctl -u ${SERVICE_NAME} -f`);
}

main().catch((error) => {
  console.error(`\n[选品工具部署失败] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
