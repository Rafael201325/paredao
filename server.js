const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const multer = require('multer');

const { run, get, all, init, DB_PATH } = require('./db');

const PORT = process.env.PORT || 3000;
const VOTER_SALT =
  process.env.VOTER_SALT ||
  process.env.TOKEN_SALT ||
  'dev-salt-change-me';

const PARTICIPANTS = new Set([
  'Rafael',
  'Mike',
  'Laura',
  'Belmiro',
  'Luana P.O',
  'Luana Designer',
  'Vinicius',
]);
const REACTIONS = new Set([
  'heart',
  'snake',
  'vomit',
  'plant',
  'target',
  'liar',
  'suitcase',
  'cookie',
  'broken',
]);

const app = express();
const RUNTIME_DIR = process.pkg ? path.dirname(process.execPath) : process.cwd();

app.set('trust proxy', 1);
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));
const uploadDir = path.resolve(process.env.UPLOADS_DIR || process.env.UPLOAD_DIR || path.join(RUNTIME_DIR, 'uploads'));
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));

function nowIso() {
  return new Date().toISOString();
}

function sendError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function hashVoter(id) {
  return crypto.createHash('sha256').update(id + VOTER_SALT).digest('hex');
}

function parseCookies(header) {
  if (!header) return {};
  return header.split(';').reduce((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

function getVoterId(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies.voter_id;
}

function setVoterCookie(res, voterId) {
  const secure =
    String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true';
  const cookie = `voter_id=${encodeURIComponent(
    voterId
  )}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${secure ? '; Secure' : ''}`;
  res.setHeader('Set-Cookie', cookie);
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const weekId = String(req.params.id || '0');
      const slot = String(req.params.slot || '0');
      const random = crypto.randomBytes(6).toString('hex');
      cb(null, `week-${weekId}-slot-${slot}-${Date.now()}-${random}.jpg`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isJpeg =
      file.mimetype === 'image/jpeg' || file.mimetype === 'image/pjpeg';
    if (!isJpeg) return cb(new Error('INVALID_FILE_TYPE'));
    return cb(null, true);
  },
});

const rateState = new Map();
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 20;
function rateLimit(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = rateState.get(ip);
  if (!entry || entry.resetAt <= now) {
    rateState.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return next();
  }
  if (entry.count >= RATE_MAX) {
    return sendError(res, 429, 'RATE_LIMIT', 'Muitas requisicoes. Tente novamente em instantes.');
  }
  entry.count += 1;
  rateState.set(ip, entry);
  return next();
}

async function getOpenWeek() {
  return get("SELECT * FROM weeks WHERE status = 'OPEN' ORDER BY created_at DESC LIMIT 1");
}

function getNoonWindow(now = new Date()) {
  const noon = new Date(now);
  noon.setHours(12, 0, 0, 0);
  if (now < noon) {
    noon.setDate(noon.getDate() - 1);
  }
  const previous = new Date(noon);
  previous.setDate(previous.getDate() - 1);
  return { currentStart: noon, previousStart: previous, currentEnd: now };
}

async function getReactionCounts(weekId, startIso, endIso) {
  const rows = await all(
    `
    SELECT participant_name, reaction_id, COUNT(id) AS total
    FROM reactions
    WHERE week_id = ?
      AND created_at >= ?
      AND created_at < ?
    GROUP BY participant_name, reaction_id
    `,
    [weekId, startIso, endIso]
  );
  return rows;
}

app.get('/healthz', (req, res) => {
  return res.json({ ok: true, uptime: process.uptime() });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/public/status', async (req, res) => {
  try {
    const week = await getOpenWeek();
    if (!week) return res.json({ week: null, candidates: [] });
    const candidates = await all(
      'SELECT id, name, image_url FROM candidates WHERE week_id = ? ORDER BY slot',
      [week.id]
    );
    return res.json({
      week: { id: week.id, title: week.title, status: week.status },
      candidates,
    });
  } catch (err) {
    return sendError(res, 500, 'SERVER_ERROR', 'Erro interno');
  }
});

app.get('/api/public/partial', async (req, res) => {
  try {
    let week = null;
    const weekId = Number(req.query.weekId || 0);
    if (weekId) {
      week = await get("SELECT * FROM weeks WHERE id = ? AND status = 'OPEN'", [weekId]);
    } else {
      week = await getOpenWeek();
    }
    if (!week) return res.json({ week: null, candidates: [] });
    const rows = await all(
      `
      SELECT c.id, COUNT(v.id) AS votes
      FROM candidates c
      LEFT JOIN votes v ON v.candidate_id = c.id
      WHERE c.week_id = ?
      GROUP BY c.id
      ORDER BY c.slot
      `,
      [week.id]
    );
    const total = rows.reduce((sum, row) => sum + Number(row.votes || 0), 0);
    const candidates = rows.map((row) => ({
      id: row.id,
      votes: Number(row.votes || 0),
    }));
    return res.json({ week: { id: week.id }, total, candidates });
  } catch (err) {
    return sendError(res, 500, 'SERVER_ERROR', 'Erro interno');
  }
});

app.get('/api/public/reactions', async (req, res) => {
  try {
    const week = await getOpenWeek();
    if (!week) return res.json({ week: null, counts: [] });
    const window = getNoonWindow();
    const counts = await getReactionCounts(
      week.id,
      window.currentStart.toISOString(),
      window.currentEnd.toISOString()
    );
    const previousCounts = await getReactionCounts(
      week.id,
      window.previousStart.toISOString(),
      window.currentStart.toISOString()
    );
    return res.json({
      week: { id: week.id, reactions_status: week.reactions_status },
      counts,
      previousCounts,
      window: {
        currentStart: window.currentStart.toISOString(),
        previousStart: window.previousStart.toISOString(),
        previousEnd: window.currentStart.toISOString(),
      },
    });
  } catch (err) {
    return sendError(res, 500, 'SERVER_ERROR', 'Erro interno');
  }
});

app.post('/api/public/reactions', rateLimit, async (req, res) => {
  try {
    const { participantName, reactionId } = req.body || {};
    if (!participantName || !PARTICIPANTS.has(participantName)) {
      return sendError(res, 400, 'INVALID_PARTICIPANT', 'Participante invalido');
    }
    if (!reactionId || !REACTIONS.has(reactionId)) {
      return sendError(res, 400, 'INVALID_REACTION', 'Reacao invalida');
    }
    const week = await getOpenWeek();
    if (!week) {
      return sendError(res, 409, 'NO_OPEN_WEEK', 'Nao ha semana aberta');
    }
    if (week.reactions_status === 'CLOSED') {
      return sendError(res, 409, 'REACTIONS_CLOSED', 'Queridometro encerrado');
    }

    let voterId = getVoterId(req);
    let isNewVoter = false;
    if (!voterId) {
      voterId = crypto.randomBytes(16).toString('base64url');
      isNewVoter = true;
    }
    const voterHash = hashVoter(voterId);
    try {
      await run(
        'INSERT INTO reactions (week_id, participant_name, reaction_id, voter_hash, created_at) VALUES (?, ?, ?, ?, ?)',
        [week.id, participantName, reactionId, voterHash, nowIso()]
      );
    } catch (err) {
      if (String(err.message || '').includes('UNIQUE')) {
        await run(
          'UPDATE reactions SET reaction_id = ?, created_at = ? WHERE week_id = ? AND participant_name = ? AND voter_hash = ?',
          [reactionId, nowIso(), week.id, participantName, voterHash]
        );
      } else {
        throw err;
      }
    }
    if (isNewVoter) {
      setVoterCookie(res, voterId);
    }
    return res.json({ ok: true });
  } catch (err) {
    return sendError(res, 500, 'SERVER_ERROR', 'Erro interno');
  }
});

app.post('/api/public/vote', rateLimit, async (req, res) => {
  try {
    const { candidateId } = req.body || {};
    if (!candidateId || Number.isNaN(Number(candidateId))) {
      return sendError(res, 400, 'INVALID_CANDIDATE', 'Candidato invalido');
    }

    const week = await getOpenWeek();
    if (!week) {
      return sendError(res, 409, 'NO_OPEN_WEEK', 'Nao ha semana aberta');
    }

    const candidate = await get(
      'SELECT id FROM candidates WHERE id = ? AND week_id = ?',
      [candidateId, week.id]
    );
    if (!candidate) {
      return sendError(res, 400, 'INVALID_CANDIDATE', 'Candidato invalido');
    }

    let voterId = getVoterId(req);
    let isNewVoter = false;
    if (!voterId) {
      voterId = crypto.randomBytes(16).toString('base64url');
      isNewVoter = true;
    }
    const voterHash = hashVoter(voterId);
    const priorVote = await get(
      'SELECT id FROM votes WHERE week_id = ? AND voter_hash = ?',
      [week.id, voterHash]
    );
    if (priorVote) {
      return sendError(res, 409, 'ALREADY_VOTED', 'Voto ja registrado');
    }

    await run(
      'INSERT INTO votes (week_id, candidate_id, voter_hash, created_at) VALUES (?, ?, ?, ?)',
      [week.id, candidateId, voterHash, nowIso()]
    );
    if (isNewVoter) {
      setVoterCookie(res, voterId);
    }
    return res.json({ ok: true });
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) {
      return sendError(res, 409, 'ALREADY_VOTED', 'Voto ja registrado');
    }
    return sendError(res, 500, 'SERVER_ERROR', 'Erro interno');
  }
});

app.get('/admin/weeks', async (req, res) => {
  try {
    const weeks = await all(
      'SELECT id, title, status, reactions_status, created_at, closed_at FROM weeks ORDER BY created_at DESC'
    );
    return res.json({ weeks });
  } catch (err) {
    return sendError(res, 500, 'SERVER_ERROR', 'Erro interno');
  }
});

app.post('/admin/weeks', async (req, res) => {
  try {
    const { title } = req.body || {};
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const weekTitle = title || `Paredão - Semana ${month}/${year}`;

    const weekRes = await run(
      "INSERT INTO weeks (title, status, created_at, closed_at) VALUES (?, 'CLOSED', ?, NULL)",
      [weekTitle, nowIso()]
    );
    const weekId = weekRes.lastID;
    const defaultNames = ['Luana P.O', 'Luana Designer', 'Vinicious do mangueirao'];
    for (let i = 0; i < 3; i += 1) {
      await run(
        'INSERT INTO candidates (week_id, slot, name) VALUES (?, ?, ?)',
        [weekId, i + 1, defaultNames[i]]
      );
    }
    return res.json({ ok: true, weekId });
  } catch (err) {
    return sendError(res, 500, 'SERVER_ERROR', 'Erro interno');
  }
});

app.put('/admin/weeks/:id/candidates', async (req, res) => {
  try {
    const weekId = Number(req.params.id);
    const { candidates, names, images } = req.body || {};
    let payload = [];
    if (Array.isArray(candidates) && candidates.length === 3) {
      payload = candidates.map((c) => ({
        name: String(c?.name || '').trim(),
        imageUrl: String(c?.imageUrl || c?.image_url || '').trim(),
      }));
    } else if (Array.isArray(names) && names.length === 3) {
      payload = names.map((name, idx) => ({
        name: String(name || '').trim(),
        imageUrl: Array.isArray(images) ? String(images[idx] || '').trim() : '',
      }));
    } else {
      return sendError(res, 400, 'INVALID_NAMES', 'Informe 3 nomes');
    }
    for (let i = 0; i < 3; i += 1) {
      const name = payload[i].name;
      if (!name) {
        return sendError(res, 400, 'INVALID_NAMES', 'Nomes invalidos');
      }
    }

    const changes = await run(
      `
      UPDATE candidates
      SET
        name = CASE slot
          WHEN 1 THEN ?
          WHEN 2 THEN ?
          WHEN 3 THEN ?
          ELSE name
        END,
        image_url = CASE slot
          WHEN 1 THEN ?
          WHEN 2 THEN ?
          WHEN 3 THEN ?
          ELSE image_url
        END
      WHERE week_id = ? AND slot IN (1, 2, 3)
      `,
      [
        payload[0].name,
        payload[1].name,
        payload[2].name,
        payload[0].imageUrl || null,
        payload[1].imageUrl || null,
        payload[2].imageUrl || null,
        weekId,
      ]
    );

    if ((changes?.changes ?? 0) === 0) {
      return sendError(res, 404, 'NOT_FOUND', 'Semana nao encontrada');
    }
    return res.json({ ok: true });
  } catch (err) {
    return sendError(res, 500, 'SERVER_ERROR', 'Erro interno');
  }
});

app.post('/admin/weeks/:id/open', async (req, res) => {
  try {
    const weekId = Number(req.params.id);
    const now = nowIso();
    await run("UPDATE weeks SET status = 'CLOSED', closed_at = ? WHERE status = 'OPEN'", [now]);
    const result = await run(
      "UPDATE weeks SET status = 'OPEN', closed_at = NULL WHERE id = ?",
      [weekId]
    );
    if (result.changes === 0) {
      return sendError(res, 404, 'NOT_FOUND', 'Semana nao encontrada');
    }
    return res.json({ ok: true });
  } catch (err) {
    return sendError(res, 500, 'SERVER_ERROR', 'Erro interno');
  }
});

app.post('/admin/weeks/:id/close', async (req, res) => {
  try {
    const weekId = Number(req.params.id);
    const top = await get(
      `
      SELECT c.id, COUNT(v.id) AS votes
      FROM candidates c
      LEFT JOIN votes v ON v.candidate_id = c.id
      WHERE c.week_id = ?
      GROUP BY c.id
      ORDER BY votes DESC, c.id ASC
      LIMIT 1
      `,
      [weekId]
    );
    const eliminatedId = top ? top.id : null;
    const result = await run(
      "UPDATE weeks SET status = 'CLOSED', closed_at = ?, eliminated_candidate_id = ? WHERE id = ?",
      [nowIso(), eliminatedId, weekId]
    );
    if (result.changes === 0) {
      return sendError(res, 404, 'NOT_FOUND', 'Semana nao encontrada');
    }
    return res.json({ ok: true });
  } catch (err) {
    return sendError(res, 500, 'SERVER_ERROR', 'Erro interno');
  }
});

app.get('/admin/weeks/:id/results', async (req, res) => {
  try {
    const weekId = Number(req.params.id);
    const week = await get(
      'SELECT id, title, status, eliminated_candidate_id FROM weeks WHERE id = ?',
      [weekId]
    );
    if (!week) {
      return sendError(res, 404, 'NOT_FOUND', 'Semana nao encontrada');
    }
    const results = await all(
      `
      SELECT c.id, c.name, c.image_url, c.slot, COUNT(v.id) AS votes
      FROM candidates c
      LEFT JOIN votes v ON v.candidate_id = c.id
      WHERE c.week_id = ?
      GROUP BY c.id
      ORDER BY c.slot
      `,
      [weekId]
    );
    return res.json({ week, results });
  } catch (err) {
    return sendError(res, 500, 'SERVER_ERROR', 'Erro interno');
  }
});

app.post('/admin/weeks/:id/reactions/close', async (req, res) => {
  try {
    const weekId = Number(req.params.id);
    const result = await run(
      "UPDATE weeks SET reactions_status = 'CLOSED' WHERE id = ?",
      [weekId]
    );
    if (result.changes === 0) {
      return sendError(res, 404, 'NOT_FOUND', 'Semana nao encontrada');
    }
    return res.json({ ok: true });
  } catch (err) {
    return sendError(res, 500, 'SERVER_ERROR', 'Erro interno');
  }
});

app.post('/admin/weeks/:id/reactions/open', async (req, res) => {
  try {
    const weekId = Number(req.params.id);
    const result = await run(
      "UPDATE weeks SET reactions_status = 'OPEN' WHERE id = ?",
      [weekId]
    );
    if (result.changes === 0) {
      return sendError(res, 404, 'NOT_FOUND', 'Semana nao encontrada');
    }
    return res.json({ ok: true });
  } catch (err) {
    return sendError(res, 500, 'SERVER_ERROR', 'Erro interno');
  }
});

app.get('/api/public/last-closed', async (req, res) => {
  try {
    const week = await get(
      "SELECT id, title, closed_at, eliminated_candidate_id FROM weeks WHERE status = 'CLOSED' ORDER BY closed_at DESC LIMIT 1"
    );
    if (!week || !week.eliminated_candidate_id) {
      return res.json({ week: null, eliminated: null });
    }
    const eliminated = await get(
      'SELECT id, name, image_url FROM candidates WHERE id = ?',
      [week.eliminated_candidate_id]
    );
    return res.json({
      week: { id: week.id, title: week.title, closed_at: week.closed_at },
      eliminated,
    });
  } catch (err) {
    return sendError(res, 500, 'SERVER_ERROR', 'Erro interno');
  }
});

app.post(
  '/admin/weeks/:id/candidates/:slot/image',
  upload.single('image'),
  async (req, res) => {
    try {
      const weekId = Number(req.params.id);
      const slot = Number(req.params.slot);
      if (![1, 2, 3].includes(slot)) {
        return sendError(res, 400, 'INVALID_SLOT', 'Slot invalido');
      }
      const week = await get('SELECT id FROM weeks WHERE id = ?', [weekId]);
      if (!week) {
        return sendError(res, 404, 'NOT_FOUND', 'Semana nao encontrada');
      }
      if (!req.file) {
        return sendError(res, 400, 'INVALID_FILE', 'Arquivo nao enviado');
      }
      const imageUrl = `/uploads/${req.file.filename}`;
      await run(
        'UPDATE candidates SET image_url = ? WHERE week_id = ? AND slot = ?',
        [imageUrl, weekId, slot]
      );
      return res.json({ ok: true, imageUrl });
    } catch (err) {
      return sendError(res, 500, 'SERVER_ERROR', 'Erro interno');
    }
  }
);

app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return sendError(res, 400, 'INVALID_FILE', 'Arquivo muito grande (max 2MB)');
  }
  if (err && String(err.message || '') === 'INVALID_FILE_TYPE') {
    return sendError(res, 400, 'INVALID_FILE', 'Envie apenas JPEG');
  }
  return sendError(res, 500, 'SERVER_ERROR', 'Erro interno');
});

app.use((req, res) => {
  return sendError(res, 404, 'NOT_FOUND', 'Rota nao encontrada');
});

init()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Servidor rodando na porta ${PORT}`);
      console.log(`DB em ${DB_PATH}`);
      console.log(`Uploads em ${uploadDir}`);
    });
  })
  .catch((err) => {
    console.error('Erro ao iniciar', err);
    process.exit(1);
  });
