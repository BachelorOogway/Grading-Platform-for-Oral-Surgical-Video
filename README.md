# Oral Surgical Video Grading Platform

口腔颌面外科手术视频 AI 输出的**专家人工评分平台**。管理员上传 AI 结构化分析文本后，专家登录领取任务，按四级评估框架对 AI 结果进行人工校验与打分，并支持导出评分数据。

评估框架与 AI Prompt 说明见 [`research_background.md`](./research_background.md)。

## 功能概览

| 角色 | 能力 |
|------|------|
| **专家** | 登录 / 首次注册、查看与领取任务、填写四级评分表并提交、响应重评请求 |
| **管理员** | 上传 AI 输出、配置独占/共享视频号段、查看已提交评分、请求重评、导出 CSV |

任务分配规则（可在 `/admin` 调整）：

- **Exclusive（独占）**：默认视频号 `1–75`、`100–175`，每位专家独立领取
- **Shared（共享）**：默认视频号 `76–99`、`176–200`，可供多位专家评分以衡量一致性

## 技术栈

- **Next.js 15**（App Router）+ **React 18** + **TypeScript**
- **Prisma** + **SQLite**（本地开发默认）
- **Tailwind CSS** + **react-hook-form**
- **bcryptjs**（专家密码哈希）

## 快速开始

### 环境要求

- Node.js 18+（建议 20+）
- npm

### 安装与启动

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env

# 3. 生成 Prisma Client 并创建数据库
npm run prisma:generate
npm run db:push

# 4. 启动开发服务器
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。

### 环境变量

复制 `.env.example` 为 `.env`：

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | Prisma 数据库连接，默认 `file:./dev.db`（SQLite） |
| `ADMIN_SECRET` | 可选；保护部分管理端接口（如导出） |
| `NEXT_PUBLIC_ADMIN_SECRET` | 可选；前端管理页携带的同一密钥 |

本地开发可先留空管理员密钥。

## 使用流程

1. **管理员**打开 `/admin`，粘贴 AI 输出 Markdown，填写 `videoOutputId`（需能解析出视频编号）并上传。
2. （可选）在管理页配置独占 / 共享号段。
3. **专家**打开 `/login`：同名 + 正确密码登录；若首次使用该姓名，会自动创建账号（`EXP-001` 起）。
4. 在 `/dashboard` 领取或打开任务，进入 `/tasks/[taskId]` 对照 AI 输出填写评分表并提交。
5. 管理员可在管理页查看提交列表、请求重评，或调用导出接口下载结果。

## 主要页面与 API

| 路径 | 说明 |
|------|------|
| `/login` | 专家登录 |
| `/dashboard` | 任务列表与领取 |
| `/tasks/[taskId]` | 单任务评分 |
| `/admin` | 管理后台 |
| `/api/health` | 健康检查 |
| `/api/auth/login` | 登录 |
| `/api/tasks/*` | 任务查询、领取、提交评分 |
| `/api/admin/*` | 上传 AI 输出、分配配置、评分列表、重评、导出 |

## npm 脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发服务器 |
| `npm run build` | 生产构建 |
| `npm run start` | 生产启动 |
| `npm run lint` | ESLint |
| `npm run prisma:generate` | 生成 Prisma Client |
| `npm run db:push` | 将 schema 推送到数据库（无迁移文件时） |
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
  lib/                 # 解析器、评分 schema、分配逻辑、Prisma 等
prisma/
  schema.prisma        # 数据模型
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
