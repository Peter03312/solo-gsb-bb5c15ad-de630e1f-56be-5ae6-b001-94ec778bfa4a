/** 携带 HTTP 状态码的业务错误，消息会直接展示给用户 */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'HttpError';
  }
}

export function badRequest(message: string): never {
  throw new HttpError(400, message);
}

export function notFound(message = '资源不存在。'): never {
  throw new HttpError(404, message);
}

export function conflict(message: string): never {
  throw new HttpError(409, message);
}

export function isString(v: unknown): v is string {
  return typeof v === 'string';
}

export function isInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

export function strField(body: Record<string, unknown>, key: string, maxLen: number): string {
  const v = body[key];
  if (!isString(v)) badRequest(`字段“${key}”必须为文本。`);
  const trimmed = v.trim();
  if (!trimmed) badRequest(`字段“${key}”不能为空。`);
  if (v.length > maxLen) badRequest(`字段“${key}”长度不能超过 ${maxLen} 个字符。`);
  return v;
}

export function intField(body: Record<string, unknown>, key: string): number {
  const v = body[key];
  if (!isInteger(v) || v < 1) badRequest(`字段“${key}”必须为不小于 1 的整数。`);
  return v;
}
