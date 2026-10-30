const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const db = new DatabaseSync(path.join(__dirname, 'stockroom.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    price REAL NOT NULL DEFAULT 0,
    reorder_level INTEGER NOT NULL DEFAULT 5,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

// Seed sample data on first run so the dashboard isn't empty
if (db.prepare('SELECT COUNT(*) AS n FROM items').get().n === 0) {
  const seed = db.prepare(
    'INSERT INTO items (name, category, quantity, price, reorder_level) VALUES (?, ?, ?, ?, ?)'
  );
  [
    ['Arabica coffee beans 1kg', 'Beverages', 24, 18.5, 10],
    ['Oat milk 1L', 'Beverages', 4, 2.9, 12],
    ['Paper cups (100 pack)', 'Supplies', 15, 6.25, 8],
    ['Blueberry muffin', 'Bakery', 9, 3.4, 6],
    ['Cleaning spray', 'Supplies', 2, 4.75, 5],
  ].forEach((row) => seed.run(...row));
}

app.use(express.json());

// ---------- Admin authentication ----------
// Change these with environment variables, e.g. ADMIN_USER=boss ADMIN_PASS=secret npm start
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const SESSION_MS = 8 * 60 * 60 * 1000; // 8 hours
const sessions = new Map(); // token -> { user, expires }

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

function getSession(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('sid='));
  if (!match) return null;
  const token = match.slice(4);
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expires < Date.now()) { sessions.delete(token); return null; }
  return { token, ...session };
}

function requireAuth(req, res, next) {
  if (getSession(req)) return next();
  res.status(401).json({ error: 'Please sign in.' });
}

app.post('/api/login', (req, res) => {
  const { username = '', password = '' } = req.body || {};
  const userOk = safeEqual(username, ADMIN_USER);
  const passOk = safeEqual(password, ADMIN_PASS);
  if (!(userOk && passOk)) return res.status(401).json({ error: 'Wrong username or password.' });
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { user: ADMIN_USER, expires: Date.now() + SESSION_MS });
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}`);
  res.json({ user: ADMIN_USER });
});

app.post('/api/logout', (req, res) => {
  const session = getSession(req);
  if (session) sessions.delete(session.token);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.status(204).end();
});

app.get('/api/me', requireAuth, (req, res) => res.json({ user: getSession(req).user }));

// Dashboard page is only served to a signed-in admin
app.get(['/', '/index.html'], (req, res) => {
  if (!getSession(req)) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Everything under these API paths requires login
app.use('/api/items', requireAuth);
app.use('/api/stats', requireAuth);

app.use(express.static(path.join(__dirname, 'public'), { index: false }));
// ---------- End authentication ----------

function validate(body) {
  const name = String(body.name ?? '').trim();
  const category = String(body.category ?? '').trim();
  const quantity = Number(body.quantity);
  const price = Number(body.price);
  const reorder_level = Number(body.reorder_level);
  if (!name) return { error: 'Name is required.' };
  if (!category) return { error: 'Category is required.' };
  if (!Number.isInteger(quantity) || quantity < 0) return { error: 'Quantity must be a whole number, 0 or more.' };
  if (!Number.isFinite(price) || price < 0) return { error: 'Price must be 0 or more.' };
  if (!Number.isInteger(reorder_level) || reorder_level < 0) return { error: 'Reorder level must be a whole number, 0 or more.' };
  return { value: { name, category, quantity, price, reorder_level } };
}

// READ (list, with optional search)
app.get('/api/items', (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  const rows = db
    .prepare('SELECT * FROM items WHERE name LIKE ? OR category LIKE ? ORDER BY name COLLATE NOCASE')
    .all(q, q);
  res.json(rows);
});

// READ (one)
app.get('/api/items/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Item not found.' });
  res.json(row);
});

// CREATE
app.post('/api/items', (req, res) => {
  const { error, value } = validate(req.body);
  if (error) return res.status(400).json({ error });
  const info = db
    .prepare('INSERT INTO items (name, category, quantity, price, reorder_level) VALUES (@name, @category, @quantity, @price, @reorder_level)')
    .run(value);
  res.status(201).json(db.prepare('SELECT * FROM items WHERE id = ?').get(info.lastInsertRowid));
});

// UPDATE
app.put('/api/items/:id', (req, res) => {
  const { error, value } = validate(req.body);
  if (error) return res.status(400).json({ error });
  const info = db
    .prepare(`UPDATE items SET name=@name, category=@category, quantity=@quantity, price=@price,
              reorder_level=@reorder_level, updated_at=CURRENT_TIMESTAMP WHERE id=@id`)
    .run({ ...value, id: req.params.id });
  if (info.changes === 0) return res.status(404).json({ error: 'Item not found.' });
  res.json(db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id));
});

// DELETE
app.delete('/api/items/:id', (req, res) => {
  const info = db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Item not found.' });
  res.status(204).end();
});

// Dashboard summary
app.get('/api/stats', (req, res) => {
  const totals = db.prepare(`
    SELECT COUNT(*) AS items,
           COALESCE(SUM(quantity), 0) AS units,
           COALESCE(SUM(quantity * price), 0) AS value,
           COALESCE(SUM(CASE WHEN quantity <= reorder_level THEN 1 ELSE 0 END), 0) AS low
    FROM items`).get();
  const byCategory = db.prepare(`
    SELECT category, SUM(quantity * price) AS value, COUNT(*) AS items
    FROM items GROUP BY category ORDER BY value DESC`).all();
  res.json({ ...totals, byCategory });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Stockroom running at http://localhost:${PORT}`));
