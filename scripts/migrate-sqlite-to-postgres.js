#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { Client } = require('pg');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const cur = argv[i];
    if (!cur.startsWith('--')) continue;
    const key = cur.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function buildPostgresUrlFromParts(env) {
  const host = env.DATABASE_HOST || env.PGHOST || '';
  const port = env.DATABASE_PORT || env.PGPORT || '5432';
  const user = env.DATABASE_USER || env.PGUSER || env.PGUSERNAME || '';
  const password = env.DATABASE_PASSWORD || env.PGPASSWORD || '';
  const database = env.DATABASE_NAME || env.PGDATABASE || '';
  if (!host || !user || !password || !database) return '';
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(
    password
  )}@${host}:${port}/${encodeURIComponent(database)}`;
}

function resolvePostgresUrl(env) {
  return (
    env.DATABASE_URL ||
    env.POSTGRES_URL ||
    env.PG_URL ||
    buildPostgresUrlFromParts(env) ||
    ''
  );
}

function resolvePgSchema(env) {
  const requested = env.PG_SCHEMA || env.DATABASE_SCHEMA || env.DB_SCHEMA || '';
  const fallbackFromUser = env.DATABASE_USER || env.PGUSER || env.PGUSERNAME || '';
  const schema = requested || fallbackFromUser || 'app';
  const ok = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema);
  if (!ok) {
    throw new Error(
      `Invalid schema name "${schema}". Set PG_SCHEMA (or DATABASE_SCHEMA/DB_SCHEMA) using only letters, digits and underscore (must not start with a digit).`
    );
  }
  return schema;
}

function sqliteAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function multiValuesPlaceholders(rowCount, colCount, startIndex = 1) {
  let idx = startIndex;
  const groups = [];
  for (let r = 0; r < rowCount; r += 1) {
    const cols = [];
    for (let c = 0; c < colCount; c += 1) cols.push(`$${idx++}`);
    groups.push(`(${cols.join(', ')})`);
  }
  return groups.join(', ');
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    process.stdout.write(
      [
        'Uso:',
        '  node scripts/migrate-sqlite-to-postgres.js --sqlite ./data.db',
        '',
        'Config (Postgres):',
        '  - Use DATABASE_URL (recomendado) OU DATABASE_HOST/USER/PASSWORD/NAME',
        '  - Opcional: PG_SCHEMA (default: app)',
        '  - Opcional: PG_SSL=true/false (default: true)',
        '  - Opcional: PG_SSL_REJECT_UNAUTHORIZED=true/false (default: false)',
        '',
        'Flags:',
        '  --dry-run     Só mostra contagens, não grava nada',
        '  --wipe        TRUNCATE nas tabelas antes de importar',
        '  --skip-ddl    NÃ£o cria schema/tabelas/indexes (assume que jÃ¡ existem)',
        '',
      ].join('\n')
    );
    process.exit(0);
  }

  const schema = resolvePgSchema(process.env);
  const pgUrl = resolvePostgresUrl(process.env);
  if (!pgUrl && !args['dry-run']) {
    throw new Error(
      'Postgres não configurado. Defina DATABASE_URL (ou DATABASE_HOST/USER/PASSWORD/NAME).'
    );
  }

  const sqlitePathRaw = String(args.sqlite || process.env.SQLITE_PATH || 'data.db');
  const sqlitePath = path.isAbsolute(sqlitePathRaw)
    ? sqlitePathRaw
    : path.join(process.cwd(), sqlitePathRaw);

  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite não encontrado em: ${sqlitePath}`);
  }

  const pgSslEnabled =
    String(process.env.PG_SSL || process.env.PGSSL || 'true').toLowerCase() !==
    'false';
  const pgRejectUnauthorized =
    String(process.env.PG_SSL_REJECT_UNAUTHORIZED || 'false').toLowerCase() ===
    'true';

  const sqliteDb = new sqlite3.Database(sqlitePath);
  const weeks = await sqliteAll(sqliteDb, 'SELECT * FROM weeks ORDER BY id');
  const candidates = await sqliteAll(
    sqliteDb,
    'SELECT * FROM candidates ORDER BY id'
  );
  const votes = await sqliteAll(sqliteDb, 'SELECT * FROM votes ORDER BY id');
  const reactions = await sqliteAll(
    sqliteDb,
    'SELECT * FROM reactions ORDER BY id'
  );
  sqliteDb.close();

  process.stdout.write(
    `SQLite: ${weeks.length} weeks, ${candidates.length} candidates, ${votes.length} votes, ${reactions.length} reactions\n`
  );

  if (args['dry-run']) {
    process.stdout.write('Dry-run: nada foi enviado ao Postgres.\n');
    return;
  }

  const client = new Client({
    connectionString: pgUrl,
    ssl: pgSslEnabled ? { rejectUnauthorized: pgRejectUnauthorized } : undefined,
  });

	await client.connect();
		try {
		  await client.query('BEGIN');

		  if (!args['skip-ddl']) {
		    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
		  }

		  await client.query(`SET search_path TO "${schema}"`);

		  if (!args['skip-ddl']) {
		    await client.query(`
			      CREATE TABLE IF NOT EXISTS weeks (
			        id BIGSERIAL PRIMARY KEY,
	        title TEXT NOT NULL,
	        status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
	        created_at TEXT NOT NULL,
	        closed_at TEXT
	      )
	    `);

	    await client.query(`
	      CREATE TABLE IF NOT EXISTS candidates (
	        id BIGSERIAL PRIMARY KEY,
	        week_id BIGINT NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
	        slot INTEGER NOT NULL,
	        name TEXT NOT NULL,
	        image_url TEXT,
	        UNIQUE(week_id, slot)
	      )
	    `);

	    await client.query(`
	      CREATE TABLE IF NOT EXISTS votes (
	        id BIGSERIAL PRIMARY KEY,
	        week_id BIGINT NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
	        candidate_id BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
	        voter_hash TEXT NOT NULL,
	        created_at TEXT NOT NULL
	      )
	    `);

	    await client.query(`
	      CREATE TABLE IF NOT EXISTS reactions (
	        id BIGSERIAL PRIMARY KEY,
	        week_id BIGINT NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
	        participant_name TEXT NOT NULL,
	        reaction_id TEXT NOT NULL,
	        voter_hash TEXT NOT NULL,
	        created_at TEXT NOT NULL
	      )
	    `);

	    await client.query(
	      'CREATE INDEX IF NOT EXISTS idx_votes_week ON votes(week_id)'
	    );
	    await client.query(
	      'CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_week_voter ON votes(week_id, voter_hash)'
	    );
	    await client.query(
	      'CREATE UNIQUE INDEX IF NOT EXISTS idx_reactions_week_participant_voter ON reactions(week_id, participant_name, voter_hash)'
	    );
	  }

    if (args.wipe) {
      await client.query(
        'TRUNCATE votes, reactions, candidates, weeks RESTART IDENTITY CASCADE'
      );
    }

    const BATCH = 500;

    for (const part of chunk(weeks, BATCH)) {
      const values = [];
      for (const r of part) {
        values.push(
          Number(r.id),
          String(r.title),
          String(r.status),
          String(r.created_at),
          r.closed_at == null ? null : String(r.closed_at)
        );
      }
      const text = `
        INSERT INTO weeks (id, title, status, created_at, closed_at)
        VALUES ${multiValuesPlaceholders(part.length, 5)}
        ON CONFLICT DO NOTHING
      `;
      await client.query(text, values);
    }

    for (const part of chunk(candidates, BATCH)) {
      const values = [];
      for (const r of part) {
        values.push(
          Number(r.id),
          Number(r.week_id),
          Number(r.slot),
          String(r.name),
          r.image_url == null ? null : String(r.image_url)
        );
      }
      const text = `
        INSERT INTO candidates (id, week_id, slot, name, image_url)
        VALUES ${multiValuesPlaceholders(part.length, 5)}
        ON CONFLICT DO NOTHING
      `;
      await client.query(text, values);
    }

    for (const part of chunk(votes, BATCH)) {
      const values = [];
      for (const r of part) {
        values.push(
          Number(r.id),
          Number(r.week_id),
          Number(r.candidate_id),
          String(r.voter_hash || ''),
          String(r.created_at)
        );
      }
      const text = `
        INSERT INTO votes (id, week_id, candidate_id, voter_hash, created_at)
        VALUES ${multiValuesPlaceholders(part.length, 5)}
        ON CONFLICT DO NOTHING
      `;
      await client.query(text, values);
    }

    for (const part of chunk(reactions, BATCH)) {
      const values = [];
      for (const r of part) {
        values.push(
          Number(r.id),
          Number(r.week_id),
          String(r.participant_name),
          String(r.reaction_id),
          String(r.voter_hash || ''),
          String(r.created_at)
        );
      }
      const text = `
        INSERT INTO reactions (id, week_id, participant_name, reaction_id, voter_hash, created_at)
        VALUES ${multiValuesPlaceholders(part.length, 6)}
        ON CONFLICT DO NOTHING
      `;
      await client.query(text, values);
    }

    await client.query(
      "SELECT setval('weeks_id_seq', COALESCE((SELECT MAX(id) FROM weeks), 0))"
    );
    await client.query(
      "SELECT setval('candidates_id_seq', COALESCE((SELECT MAX(id) FROM candidates), 0))"
    );
    await client.query(
      "SELECT setval('votes_id_seq', COALESCE((SELECT MAX(id) FROM votes), 0))"
    );
    await client.query(
      "SELECT setval('reactions_id_seq', COALESCE((SELECT MAX(id) FROM reactions), 0))"
    );

    await client.query('COMMIT');
    process.stdout.write('Import concluído.\n');
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      // ignore
    }
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
