const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const BASE_DIR = process.pkg ? path.dirname(process.execPath) : process.cwd();
const DB_PATH = process.env.DB_PATH || path.join(BASE_DIR, 'data.db');

const dbDir = path.dirname(DB_PATH);
if (dbDir && dbDir !== '.' && !fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function init() {
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
  await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_week_voter ON votes(week_id, voter_hash)');

  await run(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_reactions_week_participant_voter ON reactions(week_id, participant_name, voter_hash)'
  );

  const candidateCols = await all('PRAGMA table_info(candidates)');
  const hasImageUrl = candidateCols.some((col) => col.name === 'image_url');
  if (!hasImageUrl) {
    await run('ALTER TABLE candidates ADD COLUMN image_url TEXT');
  }
}

module.exports = {
  db,
  run,
  get,
  all,
  init,
  DB_PATH,
};
