import Database from 'better-sqlite3';
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface DB {
  conn: Database.Database;
}

/** 角色 */
export type Role = 'reviewer' | 'librarian';

let _db: Database.Database | null = null;

export function getDB(): Database.Database {
  if (_db) return _db;
  const file = process.env.DB_FILE || '/data/app.sqlite';
  mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  seed(db);
  _db = db;
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      display_name  TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL CHECK (role IN ('reviewer','librarian')),
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS labels (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      title        TEXT NOT NULL,
      body         TEXT NOT NULL,
      body_version INTEGER NOT NULL DEFAULT 1,
      created_by   INTEGER NOT NULL REFERENCES users(id),
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS suggestions (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      label_id          INTEGER NOT NULL REFERENCES labels(id),
      creator_id        INTEGER NOT NULL REFERENCES users(id),
      start_offset      INTEGER NOT NULL,
      end_offset        INTEGER NOT NULL,
      selected_text     TEXT NOT NULL,
      replacement       TEXT NOT NULL,
      reason            TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','adopted','conflict')),
      created_version   INTEGER NOT NULL,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      adopted_at        TEXT,
      adopted_by        INTEGER REFERENCES users(id),
      conflicted_by     INTEGER REFERENCES suggestions(id),
      conflicted_at     TEXT,
      CHECK (start_offset >= 0 AND end_offset > start_offset)
    );

    CREATE TABLE IF NOT EXISTS adoptions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      label_id      INTEGER NOT NULL REFERENCES labels(id),
      suggestion_id INTEGER NOT NULL REFERENCES suggestions(id),
      adopter_id    INTEGER NOT NULL REFERENCES users(id),
      from_version  INTEGER NOT NULL,
      to_version    INTEGER NOT NULL,
      start_offset  INTEGER NOT NULL,
      end_offset    INTEGER NOT NULL,
      old_text      TEXT NOT NULL,
      new_text      TEXT NOT NULL,
      applied_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS publications (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      label_id      INTEGER NOT NULL REFERENCES labels(id),
      publisher_id  INTEGER NOT NULL REFERENCES users(id),
      version       INTEGER NOT NULL,
      body_version  INTEGER NOT NULL,
      body_snapshot TEXT NOT NULL,
      note          TEXT NOT NULL DEFAULT '',
      published_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (label_id, version)
    );

    CREATE TABLE IF NOT EXISTS publication_adoptions (
      publication_id INTEGER NOT NULL REFERENCES publications(id),
      adoption_id    INTEGER NOT NULL REFERENCES adoptions(id),
      PRIMARY KEY (publication_id, adoption_id)
    );

    CREATE INDEX IF NOT EXISTS idx_suggestions_label ON suggestions(label_id);
    CREATE INDEX IF NOT EXISTS idx_adoptions_label ON adoptions(label_id);
    CREATE INDEX IF NOT EXISTS idx_publications_label ON publications(label_id);
  `);
}

/** scrypt 口令哈希：`scrypt$salt$hex` */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hashHex) return false;
  const hash = scryptSync(password, salt, 64).toString('hex');
  return hash.length === hashHex.length && timingSafeEqualHex(hash, hashHex);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

interface SeedUser {
  username: string;
  displayName: string;
  password: string;
  role: Role;
}

const SEED_USERS: SeedUser[] = [
  { username: 'reviewer', displayName: '校核人甲', password: 'reviewer123', role: 'reviewer' },
  { username: 'librarian', displayName: '馆员乙', password: 'librarian123', role: 'librarian' },
];

const SEED_LABELS: { title: string; body: string }[] = [
  {
    title: '青花缠枝莲纹罐',
    body: '青花缠枝莲纹罐，烧制于明代永乐年间，高三十二厘米，口径十五厘米。器身以苏麻离青料绘缠枝莲纹，发色浓艳，铁锈斑明显。近底处饰莲瓣纹一周，釉面莹润，胎质洁白。此类型器多见於当时朝庭赏赐，现保存完好。',
  },
  {
    title: '鎏金铜佛像',
    body: '鎏金铜佛像通高二十四厘米，黄铜铸就，表面鎏金。佛像结跏趺坐於仰覆莲台之上，右手作触地印，左手托钵。衣纹流畅，面相丰满端庄，疑为清代康熙时期北京地区作品。莲台边缘刻有六字真言，字迹尚清晰可辩。',
  },
];

function seed(db: Database.Database) {
  // 整个种子过程幂等：容器/服务重启时不会因重复插入而崩溃
  const tx = db.transaction(() => {
    const insertUser = db.prepare(
      `INSERT INTO users (username, display_name, password_hash, role)
       SELECT @username, @displayName, @passwordHash, @role
       WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = @username)`,
    );
    for (const u of SEED_USERS) {
      insertUser.run({
        username: u.username,
        displayName: u.displayName,
        passwordHash: hashPassword(u.password),
        role: u.role,
      });
    }

    const librarian = db
      .prepare(`SELECT id FROM users WHERE username = 'librarian'`)
      .get() as { id: number } | undefined;

    const count = db.prepare(`SELECT COUNT(*) AS n FROM labels`).get() as { n: number };
    if (count.n > 0 || !librarian) return;

    const insertLabel = db.prepare(
      `INSERT INTO labels (title, body, body_version, created_by)
       VALUES (@title, @body, 1, @createdBy)`,
    );
    const insertPub = db.prepare(
      `INSERT INTO publications (label_id, publisher_id, version, body_version, body_snapshot, note)
       VALUES (@labelId, @publisherId, 1, 1, @body, @note)`,
    );
    for (const l of SEED_LABELS) {
      const info = insertLabel.run({ title: l.title, body: l.body, createdBy: librarian.id });
      insertPub.run({
        labelId: Number(info.lastInsertRowid),
        publisherId: librarian.id,
        body: l.body,
        note: '初始导入版本',
      });
    }
  });
  tx();
}
