#!/usr/bin/env node
/**
 * 接口端到端冒烟测试。
 * 用法：先启动后端（npm run dev:server 或 npm start），然后：
 *   node scripts/smoke.mjs --base http://localhost:3000
 *
 * 覆盖：登录与角色鉴权、无效选区、采纳乐观锁、选区位移、冲突转换、
 *       重复采纳拒绝、发布过期版本拒绝、旧发布不可变、正文差异数据。
 */

const base = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'http://localhost:3000';

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name} ${extra}`);
  }
}

async function raw(method, path, { cookie, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data, setCookie: res.headers.getSetCookie?.() ?? [] };
}

function sessionCookie(setCookie) {
  return setCookie.map((c) => c.split(';')[0]).join('; ');
}

async function expectFail(method, path, opts, status, keyword, label) {
  const r = await raw(method, path, opts);
  check(label, r.status === status && typeof r.data?.error === 'string' && r.data.error.includes(keyword),
    `got ${r.status} ${JSON.stringify(r.data)}`);
}

async function main() {
  console.log(`冒烟测试目标: ${base}`);

  // 0. 健康检查
  const health = await raw('GET', '/api/health');
  check('健康检查 200', health.status === 200 && health.data.ok === true);

  // 1. 登录
  const rLogin = await raw('POST', '/api/auth/login', { body: { username: 'reviewer', password: 'reviewer123' } });
  check('校核人登录成功', rLogin.status === 200 && rLogin.data.user.role === 'reviewer');
  const reviewerCookie = sessionCookie(rLogin.setCookie);

  const lLogin = await raw('POST', '/api/auth/login', { body: { username: 'librarian', password: 'librarian123' } });
  check('馆员登录成功', lLogin.status === 200 && lLogin.data.user.role === 'librarian');
  const librarianCookie = sessionCookie(lLogin.setCookie);

  await expectFail('POST', '/api/auth/login', { body: { username: 'reviewer', password: 'wrong' } },
    401, '密码', '错误密码被拒绝');

  // 2. 未登录 / 越权
  await expectFail('GET', '/api/labels', {}, 401, '登录', '未登录不能访问');
  await expectFail('POST', '/api/labels', { cookie: reviewerCookie, body: { title: 'x', body: 'y' } },
    403, '馆员', '校核人不能建展签');
  await expectFail('POST', '/api/labels/1/publish', { cookie: reviewerCookie, body: { expectedVersion: 1 } },
    403, '馆员', '校核人不能发布');

  // 3. 馆员为本次测试新建一个展签（自动产生第 1 次发布）
  const probeBody = '甲乙丙丁戊己庚辛壬癸';
  const created = await raw('POST', '/api/labels', {
    cookie: librarianCookie,
    body: { title: `冒烟测试展签 ${Date.now()}`, body: probeBody },
  });
  check('馆员创建展签', created.status === 201 && created.data.label.bodyVersion === 1);
  const labelId = created.data.label.id;

  // 4. 无效选区（校核人提交）
  await expectFail('POST', `/api/labels/${labelId}/suggestions`, {
    cookie: reviewerCookie,
    body: { startOffset: 3, endOffset: 3, replacement: 'x', reason: '依据' },
  }, 400, '空文字', '空选区被拒绝');
  await expectFail('POST', `/api/labels/${labelId}/suggestions`, {
    cookie: reviewerCookie,
    body: { startOffset: 0, endOffset: 999, replacement: 'x', reason: '依据' },
  }, 400, '超出', '越界选区被拒绝');
  await expectFail('POST', `/api/labels/${labelId}/suggestions`, {
    cookie: reviewerCookie,
    body: { startOffset: 0, endOffset: 2, replacement: 'x' },
  }, 400, '依据', '缺少依据被拒绝');
  await expectFail('POST', `/api/suggestions/1/adopt`, {
    cookie: reviewerCookie,
    body: { expectedVersion: 1 },
  }, 403, '馆员', '校核人不能采纳');

  // 5. 合法建议
  // 正文： 0甲 1乙 2丙 3丁 4戊 5己 6庚 7辛 8壬 9癸
  const mkSug = async (start, end, replacement, reason) =>
    raw('POST', `/api/labels/${labelId}/suggestions`, {
      cookie: reviewerCookie,
      body: { startOffset: start, endOffset: end, replacement, reason },
    });
  const s1 = await mkSug(1, 2, '乙丑', '依据一'); // 乙(1字符)->乙丑(2字符)，+1
  const s2 = await mkSug(4, 5, '戊辰X', '依据二'); // 戊 -> 戊辰X，+2，不重叠
  const s3 = await mkSug(6, 8, '替换', '依据三'); // 庚辛，与 s2 不重叠
  const sOverlap = await mkSug(2, 7, '乱', '重叠依据'); // 丙丁戊己庚，与 s2/s3 均重叠
  check('提交 4 条建议', [s1, s2, s3, sOverlap].every((r) => r.status === 201),
    JSON.stringify([s1.status, s2.status, s3.status, sOverlap.status]));
  const id1 = s1.data.suggestion.id;
  const id2 = s2.data.suggestion.id;
  const id3 = s3.data.suggestion.id;
  const idOverlap = sOverlap.data.suggestion.id;

  // 6. 不存在的建议不能采纳
  await expectFail('POST', '/api/suggestions/999999/adopt', {
    cookie: librarianCookie,
    body: { expectedVersion: 1 },
  }, 404, '不存在', '不存在的建议不能采纳');

  // 7. 正常采纳 s1：v1 -> v2；s2/s3/sOverlap 应随之后移 1 位
  const adopt1 = await raw('POST', `/api/suggestions/${id1}/adopt`, {
    cookie: librarianCookie,
    body: { expectedVersion: 1 },
  });
  check('采纳 s1 成功，正文升到 v2', adopt1.status === 201 && adopt1.data.bodyVersion === 2,
    JSON.stringify(adopt1.data));

  const after1 = await raw('GET', `/api/labels/${labelId}/suggestions`, { cookie: librarianCookie });
  const byId = Object.fromEntries(after1.data.suggestions.map((s) => [s.id, s]));
  check('s2 选区位移 +1（5..6，仍指向“戊”）',
    byId[id2].startOffset === 5 && byId[id2].endOffset === 6 && byId[id2].selectedText === '戊');
  check('s3 选区位移 +1（7..9，仍指向“庚辛”）',
    byId[id3].startOffset === 7 && byId[id3].endOffset === 9 && byId[id3].selectedText === '庚辛');
  check('sOverlap 选区位移 +1（3..8，仍指向“丙丁戊己庚”）',
    byId[idOverlap].startOffset === 3 && byId[idOverlap].endOffset === 8 &&
    byId[idOverlap].selectedText === '丙丁戊己庚');

  const labelAfter1 = (await raw('GET', `/api/labels/${labelId}`, { cookie: librarianCookie })).data.label;
  check('正文内容正确', labelAfter1.body === '甲乙丑丙丁戊己庚辛壬癸', labelAfter1.body);

  // 8. 用过期版本号（v1）再采纳 s2，必须 409
  await expectFail('POST', `/api/suggestions/${id2}/adopt`, {
    cookie: librarianCookie,
    body: { expectedVersion: 1 },
  }, 409, '过期', '过期版本采纳被拒绝');
  const unchanged = (await raw('GET', `/api/labels/${labelId}`, { cookie: librarianCookie })).data.label;
  check('拒绝后数据未改变（仍为 v2）', unchanged.bodyVersion === 2);

  // 9. 采纳 s2（v2 -> v3）：s3 继续位移 +2；sOverlap 与 s2 重叠 → 冲突
  const adopt2 = await raw('POST', `/api/suggestions/${id2}/adopt`, {
    cookie: librarianCookie,
    body: { expectedVersion: 2 },
  });
  check('采纳 s2 成功', adopt2.status === 201 && adopt2.data.bodyVersion === 3);
  check('重叠建议被标记冲突', adopt2.data.conflictedSuggestionIds.includes(idOverlap),
    JSON.stringify(adopt2.data));

  const after2 = await raw('GET', `/api/labels/${labelId}/suggestions`, { cookie: librarianCookie });
  const byId2 = Object.fromEntries(after2.data.suggestions.map((s) => [s.id, s]));
  check('s3 再位移 +2（9..11，仍指向“庚辛”）',
    byId2[id3].startOffset === 9 && byId2[id3].endOffset === 11 && byId2[id3].selectedText === '庚辛');
  check('sOverlap 状态 conflict 且记录来源',
    byId2[idOverlap].status === 'conflict' && byId2[idOverlap].conflictedById === id2);

  // 10. 重复采纳 / 采纳冲突建议
  await expectFail('POST', `/api/suggestions/${id1}/adopt`, {
    cookie: librarianCookie,
    body: { expectedVersion: 3 },
  }, 400, '已被采纳', '重复采纳被拒绝');
  await expectFail('POST', `/api/suggestions/${idOverlap}/adopt`, {
    cookie: librarianCookie,
    body: { expectedVersion: 3 },
  }, 409, '冲突', '冲突建议不可采纳');

  // 11. 采纳 s3（位移后仍指向原文，验证“继续指向原内容”）
  const adopt3 = await raw('POST', `/api/suggestions/${id3}/adopt`, {
    cookie: librarianCookie,
    body: { expectedVersion: 3 },
  });
  check('位移后的不重叠建议可正常采纳', adopt3.status === 201 && adopt3.data.bodyVersion === 4,
    JSON.stringify(adopt3.data));
  const finalBody = (await raw('GET', `/api/labels/${labelId}`, { cookie: librarianCookie })).data.label;
  check('最终正文 = 甲乙丑丙丁戊辰X己替换壬癸', finalBody.body === '甲乙丑丙丁戊辰X己替换壬癸', finalBody.body);

  // 12. 发布：过期版本拒绝
  await expectFail('POST', `/api/labels/${labelId}/publish`, {
    cookie: librarianCookie,
    body: { expectedVersion: 3, note: '' },
  }, 409, '过期', '过期版本发布被拒绝');

  const pubsBefore = (await raw('GET', `/api/labels/${labelId}/publications`, { cookie: librarianCookie })).data.publications;
  check('发布前只有初始第 1 次发布', pubsBefore.length === 1 && pubsBefore[0].version === 1);

  const pub2 = await raw('POST', `/api/labels/${labelId}/publish`, {
    cookie: librarianCookie,
    body: { expectedVersion: 4, note: '冒烟发布' },
  });
  check('发布第 2 次成功，快照=当前正文',
    pub2.status === 201 && pub2.data.publication.version === 2 &&
    pub2.data.publication.bodySnapshot === '甲乙丑丙丁戊辰X己替换壬癸' &&
    pub2.data.publication.adoptions.length === 3,
    JSON.stringify(pub2.data));

  // 13. 旧发布不可变：发布后再采纳（新建建议），第 1、2 次发布快照保持不变
  const sLate = await mkSug(0, 1, '〇', '发布后的新建议');
  await raw('POST', `/api/suggestions/${sLate.data.suggestion.id}/adopt`, {
    cookie: librarianCookie,
    body: { expectedVersion: 4 },
  });
  await raw('POST', `/api/labels/${labelId}/publish`, {
    cookie: librarianCookie,
    body: { expectedVersion: 5, note: '第三次' },
  });
  const pubsNow = (await raw('GET', `/api/labels/${labelId}/publications`, { cookie: librarianCookie })).data.publications;
  const firstPub = await raw('GET', `/api/publications/${pubsNow.find((p) => p.version === 1).id}`, { cookie: librarianCookie });
  const secondPub = await raw('GET', `/api/publications/${pubsNow.find((p) => p.version === 2).id}`, { cookie: librarianCookie });
  check('旧发布快照不可变',
    firstPub.data.publication.bodySnapshot === '甲乙丙丁戊己庚辛壬癸' &&
    secondPub.data.publication.bodySnapshot === '甲乙丑丙丁戊辰X己替换壬癸' &&
    firstPub.data.publication.adoptions.length === 0 &&
    secondPub.data.publication.adoptions.length === 3);

  // 14. 校核人不能访问发布动作但可以读发布历史
  const reviewerReadPubs = await raw('GET', `/api/labels/${labelId}/publications`, { cookie: reviewerCookie });
  check('校核人可查看发布历史', reviewerReadPubs.status === 200);

  console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项失败 ❌`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
