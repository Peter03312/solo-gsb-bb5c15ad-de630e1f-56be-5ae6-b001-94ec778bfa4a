import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getDB } from './db.js';
import { loadUser } from './auth.js';
import { authRouter } from './routes-auth.js';
import { apiRouter } from './routes-api.js';
import { HttpError } from './http.js';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(loadUser);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});
app.use('/api/auth', authRouter);
app.use('/api', apiRouter);

/** 统一错误处理：业务错误原样返回原因，其余返回 500 */
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err && typeof err === 'object' && 'type' in err && (err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: '请求体不是合法的 JSON。' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: '服务器内部错误。' });
};
app.use(errorHandler);

/* 生产环境托管前端构建产物（Docker 镜像内） */
const clientDist = process.env.CLIENT_DIST || join(__dirname, '..', '..', 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  const spaFallback: RequestHandler = (req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.sendFile(join(clientDist, 'index.html'));
  };
  app.use(spaFallback);
} else {
  app.use('/', (_req, res) => {
    res
      .status(200)
      .json({ ok: true, message: 'API 运行中。前端开发服务器请访问 Vite（默认 http://localhost:5173）。' });
  });
}

const port = Number(process.env.PORT || 3000);
// 启动时初始化数据库（建表 + 种子账号/数据）
getDB();
app.listen(port, '0.0.0.0', () => {
  console.log(`展签校核服务已启动: http://0.0.0.0:${port}`);
  console.log(`数据库文件: ${process.env.DB_FILE || '/data/app.sqlite'}`);
});
