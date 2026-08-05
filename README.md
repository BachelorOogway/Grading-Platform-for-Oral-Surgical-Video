# Oral Surgical Video Grading Platform

口腔颌面外科手术视频 AI 输出的**专家人工评分平台**。管理员上传 AI 结构化分析文本后，专家登录领取任务，按四级评估框架对 AI 结果进行人工校验与打分，并支持导出评分数据。

评估框架与 AI Prompt 说明见 [`research_background.md`](./research_background.md)。

## 功能概览

| 角色 | 能力 |
|------|------|
| **专家** | 登录、查看与领取任务、填写四级评分表并提交、响应重评请求 |
| **管理员** | 创建专家账号、上传 AI 输出、配置独占/共享视频号段、查看评分与指标、请求重评、导出 CSV |

任务分配规则（可在 `/admin` 调整）：

- **Exclusive（独占）**：默认视频号 `1–75`、`100–175`，每位专家独立领取
- **Shared（共享）**：默认视频号 `76–99`、`176–200`，可供多位专家评分以衡量一致性

## 技术栈

- **Next.js 15**（App Router）+ **React 18** + **TypeScript**
- **Prisma** + **PostgreSQL**（本地与 Vercel 均需 Postgres）
- **Tailwind CSS** + **react-hook-form**
- **bcryptjs**（专家密码哈希）

## 快速开始（本地）

### 环境要求

- Node.js 18+（建议 20+）
- npm
- PostgreSQL（本地 Docker / Neon 免费库均可）

### 安装与启动

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env：填入 DATABASE_URL；本地可先不设 ADMIN_SECRET

# 3. 生成 Prisma Client 并迁移数据库
npm run prisma:generate
npm run db:deploy
# 或开发时：npm run db:push

# 4. 启动开发服务器
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。

### 环境变量

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | **必填**。PostgreSQL 连接串 |
| `ADMIN_SECRET` | **生产必填**。保护 `/admin` 与全部 `/api/admin/*`（httpOnly Cookie） |
| `ALLOW_EXPERT_SELF_REGISTER` | 默认：本地允许自助注册；Vercel/production **关闭**。设为 `true` 可强制开启 |

## 部署到 Vercel（推荐步骤）

### 1. 准备 PostgreSQL

任选其一：

