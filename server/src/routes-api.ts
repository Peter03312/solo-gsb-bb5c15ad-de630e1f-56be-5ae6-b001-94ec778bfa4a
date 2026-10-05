import { Router } from 'express';
import type Database from 'better-sqlite3';
import { getDB } from './db.js';
import { requireAuth, requireRole, type AuthUser } from './auth.js';
import {
  badRequest,
  conflict,
  intField,
  isInteger,
  notFound,
  strField,
} from './http.js';

export const apiRouter = Router();

apiRouter.use(requireAuth);

const MAX_TITLE = 200;
const MAX_BODY = 20_000;
const MAX_REASON = 2_000;
const MAX_REPLACEMENT = 5_000;
const MAX_NOTE = 500;

/* ---------------- 行映射 ---------------- */

interface LabelRow {
  id: number;
  title: string;
  body: string;
  body_version: number;
  created_at: string;
  updated_at: string;
}

interface LabelView {
  id: number;
  title: string;
  body: string;
  bodyVersion: number;
  createdAt: string;
  updatedAt: string;
  pendingCount: number;
  adoptedCount: number;
  conflictCount: number;
  lastPublicationVersion: number | null;
}

function getLabelOrThrow(db: Database.Database, id: number): LabelRow {
  const row = db.prepare(`SELECT * FROM labels WHERE id = ?`).get(id) as LabelRow | undefined;
  if (!row) notFound('展签不存在。');
  return row;
}

function mapLabel(db: Database.Database, row: LabelRow): LabelView {
  const counts = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END)  AS pending,
         SUM(CASE WHEN status='adopted' THEN 1 ELSE 0 END)  AS adopted,
         SUM(CASE WHEN status='conflict' THEN 1 ELSE 0 END) AS conflict
       FROM suggestions WHERE label_id = ?`,
    )
    .get(row.id) as { pending: number | null; adopted: number | null; conflict: number | null };
  const lastPub = db
    .prepare(`SELECT MAX(version) AS v FROM publications WHERE label_id = ?`)
    .get(row.id) as { v: number | null };
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    bodyVersion: row.body_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pendingCount: counts.pending ?? 0,
    adoptedCount: counts.adopted ?? 0,
    conflictCount: counts.conflict ?? 0,
    lastPublicationVersion: lastPub.v ?? null,
  };
}

/* ---------------- 展签 ---------------- */

apiRouter.get('/labels', (_req, res) => {
  const db = getDB();
  const rows = db
    .prepare(`SELECT * FROM labels ORDER BY id ASC`)
    .all() as LabelRow[];
  res.json({ labels: rows.map((r) => mapLabel(db, r)) });
});

apiRouter.get('/labels/:id', (req, res) => {
  const db = getDB();
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) notFound('展签不存在。');
  res.json({ label: mapLabel(db, getLabelOrThrow(db, id)) });
});

apiRouter.post('/labels', requireRole('librarian'), (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const title = strField(body, 'title', MAX_TITLE).trim();
  const text = strField(body, 'body', MAX_BODY);
  if (!title) badRequest('展签标题不能为空。');
  const db = getDB();
  const user = req.user as AuthUser;

  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO labels (title, body, body_version, created_by)
         VALUES (?, ?, 1, ?)`,
      )
      .run(title, text, user.id);
    const labelId = Number(info.lastInsertRowid);
    db.prepare(
      `INSERT INTO publications (label_id, publisher_id, version, body_version, body_snapshot, note)
       VALUES (?, ?, 1, 1, ?, '初始导入版本')`,
    ).run(labelId, user.id, text);
    return labelId;
  });
  const labelId = tx();
  res.status(201).json({ label: mapLabel(db, getLabelOrThrow(db, labelId)) });
});

/* ---------------- 建议 ---------------- */

