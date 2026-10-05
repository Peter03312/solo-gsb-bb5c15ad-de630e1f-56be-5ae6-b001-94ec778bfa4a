# 展览展签校核 Web 应用

一个用于博物馆/展览馆展签文字校核与审批发布的 Web 应用。

- **技术栈**：TypeScript · React 18（Vite）· Node.js（Express）· SQLite（better-sqlite3）
- **两种本地账号角色**
  - **校核人（reviewer）**：选中当前展签正文的连续文字，提交替换文本与校核依据；
  - **馆员（librarian）**：查看建议、按正文版本逐条采纳、处理冲突、固化发布、对比两次发布正文差异。

## 功能与业务规则

### 建议
- 校核人在展签正文上用鼠标框选**连续文字**，填写「替换文本」（留空表示删除）和「校核依据」后提交。
- 选区以 **JavaScript 字符串偏移（UTF-16 码元）** 记录，提交时服务端二次校验：必须是当前正文内的非空连续区间，且按偏移重新截取的原文必须与提交一致，否则拒绝并说明原因（空选区、越界、版本不符等）。

### 采纳（每次只改动对应选区）
- 馆员采纳时必须携带「审批所见的正文版本号」`expectedVersion`；与当前版本不一致时**直接拒绝（HTTP 409）**，不会覆盖并发改动，页面会提示刷新重新审批。
- 每次采纳在一个 SQLite 事务中完成：
  1. 仅替换该建议选区的文字，正文版本号 +1，写入不可变的采纳记录；
  2. **不重叠**的其它待审建议随文字位移：选区起点在采纳点之后的，起止偏移整体平移，继续指向原来的内容；
  3. **重叠**（含交叉、包含）的待审建议自动转为「冲突」，记录由哪条采纳触发，停止采纳；
  4. 采纳前再次校验选区原文是否与提交时一致，防止并发改动导致误改。
- 已采纳的建议不能重复采纳；冲突建议不能再采纳；未登录或角色不符的操作返回 401/403 并显示原因，均不改变数据。

### 发布
- 馆员发布时固化当前正文的**不可变快照**，同时把自上次发布以来的全部采纳记录归档到该次发布。
- 发布同样进行乐观锁版本校验，过期则拒绝。
- 旧发布只能查看，**任何后续编辑都不会改写旧发布的正文和采纳记录**。
- 「发布与差异」页可任选两次发布，查看正文差异（中文友好的逐字 LCS diff，删除/新增高亮），以及该次发布固化的采纳清单。

## 一键启动（Docker Compose，推荐）

前置：已安装 Docker 与 Docker Compose 插件。

```bash
docker compose up -d --build
```

启动后打开：

- 应用地址：<http://localhost:3000>
- 健康检查：<http://localhost:3000/api/health>

数据库存放在宿主机 `./data` 目录（容器内 `/data/app.sqlite`，SQLite WAL 模式），首次启动自动建表、写入演示账号和示例展签。

停止 / 重置：

```bash
docker compose down            # 停止（数据保留在 ./data）
rm -rf ./data && docker compose up -d --build   # 删除数据目录即重置全部数据
```

## 本地开发（不用 Docker）

前置：Node.js ≥ 20。

```bash
npm install                 # 安装全部 workspace 依赖（根目录执行）

# 终端 1：后端（http://localhost:3000，tsx 热重载）
npm run dev:server

# 终端 2：前端 Vite 开发服务器（http://localhost:5173，/api 自动代理到 3000）
npm run dev:client
```

本地构建并以生产方式启动（Express 同时托管前端产物与 API）：

```bash
npm run build
DB_FILE=./data/app.sqlite npm start
# 打开 http://localhost:3000
```

接口端到端冒烟测试（需先启动后端，会创建临时建议/采纳但不影响种子账号）：

```bash
npm run smoke -- --base http://localhost:3000
```

## 演示账号

| 角色 | 用户名 | 密码 |
| --- | --- | --- |
| 校核人 | `reviewer` | `reviewer123` |
| 馆员 | `librarian` | `librarian123` |

首次启动同时写入 2 条含常见文字问题的示例展签（错别字、异体/误用等），可直接登录校核人账号框选练习。

## 配置（环境变量）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 后端监听端口 |
| `DB_FILE` | `/data/app.sqlite`（镜像内）/ `./data/app.sqlite`（建议本地） | SQLite 数据库文件路径，目录会自动创建 |
| `AUTH_SECRET` | `dev-secret-change-me` | 登录 Cookie（HMAC-SHA256 签名）密钥，**生产部署必须修改**，可用 `openssl rand -hex 32` 生成 |
| `COOKIE_SECURE` | `false` | 仅在通过 HTTPS 提供服务时设为 `true` |
| `CLIENT_DIST` | `client/dist` | 生产模式托管的前端构建产物目录 |

Docker Compose 的配置直接写在 `docker-compose.yml` 的 `environment` 中，按需修改后重新 `docker compose up -d`。

## 页面地址与端口

| 地址 | 说明 |
| --- | --- |
| <http://localhost:3000/> | 生产部署入口（登录页、前端单页应用） |
| <http://localhost:3000/login> | 登录页 |
| <http://localhost:3000/labels> | 展签列表（两种角色均可访问） |
| <http://localhost:3000/labels/1> | 展签详情：正文、建议、采纳记录、发布与差异 |
| <http://localhost:5173/> | 本地开发时 Vite 前端地址（API 代理到 3000） |

## 主要 HTTP API

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/auth/login` / `/api/auth/logout` | - | 登录 / 退出（HttpOnly Cookie） |
| GET | `/api/auth/me` | 已登录 | 当前用户 |
| GET | `/api/labels` | 已登录 | 展签列表及各状态计数 |
| POST | `/api/labels` | 馆员 | 新建展签（自动生成第 1 次发布） |
| GET | `/api/labels/:id/suggestions` | 已登录 | 建议列表 |
| POST | `/api/labels/:id/suggestions` | 校核人 | 提交建议（校验选区/版本） |
| POST | `/api/suggestions/:sid/adopt` | 馆员 | 采纳，body：`{ expectedVersion }` |
| GET | `/api/labels/:id/adoptions` | 已登录 | 采纳记录 |
| GET | `/api/labels/:id/publications` | 已登录 | 发布历史 |
| GET | `/api/publications/:id` | 已登录 | 某次发布快照及归档的采纳 |
| POST | `/api/labels/:id/publish` | 馆员 | 固化发布，body：`{ expectedVersion, note }` |

错误时统一返回 `{ "error": "原因" }`：参数/选区问题为 400，未登录 401，角色不符 403，版本过期 409。

## 目录结构

```
.
├── Dockerfile              # 多阶段构建（前端构建 + Node 运行镜像）
├── docker-compose.yml      # 一键启动 + 数据卷 + 环境变量
├── server/                 # Express + better-sqlite3 后端
│   └── src/
│       ├── db.ts           # 建表、索引、种子数据、口令哈希
│       ├── auth.ts         # Cookie 签名与角色中间件
│       ├── routes-auth.ts  # 登录/退出/当前用户
│       ├── routes-api.ts   # 展签/建议/采纳/发布全部业务（事务）
│       └── index.ts        # 入口、静态托管、错误处理
├── client/                 # React + Vite 前端
│   └── src/
│       ├── pages/          # 登录、展签列表、展签详情
│       ├── components/     # 正文高亮/选择、建议卡、发布差异面板等
│       ├── selection.ts    # 浏览器 Selection ↔ 字符串偏移
│       └── diff.ts         # 中文友好的 LCS 正文差异
└── scripts/smoke.mjs       # 接口端到端冒烟测试
```