- **[Vercel Postgres / Neon](https://vercel.com/storage/postgres)**：在 Vercel 项目里创建 Storage，会自动注入 `DATABASE_URL`
- 或自建 Neon / Supabase / RDS，复制连接串

> Neon 若使用 **连接池（pooler）**，Prisma 建议在 URL 加 `?pgbouncer=true`（或按 Neon 文档使用 `prisma://` / 直连做 migrate）。构建时 `prisma migrate deploy` 通常用**直连** URL 更稳。

### 2. 推送代码并导入 Vercel

```bash
# 若尚未关联远程仓库，先 push 到 GitHub，再在 vercel.com → Add New Project 导入该仓库
```

或使用 CLI：

```bash
npm i -g vercel
vercel login
vercel
```

Framework Preset 选 **Next.js**。Root Directory 保持仓库根目录。

### 3. 配置 Environment Variables

在 Vercel → Project → Settings → Environment Variables 中为 **Production**（及 Preview 如需要）设置：

| Name | Value | 注意 |
|------|--------|------|
| `DATABASE_URL` | Postgres 连接串 | Storage 集成可自动带入 |
| `ADMIN_SECRET` | 长随机串 | 例如 `openssl rand -hex 32`，**不要**用 `NEXT_PUBLIC_` 前缀 |
| `ALLOW_EXPERT_SELF_REGISTER` | `false`（可省略） | 生产默认已关闭自助注册 |

### 4. 部署

点击 Deploy，或：

```bash
vercel --prod
```

构建脚本会执行：`prisma generate` → `prisma migrate deploy` → `next build`。

### 5. 上线后初始化

1. 打开 `https://你的域名/admin`，用 `ADMIN_SECRET` 解锁。
2. 在「专家账号」创建专家（姓名 + 初始密码 ≥8 位），把凭证发给专家。
3. 上传 AI 输出、配置区间，专家访问 `/login` 开始评分。

## 安全说明（已保护的能力）

| 能力 | 保护方式 |
|------|----------|
| 管理后台 UI `/admin` | 解锁后写入 httpOnly Cookie；无 Cookie 只显示解锁页 |
| 全部 `/api/admin/*`（上传、导出、指标、配置、重评、创建专家等） | `requireAdmin()`：校验 Cookie 或 `x-admin-secret` 头 |
| 专家自助注册 | Vercel/production 默认 **关闭**；需管理员创建账号 |
| 密码 | bcrypt 哈希；错误密码不会误建账号；最短 8 位 |
| 密钥 | `ADMIN_SECRET` 仅服务端；不再使用 `NEXT_PUBLIC_ADMIN_SECRET` |

> 专家任务 API 仍通过客户端持有的 `expertId` 标识身份（与原先一致）。生产环境请仅向受邀专家发放账号，并依赖 HTTPS（Vercel 默认提供）。

## 使用流程

1. **管理员**打开 `/admin`，用 `ADMIN_SECRET` 解锁；创建专家账号；粘贴 AI 输出并填写 `videoOutputId` 上传。
2. （可选）配置独占 / 共享号段。
3. **专家**打开 `/login`，使用管理员发放的姓名与密码登录。
4. 在 `/dashboard` 领取或打开任务，进入 `/tasks/[taskId]` 填写评分表并提交。
5. 管理员查看提交列表、全局指标、请求重评，或导出 CSV。

## 主要页面与 API

| 路径 | 说明 |
|------|------|
| `/login` | 专家登录 |
| `/dashboard` | 任务列表与领取 |
| `/tasks/[taskId]` | 单任务评分 |
| `/admin` | 管理后台（需解锁） |
| `/api/health` | 健康检查 |
| `/api/auth/login` | 专家登录 |
| `/api/tasks/*` | 任务查询、领取、提交评分 |
| `/api/admin/*` | 需管理员鉴权 |

## npm 脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发服务器 |
| `npm run build` | 生成 Client + migrate deploy + 生产构建 |
| `npm run start` | 生产启动 |
| `npm run lint` | ESLint |
| `npm run prisma:generate` | 生成 Prisma Client |
| `npm run db:deploy` | 生产迁移（`migrate deploy`） |
| `npm run db:push` | 将 schema 推送到数据库（开发快捷） |
| `npm run db:migrate` | Prisma migrate（开发） |

## 项目结构（简要）

```
src/
  app/                 # 页面与 API Routes
    admin/             # 管理后台
    dashboard/         # 专家仪表盘
    login/             # 登录
    tasks/[taskId]/   # 评分页
    api/               # REST API
  components/grading/  # 评分表单组件
  lib/                 # 解析器、评分 schema、分配逻辑、Prisma、adminAuth 等
prisma/
  schema.prisma        # 数据模型（PostgreSQL）
  migrations/          # 生产迁移
```

## 数据模型（概要）

- **Expert** — 专家账号  
- **AiOutput** — 按 `videoOutputId` 存储的 AI 原文与解析结果  
- **TaskAssignment** — 专家与 AI 输出的任务（`EXCLUSIVE` / `SHARED`，`PENDING` / `COMPLETED`）  
- **GradingResult** — 提交的评分 JSON  
- **AssignmentConfig** — 独占 / 共享视频号段配置  

## 研究背景

四级评估框架：

1. **Level 1** — 视觉感知与定位（术式、结构、器械、空间定位）  
2. **Level 2** — 时序工作流建模（阶段时间线、遗漏步骤）  
3. **Level 3** — 多模态临床推理（下一步操作、命名、安全）  
4. **Level 4** — OSATS 式细粒度技能评估（六维 1–5 分）  

详情与 AI 输出模板见 [`research_background.md`](./research_background.md)。

## 许可

私有项目（`package.json` 中 `"private": true`）。如需开源分发，请补充 LICENSE。