interface SuggestionView {
  id: number;
  labelId: number;
  creatorId: number;
  creatorName: string;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  replacement: string;
  reason: string;
  status: 'pending' | 'adopted' | 'conflict';
  createdVersion: number;
  createdAt: string;
  adoptedAt: string | null;
  adoptedByName: string | null;
  conflictedById: number | null;
  conflictedAt: string | null;
}

function mapSuggestion(s: Record<string, unknown>): SuggestionView {
  return {
    id: s.id as number,
    labelId: s.label_id as number,
    creatorId: s.creator_id as number,
    creatorName: s.creator_name as string,
    startOffset: s.start_offset as number,
    endOffset: s.end_offset as number,
    selectedText: s.selected_text as string,
    replacement: s.replacement as string,
    reason: s.reason as string,
    status: s.status as SuggestionView['status'],
    createdVersion: s.created_version as number,
    createdAt: s.created_at as string,
    adoptedAt: (s.adopted_at as string | null) ?? null,
    adoptedByName: (s.adopter_name as string | null) ?? null,
    conflictedById: (s.conflicted_by as number | null) ?? null,
    conflictedAt: (s.conflicted_at as string | null) ?? null,
  };
}

const SUGGESTION_SELECT = `
  SELECT s.*, u.display_name AS creator_name, au.display_name AS adopter_name
  FROM suggestions s
  JOIN users u ON u.id = s.creator_id
  LEFT JOIN users au ON au.id = s.adopted_by
`;

apiRouter.get('/labels/:id/suggestions', (req, res) => {
  const db = getDB();
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) notFound('展签不存在。');
  getLabelOrThrow(db, id);
  const rows = db
    .prepare(`${SUGGESTION_SELECT} WHERE s.label_id = ? ORDER BY s.id ASC`)
    .all(id) as Record<string, unknown>[];
  res.json({ suggestions: rows.map(mapSuggestion) });
});

