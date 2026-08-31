const express = require('express');
const multer = require('multer');
const { Pool } = require('pg');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 15);
const DATABASE_URL = process.env.DATABASE_URL;

if (ADMIN_PASSWORD === 'changeme') {
  console.warn('[party-photo-wall] WARNING: ADMIN_PASSWORD is not set — using the default "changeme". Set it via an environment variable before exposing this publicly.');
}
if (!DATABASE_URL) {
  console.error('[party-photo-wall] DATABASE_URL is not set. Example: postgres://user:pass@db:5432/photowall');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

async function waitForDatabase(retries = 20, delayMs = 1500) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      console.log(`[party-photo-wall] Database not ready (attempt ${attempt}/${retries}): ${err.message}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('Database never became ready');
}

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      name TEXT,
      mime TEXT NOT NULL,
      ts BIGINT NOT NULL,
      data BYTEA NOT NULL
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_photos_ts ON photos(ts);`);
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 }
});

function requireAdmin(req, res, next) {
  const supplied = req.get('x-admin-password') || '';
  if (supplied !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// Verifies an admin password without doing anything destructive — used by the
// frontend's Admin tab to check credentials before unlocking the panel.
app.post('/api/admin/verify', requireAdmin, (req, res) => {
  res.json({ ok: true });
});

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ ok: false });
  }
});

// List photo metadata only (no image bytes) — cheap to poll
app.get('/api/photos', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, ts FROM photos ORDER BY ts ASC');
    res.json(rows.map(r => ({ id: r.id, name: r.name, ts: Number(r.ts) })));
  } catch (err) {
    console.error('List failed', err);
    res.status(500).json({ error: 'server error' });
  }
});

// Serve a single photo's image bytes
app.get('/api/photos/:id/image', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT mime, data FROM photos WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).end();
    res.set('Content-Type', rows[0].mime);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(rows[0].data);
  } catch (err) {
    console.error('Fetch image failed', err);
    res.status(500).json({ error: 'server error' });
  }
});

// Upload a photo
app.post('/api/photos', upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file provided' });
  const id = Date.now() + '-' + crypto.randomBytes(4).toString('hex');
  const name = (req.body.name || '').toString().slice(0, 80) || 'Guest';
  try {
    await pool.query(
      'INSERT INTO photos (id, name, mime, ts, data) VALUES ($1, $2, $3, $4, $5)',
      [id, name, req.file.mimetype, Date.now(), req.file.buffer]
    );
    res.json({ id, name });
  } catch (err) {
    console.error('Insert failed', err);
    res.status(500).json({ error: 'save failed' });
  }
});

// Delete a single photo (admin only)
app.delete('/api/photos/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM photos WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete failed', err);
    res.status(500).json({ error: 'server error' });
  }
});

// Clear every photo (admin only)
app.delete('/api/photos', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM photos');
    res.json({ ok: true });
  } catch (err) {
    console.error('Clear failed', err);
    res.status(500).json({ error: 'server error' });
  }
});

app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `file too large (max ${MAX_UPLOAD_MB}MB)` });
  }
  console.error(err);
  res.status(500).json({ error: 'server error' });
});

(async () => {
  try {
    await waitForDatabase();
    await migrate();
    app.listen(PORT, () => {
      console.log(`party-photo-wall listening on port ${PORT}`);
    });
  } catch (err) {
    console.error('Startup failed:', err);
    process.exit(1);
  }
})();
