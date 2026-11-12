# 选品数据中心

公司内部使用的商品榜单导入与选品分析网页工具。前后端均使用 TypeScript，数据存储在 PostgreSQL；本地开发，生产环境使用 Docker Compose 部署。

## 当前功能

- 账号密码登录；管理员创建员工账号、设置在职/离职/停用状态和导入权限。
- 独立管理员页面；管理员可维护普通员工的 IPv4/IPv6 地址和 CIDR 白名单。超级管理员、普通管理员不受 IP 白名单限制。
- 支持一次上传多份 `.xlsx`，兼容生意参谋原始工作表和合并结果工作簿。
- 自动识别周周期、类目和字段；访客数、支付买家数、加购人数拆为数值最小值、最大值、中值，原始文本保留。
- 日期范围拆为开始日期、结束日期两个 PostgreSQL DATE 字段；类目按首个 `/` 拆成一级类目和二级类目。
- 文件 SHA-256 与「商品ID + 周开始日期 + 类目」双层防重；同一商品跨周期只保留一条商品主记录，历史周期独立保存。
- 商品列表展示支付买家数首期至最新期的中值折线趋势；商品详情展示支付买家数/访客数趋势和结构化历史数值。
- 选品筛选支持最新上榜周日期多选、最新周期支付买家数中值阈值、上榜周数/连续周数范围、一级类目→二级类目级联及“我的收藏”；不提供行业排名筛选。
- 商品详情在列表内以弹窗打开；商品收藏保存在 PostgreSQL，按登录用户隔离。
- 导入任务在 API 进程内后台执行，任务状态保存在 PostgreSQL；API 重启后会重新接续排队/处理中批次。

## 技术栈

| 部分 | 技术 |
|---|---|
| 前端 | React 19、TypeScript、Vite、Ant Design、ECharts、TanStack Query |
| 后端 | NestJS 11、TypeScript、Express |
| 数据库 | PostgreSQL 17、Prisma 6 |
| Excel | ExcelJS + fflate（兼容生意参谋工作簿中的 Excel Table 关系） |
| 包管理 | pnpm 10 |

## 本地开发

### 1. 环境要求

- Node.js 24 LTS
- pnpm 10（可通过 `npm install -g pnpm@10` 安装）
- PostgreSQL 17

本机若已有 PostgreSQL，可以使用自己的开发数据库；不要把本地开发连接串指向生产数据库。

### 2. 配置环境变量

```powershell
Copy-Item .env.example .env
```

编辑根目录 `.env`，至少修改 `DATABASE_URL` 和 `ADMIN_PASSWORD`。本项目当前开发机使用的本地数据库配置为：

```env
DATABASE_URL=postgresql://selection_dev:selection_dev@127.0.0.1:55432/selection_tool_dev?schema=public
ADMIN_USERNAME=admin
ADMIN_PASSWORD=请设置自己的管理员密码
```

当前工作区使用隔离的本地 PostgreSQL 数据目录 `F:\选品工具\.local-db`（已加入 `.gitignore`），与机器上其他 PostgreSQL 服务的数据目录分开。首次克隆项目时可初始化本地开发库：

```powershell
& .\scripts\init-local-db.ps1
```

首次初始化时，脚本会将该项目数据库注册为 Windows 服务 `selection-tool-local-pg`，以 `NetworkService` 身份运行，监听 `127.0.0.1:55432`；不会复用系统中其他 PostgreSQL 服务。后续每次开发前只需运行 `& .\scripts\start-local-db.ps1`。

停止本地开发数据库：

```powershell
& .\scripts\stop-local-db.ps1
```

脚本默认查找 `D:\PostgreSQL\17\bin`，也可以设置 `POSTGRES_BIN` 指向本机 PostgreSQL `bin` 目录。

### 3. 安装、迁移和初始化管理员