apiRouter.post('/labels/:id/suggestions', requireRole('reviewer'), (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const labelId = Number(req.params.id);
  if (!Number.isInteger(labelId) || labelId < 1) notFound('展签不存在。');

  const start = body.startOffset;
  const end = body.endOffset;
  const replacement = body.replacement;
  const reason = body.reason;

  if (!isInteger(start) || !isInteger(end)) badRequest('选区偏移量必须为整数。');
  if (start < 0) badRequest('无效选区：起始位置不能为负数。');
  if (end <= start) badRequest('无效选区：结束位置必须大于起始位置（不能选择空文字）。');
  if (typeof replacement !== 'string')
    badRequest('替换文本必须为文本字符串（可以为空字符串，表示删除所选文字）。');
  if (replacement.length > MAX_REPLACEMENT)
    badRequest(`替换文本长度不能超过 ${MAX_REPLACEMENT} 个字符。`);
  if (typeof reason !== 'string' || !reason.trim()) badRequest('请填写校核依据。');
  if (reason.length > MAX_REASON) badRequest(`校核依据长度不能超过 ${MAX_REASON} 个字符。`);

  const db = getDB();
  const label = getLabelOrThrow(db, labelId);
  if (end > label.body.length) {
    badRequest(
      `无效选区：结束位置 ${end} 超出当前正文长度 ${label.body.length}，请刷新后重新选择正文文字。`,
    );
  }
  const selectedText = label.body.slice(start, end);

  const info = db
    .prepare(
      `INSERT INTO suggestions
         (label_id, creator_id, start_offset, end_offset, selected_text, replacement, reason, created_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      labelId,
      (req.user as AuthUser).id,
      start,
      end,
      selectedText,
      replacement,
      reason.trim(),
      label.body_version,
    );

  const row = db
    .prepare(`${SUGGESTION_SELECT} WHERE s.id = ?`)
    .get(Number(info.lastInsertRowid)) as Record<string, unknown>;
  res.status(201).json({ suggestion: mapSuggestion(row) });
});

/* ---------------- 采纳 ---------------- */

apiRouter.post('/suggestions/:suggestionId/adopt', requireRole('librarian'), (req, res) => {
  const suggestionId = Number(req.params.suggestionId);
  if (!Number.isInteger(suggestionId) || suggestionId < 1) notFound('建议不存在。');
  const body = (req.body ?? {}) as Record<string, unknown>;
  const expectedVersion = intField(body, 'expectedVersion');
  const user = req.user as AuthUser;
  const db = getDB();

  const tx = db.transaction((): { labelId: number; bodyVersion: number; conflictedIds: number[] } => {
    const s = db
      .prepare(`SELECT * FROM suggestions WHERE id = ?`)
      .get(suggestionId) as
      | {
          id: number;
          label_id: number;
          creator_id: number;
          start_offset: number;
          end_offset: number;
          selected_text: string;
          replacement: string;
          status: string;
          created_version: number;
        }
      | undefined;
    if (!s) notFound('建议不存在。');
    const label = getLabelOrThrow(db, s.label_id);

    if (label.body_version !== expectedVersion) {
      conflict(
        `审批所见版本已过期：您看到的是第 ${expectedVersion} 版正文，当前已是第 ${label.body_version} 版，请刷新后重新审批，以免覆盖并发改动。`,
      );
    }
    if (s.status === 'adopted') badRequest('该建议此前已被采纳，不能重复采纳。');
    if (s.status === 'conflict') {
      conflict('该建议已因与其它采纳的选区重叠而转为冲突，不能再采纳。');
    }
    // 建议可能基于更早的正文版本提交，但不重叠的选区已随文字位移；
    // 这里以“当前偏移截取的原文与提交时一致”作为选区仍然有效的判据。
    if (s.start_offset < 0 || s.end_offset > label.body.length || s.end_offset <= s.start_offset) {
      badRequest('无效选区：该建议的选区在当前正文中已越界，无法采纳。');
    }
    const actual = label.body.slice(s.start_offset, s.end_offset);
    if (actual !== s.selected_text) {
      conflict(
        '选区文字已与提交时不一致（已被其他改动影响），本次采纳已拒绝，请刷新查看最新正文。',
      );
    }

    const newBody =
      label.body.slice(0, s.start_offset) +
      s.replacement +
      label.body.slice(s.end_offset);
    const delta = s.replacement.length - (s.end_offset - s.start_offset);
    const toVersion = label.body_version + 1;
    const nowStmt = db.prepare(`SELECT datetime('now') AS now`).get() as { now: string };

    // 1) 与本次选区重叠的其它待审建议 → 冲突
    const overlapped = db
      .prepare(
        `SELECT id FROM suggestions
         WHERE label_id = ? AND status = 'pending' AND id <> ?
           AND start_offset < ? AND end_offset > ?`,
      )
      .all(s.label_id, s.id, s.end_offset, s.start_offset) as { id: number }[];
    const conflictedIds = overlapped.map((o) => o.id);
    const markConflict = db.prepare(
      `UPDATE suggestions SET status = 'conflict', conflicted_by = ?, conflicted_at = ? WHERE id = ?`,
    );
    for (const cid of conflictedIds) markConflict.run(s.id, nowStmt.now, cid);

    // 2) 不重叠的待审建议随文字位移：选区在采纳点之后的整体平移
    const shiftStmt = db.prepare(
      `UPDATE suggestions
         SET start_offset = start_offset + ?, end_offset = end_offset + ?
       WHERE label_id = ? AND status = 'pending' AND id <> ? AND start_offset >= ?`,
    );
    if (delta !== 0) {
      shiftStmt.run(delta, delta, s.label_id, s.id, s.end_offset);
    }

    // 3) 采纳当前建议并写入采纳记录
    db.prepare(
      `UPDATE suggestions SET status = 'adopted', adopted_at = ?, adopted_by = ? WHERE id = ?`,
    ).run(nowStmt.now, user.id, s.id);
    db.prepare(
      `UPDATE labels SET body = ?, body_version = ?, updated_at = ? WHERE id = ?`,
    ).run(newBody, toVersion, nowStmt.now, label.id);
    db.prepare(
      `INSERT INTO adoptions
         (label_id, suggestion_id, adopter_id, from_version, to_version, start_offset, end_offset, old_text, new_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      s.label_id,
      s.id,
      user.id,
      s.created_version,
      toVersion,
      s.start_offset,
      s.end_offset,
      s.selected_text,
      s.replacement,
    );

    return { labelId: s.label_id, bodyVersion: toVersion, conflictedIds };
  });

  const result = tx();
  res.status(201).json({
    ok: true,
    labelId: result.labelId,
    bodyVersion: result.bodyVersion,
    conflictedSuggestionIds: result.conflictedIds,
  });
});

