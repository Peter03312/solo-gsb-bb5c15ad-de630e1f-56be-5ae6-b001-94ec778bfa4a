# ---- 构建阶段 ----
FROM node:20-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 在无预编译二进制时需要本地编译工具
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# 先复制 workspace 清单，充分利用 Docker 层缓存
COPY package.json package-lock.json* ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm install

# 复制源码并构建前后端
COPY server ./server
COPY client ./client
RUN npm run build

# ---- 运行阶段 ----
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV DB_FILE=/data/app.sqlite
ENV PORT=3000

# 复制依赖（含 better-sqlite3 原生模块）与构建产物
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/client/node_modules ./client/node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/client/package.json ./client/package.json

# 数据库持久化目录（首次启动自动建表并写入种子数据）
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