```powershell
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

首次启动时会根据 `.env` 创建超级管理员。默认登录账号为 `admin`，密码就是 `.env` 中的 `ADMIN_PASSWORD`。重复执行 seed 不会覆盖已有管理员密码。

### 4. 启动前后端

```powershell
pnpm dev
```

- 网页端：<http://localhost:5173>
- API：<http://localhost:3001/api>
- 健康检查：<http://localhost:3001/api/health>

也可以分别运行：

```powershell
pnpm dev:api
pnpm dev:web
```

首次登录超级管理员后，进入「管理员设置 → IP 白名单」添加普通员工允许访问的公网 IP/CIDR。管理员自身不受白名单限制。白名单为空时，普通员工默认不能登录。

## 导入数据

1. 登录系统，进入「数据导入」。
2. 上传生意参谋导出的原始 `.xlsx` 文件（可多选），或上传含 `合并数据` 工作表的合并结果工作簿。
3. 检查文件周期、类目、有效行数和异常行预览。
4. 点击「确认导入」，任务在后台处理；完成后刷新商品列表。

导入规则：

- 自动忽略浏览器未选择的 Excel 临时锁定文件；服务器拒绝文件名以 `~$` 开头的临时文件。
- 合并工作簿只读取 `合并数据`，不会把 `文件统计`、`周汇总` 当成商品数据。
- 只接受 `.xlsx`；单文件上限 50 MB，最多 100 个文件。
- 区间指标保存原始文本，并拆成最小值、最大值、中值三个数值字段；中值按 `(最小值 + 最大值) / 2` 计算，空值保持 NULL。
- 日期范围保存原始文本，并拆成开始日期、结束日期两个 DATE 字段。
- 类目原始文本保留，按第一个 `/` 拆成一级类目和二级类目，自动去除两侧空格。
- 图表折线使用区间中值，阴影展示原始区间范围，不冒充精确值。
- 文件哈希用于拦截完全相同文件；业务唯一键用于防止不同文件重复写入同一商品、周期、类目记录。

## 当前本地样例数据

为验证导入逻辑，当前本地开发数据库已通过系统导入设计阶段提供的 80 份原始周明细文件：

| 项目 | 数量 |
|---|---:|
| 商品主记录 | 9,253 |
| 商品上榜历史 | 22,331 |
| 类目 | 4 |
| 已导入文件 | 82 |
| 周周期 | 10 |
| 覆盖全部 10 周的商品 | 93 |

当前数据库包含原始 80 份明细及之后追加导入的 2 份文件；以上是本地开发库现状，不代表最初 80 份文件的独立统计。

这些数据只在本地开发数据库中，不会自动进入生产数据库。`.local-db`、上传文件和 `.env` 均不会提交到 Git。

## 生产部署

生产部署文件位于 `deploy/`。先复制 `deploy/.env.production.example` 为 `deploy/.env`，设置数据库密码、管理员初始密码和正式访问域名，然后：

```powershell
cd deploy
docker compose up -d --build
```

网页容器绑定服务器本机 `127.0.0.1:8080`。需要在服务器已有的 HTTPS 反向代理中将域名转发到该地址，并保留客户端 `X-Forwarded-For` 来源 IP；Compose 中 `TRUST_PROXY=2` 按“外层 HTTPS 代理 + 容器内 Nginx”两层代理配置，代理层数不同需要同步调整。PostgreSQL 只在 Docker 内部网络开放，不映射公网端口。数据库数据和 Excel 上传文件分别保存在 Docker named volume 中。

首次启动 API 容器时会执行 Prisma migration 和管理员初始化。生产环境请使用独立的 `.env`，不要复制本地 `.env` 或 `.local-db`。

## 主要目录

```text
apps/api/       NestJS API、登录权限、Excel 导入、商品查询
apps/web/       React 网页端
packages/shared 前后端共享类型
prisma/         PostgreSQL 数据模型与迁移
deploy/         Dockerfile、Compose、Nginx 配置
scripts/        本地 PostgreSQL 启停脚本
docs/           设计与后续维护文档
```