interface AdoptionView {
  id: number;
  labelId: number;
  suggestionId: number;
  adopterId: number;
  adopterName: string;
  fromVersion: number;
  toVersion: number;
  startOffset: number;
  endOffset: number;
  oldText: string;
  newText: string;
  appliedAt: string;
}

apiRouter.get('/labels/:id/adoptions', (req, res) => {
  const db = getDB();
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) notFound('展签不存在。');
  getLabelOrThrow(db, id);
  const rows = db
    .prepare(
      `SELECT a.*, u.display_name AS adopter_name
       FROM adoptions a JOIN users u ON u.id = a.adopter_id
       WHERE a.label_id = ? ORDER BY a.id ASC`,
    )
    .all(id) as Record<string, unknown>[];
  const adoptions: AdoptionView[] = rows.map((a) => ({
    id: a.id as number,
    labelId: a.label_id as number,
    suggestionId: a.suggestion_id as number,
    adopterId: a.adopter_id as number,
    adopterName: a.adopter_name as string,
    fromVersion: a.from_version as number,
    toVersion: a.to_version as number,
    startOffset: a.start_offset as number,
    endOffset: a.end_offset as number,
    oldText: a.old_text as string,
    newText: a.new_text as string,
    appliedAt: a.applied_at as string,
  }));
  res.json({ adoptions });
});

/* ---------------- 发布 ---------------- */

interface PublicationView {
  id: number;
  labelId: number;
  version: number;
  bodyVersion: number;
  note: string;
  publisherId: number;
  publisherName: string;
  publishedAt: string;
  bodySnapshot?: string;
  adoptions?: AdoptionView[];
  adoptionCount: number;
}

function mapPublication(p: Record<string, unknown>, adoptionCount: number): PublicationView {
  return {
    id: p.id as number,
    labelId: p.label_id as number,
    version: p.version as number,
    bodyVersion: p.body_version as number,
    note: p.note as string,
    publisherId: p.publisher_id as number,
    publisherName: p.publisher_name as string,
    publishedAt: p.published_at as string,
    bodySnapshot: p.body_snapshot as string | undefined,
    adoptionCount,
  };
}

function adoptionsForPublication(db: Database.Database, publicationId: number): AdoptionView[] {
  const rows = db
    .prepare(
      `SELECT a.*, u.display_name AS adopter_name
       FROM publication_adoptions pa
       JOIN adoptions a ON a.id = pa.adoption_id
       JOIN users u ON u.id = a.adopter_id
       WHERE pa.publication_id = ?
       ORDER BY a.id ASC`,
    )
    .all(publicationId) as Record<string, unknown>[];
  return rows.map((a) => ({
    id: a.id as number,
    labelId: a.label_id as number,
    suggestionId: a.suggestion_id as number,
    adopterId: a.adopter_id as number,
    adopterName: a.adopter_name as string,
    fromVersion: a.from_version as number,
    toVersion: a.to_version as number,
    startOffset: a.start_offset as number,
    endOffset: a.end_offset as number,
    oldText: a.old_text as string,
    newText: a.new_text as string,
    appliedAt: a.applied_at as string,
  }));
}

