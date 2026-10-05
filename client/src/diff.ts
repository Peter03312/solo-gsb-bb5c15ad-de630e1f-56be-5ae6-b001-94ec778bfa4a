/**
 * 中文友好的轻量正文差异（LCS）。
 * 分词：连续的拉丁字母/数字/下划线合为一个 token，其余每个字符（含中文、空白、标点）各成一个 token。
 */

export type DiffOp = 'equal' | 'insert' | 'delete';
export interface DiffPart {
  op: DiffOp;
  text: string;
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const latin = /[A-Za-z0-9_]/;
  let buf = '';
  for (const ch of text) {
    if (latin.test(ch)) {
      buf += ch;
    } else {
      if (buf) {
        tokens.push(buf);
        buf = '';
      }
      tokens.push(ch);
    }
  }
  if (buf) tokens.push(buf);
  return tokens;
}

/** 超长文本（如粘贴整段）退化为整体替换，避免 O(n*m) 过大 */
const LCS_LIMIT = 4000;

export function diffText(oldText: string, newText: string): DiffPart[] {
  const a = tokenize(oldText);
  const b = tokenize(newText);

  if (a.length === 0 && b.length === 0) return [];
  if (a.length + b.length > LCS_LIMIT) {
    return [
      ...(oldText ? [{ op: 'delete' as const, text: oldText }] : []),
      ...(newText ? [{ op: 'insert' as const, text: newText }] : []),
    ];
  }

  const n = a.length;
  const m = b.length;
  // dp[i][j] = a[i:] 与 b[j:] 的 LCS 长度
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const parts: DiffPart[] = [];
  const push = (op: DiffOp, text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.op === op) last.text += text;
    else parts.push({ op, text });
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('equal', a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('delete', a[i]);
      i++;
    } else {
      push('insert', b[j]);
      j++;
    }
  }
  while (i < n) {
    push('delete', a[i]);
    i++;
  }
  while (j < m) {
    push('insert', b[j]);
    j++;
  }
  return parts;
}
