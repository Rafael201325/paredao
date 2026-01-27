const path = require('path');
const fs = require('fs');

function buildPostgresUrlFromParts() {
  const host = process.env.DATABASE_HOST || process.env.PGHOST || '';
  const port = process.env.DATABASE_PORT || process.env.PGPORT || '5432';
  const user =
    process.env.DATABASE_USER || process.env.PGUSER || process.env.PGUSERNAME || '';
  const password =
    process.env.DATABASE_PASSWORD || process.env.PGPASSWORD || '';
  const database = process.env.DATABASE_NAME || process.env.PGDATABASE || '';

  if (!host || !user || !password || !database) return '';

  const encUser = encodeURIComponent(user);
  const encPass = encodeURIComponent(password);
  const encDb = encodeURIComponent(database);
  return `postgres://${encUser}:${encPass}@${host}:${port}/${encDb}`;
}

const POSTGRES_URL =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.PG_URL ||
  buildPostgresUrlFromParts() ||
  '';

const USE_POSTGRES = Boolean(POSTGRES_URL);

function resolvePgSchema() {
  const requested =
    process.env.PG_SCHEMA ||
    process.env.DATABASE_SCHEMA ||
    process.env.DB_SCHEMA ||
    '';

  const fallbackFromUser =
    process.env.DATABASE_USER || process.env.PGUSER || process.env.PGUSERNAME || '';

  const schema = requested || fallbackFromUser || 'app';
  const ok = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema);
  if (!ok) {
    throw new Error(
      `Invalid schema name "${schema}". Set PG_SCHEMA (or DATABASE_SCHEMA/DB_SCHEMA) using only letters, digits and underscore (must not start with a digit).`
    );
  }
  return schema;
}

function toPgPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${(i += 1)}`);
}

function ensureReturningId(sql) {
  if (!/^\s*insert\b/i.test(sql)) return sql;
  if (/\breturning\b/i.test(sql)) return sql;
  const trimmed = sql.trimEnd();
  if (trimmed.endsWith(';')) {
    return `${trimmed.slice(0, -1)} RETURNING id;`;
  }
  return `${trimmed} RETURNING id`;
}

let db;
let run;
let get;
let all;
let init;
let DB_PATH;

if (USE_POSTGRES) {
  const { Pool } = require('pg');
  const PG_SCHEMA = resolvePgSchema();
  const PG_SCHEMA_Q = `"${PG_SCHEMA}"`;

  const pgSslEnabled =
    String(process.env.PG_SSL || process.env.PGSSL || 'true').toLowerCase() !==
    'false';
  const pgRejectUnauthorized =
    String(process.env.PG_SSL_REJECT_UNAUTHORIZED || 'false').toLowerCase() ===
    'true';

  const pool = new Pool({
    connectionString: POSTGRES_URL,
    ssl: pgSslEnabled ? { rejectUnauthorized: pgRejectUnauthorized } : undefined,
    options: `-c search_path="${PG_SCHEMA}"`,
  });

  pool.on('connect', (client) => {
    client.query(`SET search_path TO "${PG_SCHEMA}"`).catch(() => {
      // ignore: init() will fail loudly if schema doesn't exist
    });
  });

  db = pool;
  DB_PATH = '[postgres]';

  run = async (sql, params = []) => {
    const normalized = ensureReturningId(sql);
    const text = toPgPlaceholders(normalized);
    const result = await pool.query(text, params);
    const lastID = result?.rows?.[0]?.id ?? null;
    return { lastID, changes: result?.rowCount ?? 0 };
  };

  get = async (sql, params = []) => {
    const text = toPgPlaceholders(sql);
    const result = await pool.query(text, params);
    return result.rows[0] || null;
  };

  all = async (sql, params = []) => {
    const text = toPgPlaceholders(sql);
    const result = await pool.query(text, params);
    return result.rows;
  };

  function t(name) {
    return `${PG_SCHEMA_Q}."${name}"`;
  }

  init = async () => {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${PG_SCHEMA}"`);

    await run(`
      CREATE TABLE IF NOT EXISTS ${t('weeks')} (
        id BIGSERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
        created_at TEXT NOT NULL,
        closed_at TEXT
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS ${t('candidates')} (
        id BIGSERIAL PRIMARY KEY,
        week_id BIGINT NOT NULL REFERENCES ${t('weeks')}(id) ON DELETE CASCADE,
        slot INTEGER NOT NULL,
        name TEXT NOT NULL,
        image_url TEXT,
        UNIQUE(week_id, slot)
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS ${t('votes')} (
        id BIGSERIAL PRIMARY KEY,
        week_id BIGINT NOT NULL REFERENCES ${t('weeks')}(id) ON DELETE CASCADE,
        candidate_id BIGINT NOT NULL REFERENCES ${t('candidates')}(id) ON DELETE CASCADE,
        voter_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS ${t('reactions')} (
        id BIGSERIAL PRIMARY KEY,
        week_id BIGINT NOT NULL REFERENCES ${t('weeks')}(id) ON DELETE CASCADE,
        participant_name TEXT NOT NULL,
        reaction_id TEXT NOT NULL,
        voter_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    await run(
      `CREATE INDEX IF NOT EXISTS ${PG_SCHEMA_Q}."idx_votes_week" ON ${t('votes')}(week_id)`
    );
    await run(
      `CREATE UNIQUE INDEX IF NOT EXISTS ${PG_SCHEMA_Q}."idx_votes_week_voter" ON ${t('votes')}(week_id, voter_hash)`
    );
    await run(
      `CREATE UNIQUE INDEX IF NOT EXISTS ${PG_SCHEMA_Q}."idx_reactions_week_participant_voter" ON ${t('reactions')}(week_id, participant_name, voter_hash)`
    );
  };
} else {
  const sqlite3 = require('sqlite3').verbose();

  const BASE_DIR = process.pkg ? path.dirname(process.execPath) : process.cwd();
  DB_PATH = process.env.DB_PATH || path.join(BASE_DIR, 'data.db');

  const dbDir = path.dirname(DB_PATH);
  if (dbDir && dbDir !== '.' && !fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new sqlite3.Database(DB_PATH);

  run = (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  };

  get = (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
  };

  all = (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  };

  init = async () => {
    await run('PRAGMA foreign_keys = ON');
    await run(`
      CREATE TABLE IF NOT EXISTS weeks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
        created_at TEXT NOT NULL,
        closed_at TEXT
      )
    `);
    await run(`
      CREATE TABLE IF NOT EXISTS candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        week_id INTEGER NOT NULL,
        slot INTEGER NOT NULL,
        name TEXT NOT NULL,
        image_url TEXT,
        UNIQUE(week_id, slot),
        FOREIGN KEY(week_id) REFERENCES weeks(id) ON DELETE CASCADE
      )
    `);
    await run(`
      CREATE TABLE IF NOT EXISTS votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        week_id INTEGER NOT NULL,
        candidate_id INTEGER NOT NULL,
        voter_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(week_id) REFERENCES weeks(id) ON DELETE CASCADE,
        FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
      )
    `);
    await run(`
      CREATE TABLE IF NOT EXISTS reactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        week_id INTEGER NOT NULL,
        participant_name TEXT NOT NULL,
        reaction_id TEXT NOT NULL,
        voter_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(week_id) REFERENCES weeks(id) ON DELETE CASCADE
      )
    `);
    await run('CREATE INDEX IF NOT EXISTS idx_votes_week ON votes(week_id)');
    const columns = await all('PRAGMA table_info(votes)');
    const hasVoterHash = columns.some((col) => col.name === 'voter_hash');
    if (!hasVoterHash) {
      await run('ALTER TABLE votes ADD COLUMN voter_hash TEXT');
    }
    await run(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_week_voter ON votes(week_id, voter_hash)'
    );

    await run(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_reactions_week_participant_voter ON reactions(week_id, participant_name, voter_hash)'
    );

    const candidateCols = await all('PRAGMA table_info(candidates)');
    const hasImageUrl = candidateCols.some((col) => col.name === 'image_url');
    if (!hasImageUrl) {
      await run('ALTER TABLE candidates ADD COLUMN image_url TEXT');
    }
  };
}

module.exports = {
  db,
  run,
  get,
  all,
  init,
  DB_PATH,
};