apiRouter.get('/labels/:id/publications', (req, res) => {
  const db = getDB();
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) notFound('展签不存在。');
  getLabelOrThrow(db, id);
  const rows = db
    .prepare(
      `SELECT p.*, u.display_name AS publisher_name
       FROM publications p JOIN users u ON u.id = p.publisher_id
       WHERE p.label_id = ? ORDER BY p.version DESC`,
    )
    .all(id) as Record<string, unknown>[];
  const countStmt = db.prepare(
    `SELECT COUNT(*) AS n FROM publication_adoptions WHERE publication_id = ?`,
  );
  const publications = rows.map((p) =>
    mapPublication(
      p,
      (countStmt.get(p.id as number) as { n: number }).n,
    ),
  );
  res.json({ publications });
});

apiRouter.get('/publications/:publicationId', (req, res) => {
  const db = getDB();
  const publicationId = Number(req.params.publicationId);
  if (!Number.isInteger(publicationId) || publicationId < 1) notFound('发布版本不存在。');
  const row = db
    .prepare(
      `SELECT p.*, u.display_name AS publisher_name
       FROM publications p JOIN users u ON u.id = p.publisher_id
       WHERE p.id = ?`,
    )
    .get(publicationId) as Record<string, unknown> | undefined;
  if (!row) notFound('发布版本不存在。');
  const view = mapPublication(row, 0);
  view.adoptions = adoptionsForPublication(db, publicationId);
  view.adoptionCount = view.adoptions.length;
  res.json({ publication: view });
});

apiRouter.post('/labels/:id/publish', requireRole('librarian'), (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const labelId = Number(req.params.id);
  if (!Number.isInteger(labelId) || labelId < 1) notFound('展签不存在。');
  const expectedVersion = intField(body, 'expectedVersion');
  const note =
    typeof body.note === 'string'
      ? body.note.trim().slice(0, MAX_NOTE)
      : '';
  const user = req.user as AuthUser;
  const db = getDB();

  const tx = db.transaction((): PublicationView => {
    const label = getLabelOrThrow(db, labelId);
    if (label.body_version !== expectedVersion) {
      conflict(
        `发布所依据的版本已过期：当前正文为第 ${label.body_version} 版，您提交的是第 ${expectedVersion} 版，请刷新确认后再发布。`,
      );
    }
    const last = db
      .prepare(`SELECT COALESCE(MAX(version), 0) AS v FROM publications WHERE label_id = ?`)
      .get(labelId) as { v: number };
    const info = db
      .prepare(
        `INSERT INTO publications (label_id, publisher_id, version, body_version, body_snapshot, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(labelId, user.id, last.v + 1, label.body_version, label.body, note);
    const publicationId = Number(info.lastInsertRowid);

    // 固化本次发布包含的采纳记录（上次发布之后产生、尚未归入任何发布的采纳）
    const pendingAdoptions = db
      .prepare(
        `SELECT a.id FROM adoptions a
         WHERE a.label_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM publication_adoptions pa WHERE pa.adoption_id = a.id
           )
         ORDER BY a.id ASC`,
      )
      .all(labelId) as { id: number }[];
    const link = db.prepare(
      `INSERT OR IGNORE INTO publication_adoptions (publication_id, adoption_id) VALUES (?, ?)`,
    );
    for (const a of pendingAdoptions) link.run(publicationId, a.id);

    const row = db
      .prepare(
        `SELECT p.*, u.display_name AS publisher_name
         FROM publications p JOIN users u ON u.id = p.publisher_id
         WHERE p.id = ?`,
      )
      .get(publicationId) as Record<string, unknown>;
    const view = mapPublication(row, pendingAdoptions.length);
    view.bodySnapshot = label.body;
    view.adoptions = adoptionsForPublication(db, publicationId);
    return view;
  });

  const publication = tx();
  res.status(201).json({ publication });
});
