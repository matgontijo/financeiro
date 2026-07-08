/*
 * Financeiro Pessoal — servidor local
 * Node.js (http nativo) + SQLite embutido (node:sqlite). Sem dependências externas.
 * Todos os valores monetários são armazenados em CENTAVOS (inteiros).
 * Datas no formato ISO local: YYYY-MM-DD.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

// Em casa roda na 3345; em nuvem (Render etc.) a plataforma define a porta
const PORT = Number(process.env.PORT) || 3345;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DB_PATH = path.join(ROOT, 'financeiro.db');

// ---------------------------------------------------------------------------
// Banco de dados
// ---------------------------------------------------------------------------

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'corrente',
  initial_balance INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#6366f1',
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('receita','despesa')),
  color TEXT NOT NULL DEFAULT '#64748b',
  icon TEXT NOT NULL DEFAULT '🏷️',
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('receita','despesa','transferencia')),
  description TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  date TEXT NOT NULL,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  to_account_id INTEGER REFERENCES accounts(id),
  category_id INTEGER REFERENCES categories(id),
  status TEXT NOT NULL DEFAULT 'pago' CHECK (status IN ('pago','pendente')),
  notes TEXT,
  recurring_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions (date);
CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions (account_id);
CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL UNIQUE REFERENCES categories(id),
  amount INTEGER NOT NULL CHECK (amount > 0)
);
CREATE TABLE IF NOT EXISTS recurring (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  description TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  type TEXT NOT NULL CHECK (type IN ('receita','despesa')),
  day INTEGER NOT NULL DEFAULT 1 CHECK (day BETWEEN 1 AND 31),
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  category_id INTEGER REFERENCES categories(id),
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  target INTEGER NOT NULL CHECK (target > 0),
  saved INTEGER NOT NULL DEFAULT 0,
  deadline TEXT,
  color TEXT NOT NULL DEFAULT '#10b981'
);
`);

// Migrações leves: adiciona colunas novas em bancos criados por versões anteriores
const txCols = db.prepare('PRAGMA table_info(transactions)').all().map((c) => c.name);
if (!txCols.includes('installment_group')) {
  db.exec(`ALTER TABLE transactions ADD COLUMN installment_group TEXT;
           ALTER TABLE transactions ADD COLUMN installment_no INTEGER;
           ALTER TABLE transactions ADD COLUMN installment_total INTEGER;`);
}
if (!txCols.includes('reconciled')) {
  db.exec("ALTER TABLE transactions ADD COLUMN reconciled INTEGER NOT NULL DEFAULT 0");
}
// Transferências têm dois lados: saiu de uma conta (reconciled) e entrou em outra
// (reconciled_in). Cada lado é conferido separadamente contra o extrato do seu banco.
if (!txCols.includes('reconciled_in')) {
  db.exec("ALTER TABLE transactions ADD COLUMN reconciled_in INTEGER NOT NULL DEFAULT 0");
}
// Comprovante anexado (nome do arquivo na pasta anexos/)
if (!txCols.includes('attachment')) {
  db.exec('ALTER TABLE transactions ADD COLUMN attachment TEXT');
}
// Cartão de crédito: dia de fechamento e de vencimento da fatura
const accCols = db.prepare('PRAGMA table_info(accounts)').all().map((c) => c.name);
if (!accCols.includes('closing_day')) {
  db.exec(`ALTER TABLE accounts ADD COLUMN closing_day INTEGER;
           ALTER TABLE accounts ADD COLUMN due_day INTEGER;`);
}
db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}
function setSetting(key, value) {
  if (value === null) db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  else db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

function seedIfEmpty() {
  const nCat = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
  if (nCat === 0) {
    const ins = db.prepare('INSERT INTO categories (name, kind, color, icon) VALUES (?,?,?,?)');
    const receitas = [
      ['Salário', '#10b981', '💼'],
      ['Renda extra', '#22c55e', '🪙'],
      ['Investimentos', '#14b8a6', '📈'],
      ['Outras receitas', '#84cc16', '➕'],
    ];
    const despesas = [
      ['Moradia', '#f97316', '🏠'],
      ['Mercado', '#ef4444', '🛒'],
      ['Alimentação fora', '#f43f5e', '🍽️'],
      ['Transporte', '#3b82f6', '🚗'],
      ['Saúde', '#ec4899', '🩺'],
      ['Educação', '#8b5cf6', '📚'],
      ['Lazer', '#eab308', '🎬'],
      ['Assinaturas', '#06b6d4', '📱'],
      ['Vestuário', '#a855f7', '👕'],
      ['Impostos e taxas', '#64748b', '🧾'],
      ['Presentes e doações', '#fb7185', '🎁'],
      ['Outras despesas', '#94a3b8', '📦'],
    ];
    for (const [name, color, icon] of receitas) ins.run(name, 'receita', color, icon);
    for (const [name, color, icon] of despesas) ins.run(name, 'despesa', color, icon);
  }
  const nAcc = db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;
  if (nAcc === 0) {
    const ins = db.prepare('INSERT INTO accounts (name, type, initial_balance, color) VALUES (?,?,?,?)');
    ins.run('Conta Corrente', 'corrente', 0, '#6366f1');
    ins.run('Carteira', 'carteira', 0, '#f59e0b');
  }
}
seedIfEmpty();

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

function localToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function currentMonth() {
  return localToday().slice(0, 7);
}
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RE_MONTH = /^\d{4}-\d{2}$/;

function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

// Soma meses a uma data ISO mantendo o dia (limitado ao último dia do mês destino)
function addMonthsClamped(date, delta) {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(y, m - 1 + delta, 1);
  const month = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}`;
  const day = Math.min(d, daysInMonth(month));
  return `${month}-${String(day).padStart(2, '0')}`;
}

function shiftMonthStr(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requireInt(value, name, { min = null, max = null } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new ApiError(400, `Campo "${name}" deve ser um número inteiro.`);
  if (min !== null && n < min) throw new ApiError(400, `Campo "${name}" deve ser no mínimo ${min}.`);
  if (max !== null && n > max) throw new ApiError(400, `Campo "${name}" deve ser no máximo ${max}.`);
  return n;
}
function requireText(value, name, maxLen = 200) {
  if (typeof value !== 'string' || value.trim() === '') throw new ApiError(400, `Campo "${name}" é obrigatório.`);
  return value.trim().slice(0, maxLen);
}
function requireOneOf(value, name, options) {
  if (!options.includes(value)) throw new ApiError(400, `Campo "${name}" inválido.`);
  return value;
}
function requireDate(value, name) {
  if (typeof value !== 'string' || !RE_DATE.test(value)) throw new ApiError(400, `Campo "${name}" deve estar no formato AAAA-MM-DD.`);
  return value;
}
// Cores só no formato #rrggbb — evita que texto malicioso vá parar dentro do HTML
function requireColor(value, fallback) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return s;
  if (!s) return fallback;
  throw new ApiError(400, 'A cor deve estar no formato #rrggbb, ex.: #6366f1.');
}

// ---------------------------------------------------------------------------
// Regras de negócio
// ---------------------------------------------------------------------------

const BALANCE_SQL = `
  a.initial_balance
  + COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.account_id = a.id AND t.type = 'receita' AND t.status = 'pago'), 0)
  - COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.account_id = a.id AND t.type = 'despesa' AND t.status = 'pago'), 0)
  - COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.account_id = a.id AND t.type = 'transferencia' AND t.status = 'pago'), 0)
  + COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.to_account_id = a.id AND t.type = 'transferencia' AND t.status = 'pago'), 0)
`;

function listAccounts() {
  return db.prepare(`SELECT a.*, (${BALANCE_SQL}) AS balance FROM accounts a ORDER BY a.archived, a.name`).all();
}

function validateTransactionBody(body) {
  const type = requireOneOf(body.type, 'tipo', ['receita', 'despesa', 'transferencia']);
  const description = requireText(body.description, 'descrição');
  const amount = requireInt(body.amount, 'valor', { min: 1 });
  const date = requireDate(body.date, 'data');
  const account_id = requireInt(body.account_id, 'conta', { min: 1 });
  const status = requireOneOf(body.status || 'pago', 'status', ['pago', 'pendente']);
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) : null;

  if (!db.prepare('SELECT id FROM accounts WHERE id = ?').get(account_id)) {
    throw new ApiError(400, 'Conta não encontrada.');
  }

  let to_account_id = null;
  let category_id = null;
  if (type === 'transferencia') {
    to_account_id = requireInt(body.to_account_id, 'conta de destino', { min: 1 });
    if (to_account_id === account_id) throw new ApiError(400, 'A conta de destino deve ser diferente da conta de origem.');
    if (!db.prepare('SELECT id FROM accounts WHERE id = ?').get(to_account_id)) {
      throw new ApiError(400, 'Conta de destino não encontrada.');
    }
  } else {
    category_id = requireInt(body.category_id, 'categoria', { min: 1 });
    const cat = db.prepare('SELECT kind FROM categories WHERE id = ?').get(category_id);
    if (!cat) throw new ApiError(400, 'Categoria não encontrada.');
    if (cat.kind !== type) throw new ApiError(400, 'A categoria escolhida não corresponde ao tipo do lançamento.');
  }
  return { type, description, amount, date, account_id, to_account_id, category_id, status, notes };
}

function generateRecurringForMonth(month) {
  const items = db.prepare('SELECT * FROM recurring WHERE active = 1').all();
  const exists = db.prepare("SELECT id FROM transactions WHERE recurring_id = ? AND substr(date,1,7) = ?");
  const ins = db.prepare(`INSERT INTO transactions (type, description, amount, date, account_id, category_id, status, recurring_id)
                          VALUES (?,?,?,?,?,?, 'pendente', ?)`);
  const maxDay = daysInMonth(month);
  let created = 0;
  for (const r of items) {
    if (exists.get(r.id, month)) continue;
    const day = Math.min(r.day, maxDay);
    const date = `${month}-${String(day).padStart(2, '0')}`;
    ins.run(r.type, r.description, r.amount, date, r.account_id, r.category_id, r.id);
    created++;
  }
  return created;
}

function monthTotals(month) {
  return db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'receita' THEN amount END), 0) AS receitas,
      COALESCE(SUM(CASE WHEN type = 'despesa' THEN amount END), 0) AS despesas,
      COALESCE(SUM(CASE WHEN status = 'pendente' AND type = 'despesa' THEN amount END), 0) AS despesas_pendentes,
      COALESCE(SUM(CASE WHEN status = 'pendente' AND type = 'receita' THEN amount END), 0) AS receitas_pendentes
    FROM transactions WHERE substr(date,1,7) = ?
  `).get(month);
}

function budgetsWithSpent(month) {
  return db.prepare(`
    SELECT b.id, b.category_id, b.amount, c.name, c.color, c.icon,
      COALESCE((SELECT SUM(t.amount) FROM transactions t
        WHERE t.category_id = b.category_id AND t.type = 'despesa' AND substr(t.date,1,7) = ?), 0) AS spent
    FROM budgets b JOIN categories c ON c.id = b.category_id
    ORDER BY c.name
  `).all(month);
}

// ---------------------------------------------------------------------------
// Rotas da API
// ---------------------------------------------------------------------------

// Cada rota: [método, regex do caminho, handler(req, match, query, body)]
const routes = [];
function route(method, pattern, handler) {
  routes.push({ method, pattern, handler });
}

function lanUrls() {
  const urls = [];
  for (const [, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) urls.push(`http://${a.address}:${PORT}`);
    }
  }
  return urls;
}

route('GET', /^\/api\/meta$/, () => ({ today: localToday(), month: currentMonth(), lan: lanUrls() }));

// --- Autenticação por PIN (protege o app quando acessado pela rede de casa) ---
// O PIN é guardado com scrypt (hash + sal). As sessões ficam no banco (só o hash
// do token) com validade de 30 dias — o celular não pede PIN a cada reinício.
db.exec('CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, created TEXT NOT NULL)');
let loginFails = []; // timestamps das tentativas erradas (limita força bruta)

const pinIsSet = () => !!getSetting('pin_hash');
function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 32).toString('hex');
}
function verifyPin(pin) {
  const salt = getSetting('pin_salt'), hash = getSetting('pin_hash');
  if (!salt || !hash) return false;
  const candidate = Buffer.from(hashPin(pin, salt), 'hex');
  const stored = Buffer.from(hash, 'hex');
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
function newToken() {
  const t = crypto.randomBytes(24).toString('hex');
  db.prepare("INSERT INTO sessions (token_hash, created) VALUES (?, datetime('now'))").run(hashToken(t));
  db.prepare("DELETE FROM sessions WHERE created <= datetime('now', '-30 days')").run();
  return t;
}
function tokenValid(t) {
  if (!t) return false;
  return !!db.prepare("SELECT 1 FROM sessions WHERE token_hash = ? AND created > datetime('now', '-30 days')").get(hashToken(t));
}
const clearSessions = () => db.prepare('DELETE FROM sessions').run();

route('GET', /^\/api\/auth\/status$/, () => ({ required: pinIsSet() }));

route('POST', /^\/api\/auth\/login$/, (req, m, q, body) => {
  if (!pinIsSet()) return { token: newToken() };
  const now = Date.now();
  loginFails = loginFails.filter((t) => now - t < 10 * 60 * 1000);
  if (loginFails.length >= 5) throw new ApiError(429, 'Muitas tentativas erradas. Aguarde 10 minutos e tente de novo.');
  const pin = String(body.pin || '');
  if (!verifyPin(pin)) {
    loginFails.push(now);
    throw new ApiError(401, 'PIN incorreto.');
  }
  loginFails = [];
  return { token: newToken() };
});

route('POST', /^\/api\/auth\/pin$/, (req, m, q, body) => {
  // Alterar/definir/remover PIN exige o PIN atual (quando existe)
  if (pinIsSet() && !verifyPin(String(body.current || ''))) {
    throw new ApiError(401, 'PIN atual incorreto.');
  }
  loginFails = []; // provou que sabe o PIN — zera o bloqueio de tentativas
  const next = body.next === null || body.next === undefined ? '' : String(body.next);
  if (next === '') {
    setSetting('pin_hash', null);
    setSetting('pin_salt', null);
    clearSessions();
    return { required: false };
  }
  if (!/^\d{4,8}$/.test(next)) throw new ApiError(400, 'O PIN deve ter de 4 a 8 números.');
  const salt = crypto.randomBytes(16).toString('hex');
  setSetting('pin_salt', salt);
  setSetting('pin_hash', hashPin(next, salt));
  clearSessions();
  return { required: true, token: newToken() };
});

// --- Contas ---
route('GET', /^\/api\/accounts$/, () => listAccounts());

// Dias de fechamento/vencimento só fazem sentido para cartão de crédito
function cardDays(body, type) {
  if (type !== 'cartao') return { closing_day: null, due_day: null };
  const closing_day = body.closing_day ? requireInt(body.closing_day, 'dia de fechamento', { min: 1, max: 31 }) : null;
  const due_day = body.due_day ? requireInt(body.due_day, 'dia de vencimento', { min: 1, max: 31 }) : null;
  return { closing_day, due_day };
}

route('POST', /^\/api\/accounts$/, (req, m, q, body) => {
  const name = requireText(body.name, 'nome');
  const type = requireOneOf(body.type || 'corrente', 'tipo', ['corrente', 'poupanca', 'carteira', 'cartao', 'investimento']);
  const initial = requireInt(body.initial_balance ?? 0, 'saldo inicial');
  const color = requireColor(body.color, '#6366f1');
  const { closing_day, due_day } = cardDays(body, type);
  const r = db.prepare('INSERT INTO accounts (name, type, initial_balance, color, closing_day, due_day) VALUES (?,?,?,?,?,?)')
    .run(name, type, initial, color, closing_day, due_day);
  return { id: Number(r.lastInsertRowid) };
});

route('PUT', /^\/api\/accounts\/(\d+)$/, (req, m, q, body) => {
  const id = Number(m[1]);
  if (!db.prepare('SELECT id FROM accounts WHERE id = ?').get(id)) throw new ApiError(404, 'Conta não encontrada.');
  const name = requireText(body.name, 'nome');
  const type = requireOneOf(body.type || 'corrente', 'tipo', ['corrente', 'poupanca', 'carteira', 'cartao', 'investimento']);
  const initial = requireInt(body.initial_balance ?? 0, 'saldo inicial');
  const color = requireColor(body.color, '#6366f1');
  const archived = body.archived ? 1 : 0;
  const { closing_day, due_day } = cardDays(body, type);
  db.prepare('UPDATE accounts SET name=?, type=?, initial_balance=?, color=?, archived=?, closing_day=?, due_day=? WHERE id=?')
    .run(name, type, initial, color, archived, closing_day, due_day, id);
  return { ok: true };
});

route('DELETE', /^\/api\/accounts\/(\d+)$/, (req, m) => {
  const id = Number(m[1]);
  const used = db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE account_id = ? OR to_account_id = ?').get(id, id).n
    + db.prepare('SELECT COUNT(*) AS n FROM recurring WHERE account_id = ?').get(id).n;
  if (used > 0) throw new ApiError(409, 'Esta conta possui lançamentos. Em vez de excluir, arquive-a para preservar o histórico.');
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  return { ok: true };
});

// --- Categorias ---
route('GET', /^\/api\/categories$/, () =>
  db.prepare('SELECT * FROM categories ORDER BY archived, kind, name').all());

route('POST', /^\/api\/categories$/, (req, m, q, body) => {
  const name = requireText(body.name, 'nome');
  const kind = requireOneOf(body.kind, 'tipo', ['receita', 'despesa']);
  const color = requireColor(body.color, '#64748b');
  const icon = requireText(body.icon || '🏷️', 'ícone', 8);
  const r = db.prepare('INSERT INTO categories (name, kind, color, icon) VALUES (?,?,?,?)').run(name, kind, color, icon);
  return { id: Number(r.lastInsertRowid) };
});

route('PUT', /^\/api\/categories\/(\d+)$/, (req, m, q, body) => {
  const id = Number(m[1]);
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!cat) throw new ApiError(404, 'Categoria não encontrada.');
  const name = requireText(body.name, 'nome');
  const color = requireColor(body.color, '#64748b');
  const icon = requireText(body.icon || '🏷️', 'ícone', 8);
  const archived = body.archived ? 1 : 0;
  db.prepare('UPDATE categories SET name=?, color=?, icon=?, archived=? WHERE id=?').run(name, color, icon, archived, id);
  return { ok: true };
});

route('DELETE', /^\/api\/categories\/(\d+)$/, (req, m) => {
  const id = Number(m[1]);
  const used = db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE category_id = ?').get(id).n
    + db.prepare('SELECT COUNT(*) AS n FROM recurring WHERE category_id = ?').get(id).n;
  if (used > 0) throw new ApiError(409, 'Esta categoria está em uso. Em vez de excluir, arquive-a para preservar o histórico.');
  db.prepare('DELETE FROM budgets WHERE category_id = ?').run(id);
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  return { ok: true };
});

// --- Lançamentos ---
route('GET', /^\/api\/transactions$/, (req, m, q) => {
  const clauses = [];
  const params = [];
  if (q.month && RE_MONTH.test(q.month)) { clauses.push('substr(t.date,1,7) = ?'); params.push(q.month); }
  if (q.type) { clauses.push('t.type = ?'); params.push(requireOneOf(q.type, 'tipo', ['receita', 'despesa', 'transferencia'])); }
  if (q.status) { clauses.push('t.status = ?'); params.push(requireOneOf(q.status, 'status', ['pago', 'pendente'])); }
  if (q.category_id) { clauses.push('t.category_id = ?'); params.push(requireInt(q.category_id, 'categoria')); }
  if (q.account_id) { clauses.push('(t.account_id = ? OR t.to_account_id = ?)'); const id = requireInt(q.account_id, 'conta'); params.push(id, id); }
  if (q.q) { clauses.push("(t.description LIKE ? OR COALESCE(t.notes,'') LIKE ?)"); const like = `%${q.q}%`; params.push(like, like); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const items = db.prepare(`
    SELECT t.*, c.name AS category_name, c.color AS category_color, c.icon AS category_icon,
           a.name AS account_name, a2.name AS to_account_name
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN accounts a2 ON a2.id = t.to_account_id
    ${where}
    ORDER BY t.date DESC, t.id DESC
    LIMIT 1000
  `).all(...params);
  let receitas = 0, despesas = 0;
  for (const t of items) {
    if (t.type === 'receita') receitas += t.amount;
    if (t.type === 'despesa') despesas += t.amount;
  }
  return { items, totals: { receitas, despesas, saldo: receitas - despesas } };
});

route('POST', /^\/api\/transactions$/, (req, m, q, body) => {
  const v = validateTransactionBody(body);
  const installments = body.installments ? requireInt(body.installments, 'parcelas', { min: 1, max: 48 }) : 1;

  if (installments === 1 || v.type !== 'despesa') {
    const r = db.prepare(`INSERT INTO transactions (type, description, amount, date, account_id, to_account_id, category_id, status, notes)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(v.type, v.description, v.amount, v.date, v.account_id, v.to_account_id, v.category_id, v.status, v.notes);
    return { id: Number(r.lastInsertRowid) };
  }

  // Compra parcelada: v.amount é o valor TOTAL; divide em N parcelas mensais.
  // A sobra do arredondamento vai na 1ª parcela para o total bater ao centavo.
  const base = Math.floor(v.amount / installments);
  if (base < 1) throw new ApiError(400, 'Valor total muito baixo para esse número de parcelas.');
  const group = `p${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const ins = db.prepare(`INSERT INTO transactions (type, description, amount, date, account_id, to_account_id, category_id, status, notes, installment_group, installment_no, installment_total)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  let firstId = null;
  for (let i = 0; i < installments; i++) {
    const amount = i === 0 ? v.amount - base * (installments - 1) : base;
    const date = addMonthsClamped(v.date, i);
    const status = i === 0 ? v.status : 'pendente';
    const r = ins.run(v.type, v.description, amount, date, v.account_id, v.to_account_id, v.category_id, status, v.notes, group, i + 1, installments);
    if (i === 0) firstId = Number(r.lastInsertRowid);
  }
  return { id: firstId, installments };
});

route('PUT', /^\/api\/transactions\/(\d+)$/, (req, m, q, body) => {
  const id = Number(m[1]);
  if (!db.prepare('SELECT id FROM transactions WHERE id = ?').get(id)) throw new ApiError(404, 'Lançamento não encontrado.');
  const v = validateTransactionBody(body);
  // Editar um lançamento invalida a conferência dele (dos dois lados) — precisa conciliar de novo
  db.prepare(`UPDATE transactions SET type=?, description=?, amount=?, date=?, account_id=?, to_account_id=?, category_id=?, status=?, notes=?, reconciled=0, reconciled_in=0 WHERE id=?`)
    .run(v.type, v.description, v.amount, v.date, v.account_id, v.to_account_id, v.category_id, v.status, v.notes, id);
  return { ok: true };
});

route('DELETE', /^\/api\/transactions\/(\d+)$/, (req, m) => {
  db.prepare('DELETE FROM transactions WHERE id = ?').run(Number(m[1]));
  return { ok: true };
});

route('POST', /^\/api\/transactions\/(\d+)\/toggle-status$/, (req, m) => {
  const tx = db.prepare('SELECT status FROM transactions WHERE id = ?').get(Number(m[1]));
  if (!tx) throw new ApiError(404, 'Lançamento não encontrado.');
  const next = tx.status === 'pago' ? 'pendente' : 'pago';
  // Voltar para pendente também desfaz a conferência da conciliação (dos dois lados)
  db.prepare(`UPDATE transactions SET status = ?${next === 'pendente' ? ', reconciled = 0, reconciled_in = 0' : ''} WHERE id = ?`).run(next, Number(m[1]));
  return { status: next };
});

// --- Orçamentos ---
route('GET', /^\/api\/budgets$/, (req, m, q) => {
  const month = q.month && RE_MONTH.test(q.month) ? q.month : currentMonth();
  return budgetsWithSpent(month);
});

route('POST', /^\/api\/budgets$/, (req, m, q, body) => {
  const category_id = requireInt(body.category_id, 'categoria', { min: 1 });
  const amount = requireInt(body.amount, 'valor', { min: 1 });
  const cat = db.prepare('SELECT kind FROM categories WHERE id = ?').get(category_id);
  if (!cat || cat.kind !== 'despesa') throw new ApiError(400, 'Orçamentos só podem ser definidos para categorias de despesa.');
  db.prepare(`INSERT INTO budgets (category_id, amount) VALUES (?,?)
              ON CONFLICT(category_id) DO UPDATE SET amount = excluded.amount`).run(category_id, amount);
  return { ok: true };
});

route('DELETE', /^\/api\/budgets\/(\d+)$/, (req, m) => {
  db.prepare('DELETE FROM budgets WHERE id = ?').run(Number(m[1]));
  return { ok: true };
});

// --- Recorrências ---
route('GET', /^\/api\/recurring$/, () =>
  db.prepare(`
    SELECT r.*, c.name AS category_name, c.icon AS category_icon, a.name AS account_name
    FROM recurring r
    LEFT JOIN categories c ON c.id = r.category_id
    JOIN accounts a ON a.id = r.account_id
    ORDER BY r.active DESC, r.day
  `).all());

function validateRecurringBody(body) {
  const description = requireText(body.description, 'descrição');
  const amount = requireInt(body.amount, 'valor', { min: 1 });
  const type = requireOneOf(body.type, 'tipo', ['receita', 'despesa']);
  const day = requireInt(body.day, 'dia', { min: 1, max: 31 });
  const account_id = requireInt(body.account_id, 'conta', { min: 1 });
  const category_id = requireInt(body.category_id, 'categoria', { min: 1 });
  if (!db.prepare('SELECT id FROM accounts WHERE id = ?').get(account_id)) throw new ApiError(400, 'Conta não encontrada.');
  const cat = db.prepare('SELECT kind FROM categories WHERE id = ?').get(category_id);
  if (!cat) throw new ApiError(400, 'Categoria não encontrada.');
  if (cat.kind !== type) throw new ApiError(400, 'A categoria escolhida não corresponde ao tipo.');
  return { description, amount, type, day, account_id, category_id, active: body.active === false ? 0 : 1 };
}

route('POST', /^\/api\/recurring$/, (req, m, q, body) => {
  const v = validateRecurringBody(body);
  const r = db.prepare('INSERT INTO recurring (description, amount, type, day, account_id, category_id, active) VALUES (?,?,?,?,?,?,?)')
    .run(v.description, v.amount, v.type, v.day, v.account_id, v.category_id, v.active);
  return { id: Number(r.lastInsertRowid) };
});

route('PUT', /^\/api\/recurring\/(\d+)$/, (req, m, q, body) => {
  const id = Number(m[1]);
  if (!db.prepare('SELECT id FROM recurring WHERE id = ?').get(id)) throw new ApiError(404, 'Recorrência não encontrada.');
  const v = validateRecurringBody(body);
  db.prepare('UPDATE recurring SET description=?, amount=?, type=?, day=?, account_id=?, category_id=?, active=? WHERE id=?')
    .run(v.description, v.amount, v.type, v.day, v.account_id, v.category_id, v.active, id);
  return { ok: true };
});

route('DELETE', /^\/api\/recurring\/(\d+)$/, (req, m) => {
  db.prepare('DELETE FROM recurring WHERE id = ?').run(Number(m[1]));
  return { ok: true };
});

route('POST', /^\/api\/recurring\/generate$/, (req, m, q, body) => {
  const month = body && body.month && RE_MONTH.test(body.month) ? body.month : currentMonth();
  const created = generateRecurringForMonth(month);
  return { created, month };
});

// --- Metas ---
route('GET', /^\/api\/goals$/, () => db.prepare('SELECT * FROM goals ORDER BY (saved >= target), deadline IS NULL, deadline').all());

route('POST', /^\/api\/goals$/, (req, m, q, body) => {
  const name = requireText(body.name, 'nome');
  const target = requireInt(body.target, 'valor da meta', { min: 1 });
  const saved = requireInt(body.saved ?? 0, 'valor guardado', { min: 0 });
  const deadline = body.deadline ? requireDate(body.deadline, 'prazo') : null;
  const color = requireColor(body.color, '#10b981');
  const r = db.prepare('INSERT INTO goals (name, target, saved, deadline, color) VALUES (?,?,?,?,?)')
    .run(name, target, saved, deadline, color);
  return { id: Number(r.lastInsertRowid) };
});

route('PUT', /^\/api\/goals\/(\d+)$/, (req, m, q, body) => {
  const id = Number(m[1]);
  if (!db.prepare('SELECT id FROM goals WHERE id = ?').get(id)) throw new ApiError(404, 'Meta não encontrada.');
  const name = requireText(body.name, 'nome');
  const target = requireInt(body.target, 'valor da meta', { min: 1 });
  const saved = requireInt(body.saved ?? 0, 'valor guardado', { min: 0 });
  const deadline = body.deadline ? requireDate(body.deadline, 'prazo') : null;
  const color = requireColor(body.color, '#10b981');
  db.prepare('UPDATE goals SET name=?, target=?, saved=?, deadline=?, color=? WHERE id=?')
    .run(name, target, saved, deadline, color, id);
  return { ok: true };
});

route('DELETE', /^\/api\/goals\/(\d+)$/, (req, m) => {
  db.prepare('DELETE FROM goals WHERE id = ?').run(Number(m[1]));
  return { ok: true };
});

route('POST', /^\/api\/goals\/(\d+)\/add$/, (req, m, q, body) => {
  const id = Number(m[1]);
  const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(id);
  if (!goal) throw new ApiError(404, 'Meta não encontrada.');
  const amount = requireInt(body.amount, 'valor');
  const saved = Math.max(0, goal.saved + amount);
  db.prepare('UPDATE goals SET saved = ? WHERE id = ?').run(saved, id);
  return { saved };
});

// --- Dashboard ---
route('GET', /^\/api\/dashboard$/, (req, m, q) => {
  const month = q.month && RE_MONTH.test(q.month) ? q.month : currentMonth();
  if (month === currentMonth()) generateRecurringForMonth(month);

  const accounts = listAccounts().filter((a) => !a.archived);
  const totalBalance = accounts.reduce((s, a) => s + a.balance, 0);
  const totals = monthTotals(month);

  const byCategory = db.prepare(`
    SELECT c.id, c.name, c.color, c.icon, SUM(t.amount) AS total
    FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE t.type = 'despesa' AND substr(t.date,1,7) = ?
    GROUP BY c.id ORDER BY total DESC
  `).all(month);

  // Últimos 6 meses terminando no mês selecionado
  const [y, mo] = month.split('-').map(Number);
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(y, mo - 1 - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const history = months.map((mm) => {
    const t = monthTotals(mm);
    return { month: mm, receitas: t.receitas, despesas: t.despesas };
  });

  const upcoming = db.prepare(`
    SELECT t.*, c.name AS category_name, c.icon AS category_icon, a.name AS account_name
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    JOIN accounts a ON a.id = t.account_id
    WHERE t.status = 'pendente' AND substr(t.date,1,7) = ?
    ORDER BY t.date LIMIT 8
  `).all(month);

  return {
    month,
    totalBalance,
    receitas: totals.receitas,
    despesas: totals.despesas,
    resultado: totals.receitas - totals.despesas,
    pendentes: { despesas: totals.despesas_pendentes, receitas: totals.receitas_pendentes },
    accounts,
    byCategory,
    history,
    upcoming,
    budgets: budgetsWithSpent(month),
    goals: db.prepare('SELECT * FROM goals ORDER BY (saved >= target), deadline IS NULL, deadline LIMIT 4').all(),
  };
});

// --- Conciliação: confere o app contra o extrato real do banco ---
const RECONCILED_BALANCE_SQL = `
  a.initial_balance
  + COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.account_id = a.id AND t.type = 'receita' AND t.status = 'pago' AND t.reconciled = 1), 0)
  - COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.account_id = a.id AND t.type = 'despesa' AND t.status = 'pago' AND t.reconciled = 1), 0)
  - COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.account_id = a.id AND t.type = 'transferencia' AND t.status = 'pago' AND t.reconciled = 1), 0)
  + COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.to_account_id = a.id AND t.type = 'transferencia' AND t.status = 'pago' AND t.reconciled_in = 1), 0)
`;

route('GET', /^\/api\/reconcile$/, (req, m, q) => {
  const account_id = requireInt(q.account_id, 'conta', { min: 1 });
  const account = db.prepare(`SELECT a.*, (${BALANCE_SQL}) AS balance, (${RECONCILED_BALANCE_SQL}) AS reconciled_balance
    FROM accounts a WHERE a.id = ?`).get(account_id);
  if (!account) throw new ApiError(404, 'Conta não encontrada.');
  const items = db.prepare(`
    SELECT t.*, c.name AS category_name, c.icon AS category_icon,
           a.name AS account_name, a2.name AS to_account_name
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN accounts a2 ON a2.id = t.to_account_id
    WHERE t.status = 'pago' AND ((t.account_id = ? AND t.reconciled = 0) OR (t.to_account_id = ? AND t.reconciled_in = 0))
    ORDER BY t.date, t.id
  `).all(account_id, account_id);
  // efeito de cada lançamento NESTA conta (transferência recebida entra positiva)
  for (const t of items) {
    t.effect = t.type === 'receita' ? t.amount
      : t.type === 'despesa' ? -t.amount
      : (t.to_account_id === account_id ? t.amount : -t.amount);
  }
  return { account, items };
});

// Decide qual lado da conferência mexer: transferência RECEBIDA nesta conta usa
// reconciled_in; todo o resto (receita, despesa, transferência enviada) usa reconciled.
function reconcileFlagFor(tx, account_id) {
  return tx.type === 'transferencia' && tx.to_account_id === account_id ? 'reconciled_in' : 'reconciled';
}

route('POST', /^\/api\/reconcile\/toggle$/, (req, m, q, body) => {
  const id = requireInt(body.id, 'lançamento', { min: 1 });
  const account_id = requireInt(body.account_id, 'conta', { min: 1 });
  const tx = db.prepare('SELECT type, to_account_id, reconciled, reconciled_in FROM transactions WHERE id = ?').get(id);
  if (!tx) throw new ApiError(404, 'Lançamento não encontrado.');
  const flag = reconcileFlagFor(tx, account_id);
  const next = tx[flag] ? 0 : 1;
  db.prepare(`UPDATE transactions SET ${flag} = ? WHERE id = ?`).run(next, id);
  return { [flag]: next };
});

route('POST', /^\/api\/reconcile\/bulk$/, (req, m, q, body) => {
  if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 5000) {
    throw new ApiError(400, 'Lista de lançamentos inválida.');
  }
  const account_id = requireInt(body.account_id, 'conta', { min: 1 });
  const value = body.value ? 1 : 0;
  const getTx = db.prepare('SELECT type, to_account_id FROM transactions WHERE id = ?');
  const setOut = db.prepare('UPDATE transactions SET reconciled = ? WHERE id = ?');
  const setIn = db.prepare('UPDATE transactions SET reconciled_in = ? WHERE id = ?');
  let changed = 0;
  for (const rawId of body.ids) {
    const id = requireInt(rawId, 'lançamento', { min: 1 });
    const tx = getTx.get(id);
    if (!tx) continue;
    const stmt = reconcileFlagFor(tx, account_id) === 'reconciled_in' ? setIn : setOut;
    changed += Number(stmt.run(value, id).changes);
  }
  return { changed, value };
});

// Cria um lançamento de ajuste para o saldo conferido bater com o saldo real do banco
route('POST', /^\/api\/reconcile\/adjust$/, (req, m, q, body) => {
  const account_id = requireInt(body.account_id, 'conta', { min: 1 });
  const bank_balance = requireInt(body.bank_balance, 'saldo do banco');
  const account = db.prepare(`SELECT a.*, (${RECONCILED_BALANCE_SQL}) AS reconciled_balance FROM accounts a WHERE a.id = ?`).get(account_id);
  if (!account) throw new ApiError(404, 'Conta não encontrada.');
  const diff = bank_balance - account.reconciled_balance;
  if (diff === 0) throw new ApiError(400, 'Os saldos já estão iguais — nada a ajustar.');
  const kind = diff > 0 ? 'receita' : 'despesa';
  let cat = db.prepare("SELECT id FROM categories WHERE name = 'Ajuste de conciliação' AND kind = ?").get(kind);
  if (!cat) {
    const r = db.prepare('INSERT INTO categories (name, kind, color, icon) VALUES (?,?,?,?)')
      .run('Ajuste de conciliação', kind, '#94a3b8', '🧮');
    cat = { id: Number(r.lastInsertRowid) };
  }
  const r = db.prepare(`INSERT INTO transactions (type, description, amount, date, account_id, category_id, status, reconciled, notes)
    VALUES (?,?,?,?,?,?, 'pago', 1, ?)`)
    .run(kind, 'Ajuste de conciliação', Math.abs(diff), localToday(), account_id, cat.id,
      'Criado automaticamente para igualar o saldo conferido ao saldo real do banco.');
  return { id: Number(r.lastInsertRowid), diff, new_reconciled_balance: bank_balance };
});

// --- Fatura de cartão de crédito ---
// Fatura do mês M = despesas do cartão depois do fechamento de M-1 (exclusivo)
// até o fechamento de M (inclusivo). Vence no due_day de M — ou de M+1 quando o
// vencimento cai antes do fechamento, como é comum nos cartões brasileiros.
function closingDateOf(month, closingDay) {
  return `${month}-${String(Math.min(closingDay, daysInMonth(month))).padStart(2, '0')}`;
}

function cardInvoices(month) {
  const cards = db.prepare("SELECT * FROM accounts WHERE type = 'cartao' AND archived = 0 AND closing_day IS NOT NULL").all();
  const sum = db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM transactions
    WHERE account_id = ? AND type = 'despesa' AND date > ? AND date <= ?`);
  return cards.map((c) => {
    const closing = closingDateOf(month, c.closing_day);
    const prevClosing = closingDateOf(shiftMonthStr(month, -1), c.closing_day);
    const dueMonth = c.due_day && c.due_day > c.closing_day ? month : shiftMonthStr(month, 1);
    const due_date = c.due_day ? `${dueMonth}-${String(Math.min(c.due_day, daysInMonth(dueMonth))).padStart(2, '0')}` : null;
    return {
      account_id: c.id, name: c.name, color: c.color,
      from: prevClosing, closing_date: closing, due_date,
      total: sum.get(c.id, prevClosing, closing).total,
    };
  });
}

route('GET', /^\/api\/cards\/invoices$/, (req, m, q) => {
  const month = q.month && RE_MONTH.test(q.month) ? q.month : currentMonth();
  return cardInvoices(month);
});

// --- Radar financeiro (insights automáticos) ---
route('GET', /^\/api\/insights$/, (req, m, q) => {
  const month = q.month && RE_MONTH.test(q.month) ? q.month : currentMonth();
  const prev = shiftMonthStr(month, -1);
  const cur = monthTotals(month);
  const prv = monthTotals(prev);
  const today = localToday();
  const isCurrent = month === currentMonth();
  const insights = [];

  // Comparação de despesas com o mês anterior (só faz sentido com mês anterior movimentado)
  if (prv.despesas > 0 && cur.despesas > 0) {
    const diff = cur.despesas - prv.despesas;
    const pct = Math.round((diff / prv.despesas) * 100);
    if (pct <= -5) insights.push({ icon: '📉', tone: 'good', text: `Suas despesas estão ${Math.abs(pct)}% menores que em ${monthName(prev)}. Continue assim!` });
    else if (pct >= 10) insights.push({ icon: '📈', tone: 'warn', text: `Suas despesas estão ${pct}% maiores que em ${monthName(prev)} (${fmtBRL(diff)} a mais).` });
  }

  // Categoria que mais cresceu vs mês anterior
  const growth = db.prepare(`
    SELECT c.name, c.icon,
      SUM(CASE WHEN substr(t.date,1,7) = ? THEN t.amount ELSE 0 END) AS cur,
      SUM(CASE WHEN substr(t.date,1,7) = ? THEN t.amount ELSE 0 END) AS prev
    FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE t.type = 'despesa' AND substr(t.date,1,7) IN (?,?)
    GROUP BY c.id HAVING cur > prev AND prev > 0 ORDER BY (cur - prev) DESC LIMIT 1
  `).get(month, prev, month, prev);
  if (growth && growth.cur - growth.prev >= 5000) {
    insights.push({ icon: growth.icon, tone: 'warn', text: `${growth.name} foi a categoria que mais cresceu: ${fmtBRL(growth.prev)} → ${fmtBRL(growth.cur)}.` });
  }

  // Orçamentos perto do limite ou estourados
  for (const b of budgetsWithSpent(month)) {
    const pct = Math.round((b.spent / b.amount) * 100);
    if (pct >= 100) insights.push({ icon: '🚨', tone: 'bad', text: `Orçamento de ${b.name} estourado: ${fmtBRL(b.spent)} de ${fmtBRL(b.amount)} (${pct}%).` });
    else if (pct >= 80) insights.push({ icon: '⚠️', tone: 'warn', text: `Orçamento de ${b.name} em ${pct}% — restam ${fmtBRL(b.amount - b.spent)}.` });
  }

  // Contas vencendo nos próximos 7 dias (apenas no mês corrente)
  if (isCurrent) {
    const limit = new Date();
    limit.setDate(limit.getDate() + 7);
    const limitIso = `${limit.getFullYear()}-${String(limit.getMonth() + 1).padStart(2, '0')}-${String(limit.getDate()).padStart(2, '0')}`;
    const due = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM transactions
      WHERE status = 'pendente' AND type = 'despesa' AND date >= ? AND date <= ?`).get(today, limitIso);
    if (due.n > 0) insights.push({ icon: '⏰', tone: 'warn', text: `${due.n} conta(s) vencendo nos próximos 7 dias, totalizando ${fmtBRL(due.total)}.` });
    const late = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM transactions
      WHERE status = 'pendente' AND type = 'despesa' AND date < ?`).get(today);
    if (late.n > 0) insights.push({ icon: '🔴', tone: 'bad', text: `${late.n} conta(s) atrasada(s) somando ${fmtBRL(late.total)}. Vale conferir!` });

    // Fatura de cartão vencendo em até 7 dias
    for (const inv of cardInvoices(month)) {
      if (!inv.due_date || inv.total <= 0) continue;
      const days = Math.round((new Date(inv.due_date) - new Date(today)) / 86400000);
      if (days >= 0 && days <= 7) {
        insights.push({ icon: '💳', tone: 'warn', text: `Fatura do cartão ${inv.name} (${fmtBRL(inv.total)}) vence ${days === 0 ? 'HOJE' : `em ${days} dia(s)`} — dia ${inv.due_date.slice(8, 10)}/${inv.due_date.slice(5, 7)}.` });
      }
    }
  }

  // Taxa de poupança do mês
  if (cur.receitas > 0) {
    const rate = Math.round(((cur.receitas - cur.despesas) / cur.receitas) * 100);
    if (rate >= 20) insights.push({ icon: '🌟', tone: 'good', text: `Taxa de poupança de ${rate}% — excelente! (o recomendado é ao menos 20%)` });
    else if (rate < 0) insights.push({ icon: '🆘', tone: 'bad', text: `Neste mês você está gastando mais do que ganha (${rate}% de poupança).` });
  }

  // Maior despesa do mês
  const biggest = db.prepare(`SELECT description, amount FROM transactions
    WHERE type = 'despesa' AND substr(date,1,7) = ? ORDER BY amount DESC LIMIT 1`).get(month);
  if (biggest && cur.despesas > 0 && biggest.amount >= cur.despesas * 0.3) {
    insights.push({ icon: '🐘', tone: 'info', text: `"${biggest.description}" sozinho representa ${Math.round((biggest.amount / cur.despesas) * 100)}% das despesas do mês.` });
  }

  // Projeção de fim de mês (ritmo atual + pendentes)
  let projection = null;
  if (isCurrent) {
    const dayOfMonth = Number(today.slice(8, 10));
    const totalDays = daysInMonth(month);
    const paid = db.prepare(`SELECT COALESCE(SUM(amount),0) AS t FROM transactions
      WHERE type = 'despesa' AND status = 'pago' AND substr(date,1,7) = ?`).get(month).t;
    const pace = dayOfMonth > 0 ? Math.round((paid / dayOfMonth) * totalDays) : paid;
    projection = Math.max(pace, cur.despesas);
    if (cur.receitas > 0 && projection > cur.receitas) {
      insights.push({ icon: '🔮', tone: 'warn', text: `No ritmo atual, as despesas devem fechar o mês em ${fmtBRL(projection)} — acima das receitas de ${fmtBRL(cur.receitas)}.` });
    }
  }

  if (!insights.length) insights.push({ icon: '✨', tone: 'info', text: 'Tudo tranquilo por aqui. Continue registrando seus lançamentos para eu te trazer análises.' });
  return { month, insights, projection };
});

function monthName(month) {
  const [y, mo] = month.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });
}
function fmtBRL(cents) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// --- Sugestões para autocompletar (baseado no histórico) ---
route('GET', /^\/api\/suggestions$/, () =>
  db.prepare(`
    SELECT description, type, category_id, account_id, amount, COUNT(*) AS uses, MAX(date) AS last_used
    FROM transactions WHERE type IN ('receita','despesa')
    GROUP BY description COLLATE NOCASE, type
    ORDER BY uses DESC, last_used DESC LIMIT 150
  `).all());

// --- Patrimônio: evolução do saldo total mês a mês ---
const NETWORTH_SQL = `
  SELECT COALESCE(SUM(
    a.initial_balance
    + COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.account_id = a.id AND t.type = 'receita' AND t.status = 'pago' AND t.date <= ?), 0)
    - COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.account_id = a.id AND t.type = 'despesa' AND t.status = 'pago' AND t.date <= ?), 0)
    - COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.account_id = a.id AND t.type = 'transferencia' AND t.status = 'pago' AND t.date <= ?), 0)
    + COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.to_account_id = a.id AND t.type = 'transferencia' AND t.status = 'pago' AND t.date <= ?), 0)
  ), 0) AS total FROM accounts a WHERE a.archived = 0`;

route('GET', /^\/api\/reports\/networth$/, (req, m, q) => {
  const n = Math.min(Math.max(Number(q.months) || 12, 2), 36);
  const stmt = db.prepare(NETWORTH_SQL);
  const now = currentMonth();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const mm = shiftMonthStr(now, -i);
    const end = `${mm}-${String(daysInMonth(mm)).padStart(2, '0')}`;
    out.push({ month: mm, total: stmt.get(end, end, end, end).total });
  }
  return out;
});

// --- Comparativo com o mês anterior, por categoria ---
route('GET', /^\/api\/reports\/compare$/, (req, m, q) => {
  const month = q.month && RE_MONTH.test(q.month) ? q.month : currentMonth();
  const prev = shiftMonthStr(month, -1);
  const rows = db.prepare(`
    SELECT c.id, c.name, c.kind, c.color, c.icon,
      SUM(CASE WHEN substr(t.date,1,7) = ? THEN t.amount ELSE 0 END) AS cur,
      SUM(CASE WHEN substr(t.date,1,7) = ? THEN t.amount ELSE 0 END) AS prev
    FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE t.type IN ('receita','despesa') AND substr(t.date,1,7) IN (?,?)
    GROUP BY c.id HAVING cur > 0 OR prev > 0
    ORDER BY cur DESC
  `).all(month, prev, month, prev);
  return {
    month, prev,
    despesas: rows.filter((r) => r.kind === 'despesa'),
    receitas: rows.filter((r) => r.kind === 'receita'),
  };
});

// --- Importação de extrato (o navegador envia as linhas já interpretadas) ---
route('POST', /^\/api\/import$/, (req, m, q, body) => {
  const account_id = requireInt(body.account_id, 'conta', { min: 1 });
  if (!db.prepare('SELECT id FROM accounts WHERE id = ?').get(account_id)) throw new ApiError(400, 'Conta não encontrada.');
  const catDespesa = requireInt(body.expense_category_id, 'categoria de despesa', { min: 1 });
  const catReceita = requireInt(body.income_category_id, 'categoria de receita', { min: 1 });
  if (!Array.isArray(body.items) || body.items.length === 0) throw new ApiError(400, 'Nenhum lançamento para importar.');
  if (body.items.length > 2000) throw new ApiError(400, 'Máximo de 2000 lançamentos por importação.');

  const dupCheck = db.prepare(`SELECT id FROM transactions
    WHERE account_id = ? AND date = ? AND amount = ? AND description = ? COLLATE NOCASE LIMIT 1`);
  const ins = db.prepare(`INSERT INTO transactions (type, description, amount, date, account_id, category_id, status)
    VALUES (?,?,?,?,?,?, 'pago')`);

  let created = 0, skipped = 0;
  for (const item of body.items) {
    const type = requireOneOf(item.type, 'tipo', ['receita', 'despesa']);
    const description = requireText(item.description, 'descrição');
    const amount = requireInt(item.amount, 'valor', { min: 1 });
    const date = requireDate(item.date, 'data');
    if (dupCheck.get(account_id, date, amount, description)) { skipped++; continue; }
    ins.run(type, description, amount, date, account_id, type === 'despesa' ? catDespesa : catReceita);
    created++;
  }
  return { created, skipped };
});

// --- Relatórios ---
route('GET', /^\/api\/reports\/summary$/, (req, m, q) => {
  const from = q.from && RE_DATE.test(q.from) ? q.from : `${currentMonth()}-01`;
  const to = q.to && RE_DATE.test(q.to) ? q.to : localToday();
  const rows = db.prepare(`
    SELECT c.id, c.name, c.kind, c.color, c.icon, SUM(t.amount) AS total, COUNT(*) AS count
    FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE t.date >= ? AND t.date <= ? AND t.type IN ('receita','despesa')
    GROUP BY c.id ORDER BY total DESC
  `).all(from, to);
  const receitas = rows.filter((r) => r.kind === 'receita');
  const despesas = rows.filter((r) => r.kind === 'despesa');
  return {
    from, to,
    receitas, despesas,
    totalReceitas: receitas.reduce((s, r) => s + r.total, 0),
    totalDespesas: despesas.reduce((s, r) => s + r.total, 0),
  };
});

route('GET', /^\/api\/reports\/monthly$/, (req, m, q) => {
  const n = Math.min(Math.max(Number(q.months) || 12, 1), 36);
  const now = currentMonth();
  const [y, mo] = now.split('-').map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, mo - 1 - i, 1);
    const mm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const t = monthTotals(mm);
    out.push({ month: mm, receitas: t.receitas, despesas: t.despesas, resultado: t.receitas - t.despesas });
  }
  return out;
});

// --- Fluxo de caixa projetado ---
// Projeta o saldo total dia a dia: começa do saldo real (pago) e vai somando
// pendências futuras (incluindo parcelas), atrasados (contam como "hoje") e
// recorrências de meses que ainda nem foram gerados. Transferências não mudam o total.
route('GET', /^\/api\/reports\/cashflow$/, (req, m, q) => {
  const days = Math.min(Math.max(Number(q.days) || 30, 7), 120);
  const today = localToday();
  const addDays = (iso, n) => {
    const d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const endDate = addDays(today, days);

  const start = db.prepare(`SELECT COALESCE(SUM((${BALANCE_SQL})), 0) AS total FROM accounts a WHERE a.archived = 0`).get().total;

  const deltas = {}; // date -> variação do dia (centavos)
  const bump = (date, v) => { deltas[date] = (deltas[date] || 0) + v; };

  // pendências (parcelas futuras já são lançamentos pendentes)
  const pend = db.prepare(`
    SELECT date, COALESCE(SUM(CASE WHEN type = 'receita' THEN amount WHEN type = 'despesa' THEN -amount ELSE 0 END), 0) AS delta
    FROM transactions WHERE status = 'pendente' AND date <= ? GROUP BY date
  `).all(endDate);
  for (const r of pend) bump(r.date < today ? today : r.date, r.delta);

  // recorrências de meses futuros ainda não gerados dentro da janela
  const recs = db.prepare("SELECT * FROM recurring WHERE active = 1").all();
  const genExists = db.prepare('SELECT 1 FROM transactions WHERE recurring_id = ? AND substr(date, 1, 7) = ?');
  let mm = currentMonth();
  while (mm <= endDate.slice(0, 7)) {
    for (const r of recs) {
      if (genExists.get(r.id, mm)) continue;
      const date = `${mm}-${String(Math.min(r.day, daysInMonth(mm))).padStart(2, '0')}`;
      if (date < today || date > endDate) continue;
      bump(date, r.type === 'receita' ? r.amount : -r.amount);
    }
    mm = shiftMonthStr(mm, 1);
  }

  let running = start;
  const points = [];
  let firstNegative = null;
  for (let i = 0; i <= days; i++) {
    const date = addDays(today, i);
    running += deltas[date] || 0;
    points.push({ date, balance: running });
    if (firstNegative === null && running < 0) firstNegative = date;
  }
  return { start, points, firstNegative };
});

// --- Visão anual: matriz categoria × 12 meses ---
route('GET', /^\/api\/reports\/annual$/, (req, m, q) => {
  const year = /^\d{4}$/.test(q.year || '') ? q.year : localToday().slice(0, 4);
  const rows = db.prepare(`
    SELECT c.id, c.name, c.kind, c.icon, c.color, CAST(substr(t.date, 6, 2) AS INTEGER) AS mm, SUM(t.amount) AS total
    FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE substr(t.date, 1, 4) = ? AND t.type IN ('receita', 'despesa')
    GROUP BY c.id, mm
  `).all(year);
  const cats = new Map();
  for (const r of rows) {
    if (!cats.has(r.id)) cats.set(r.id, { id: r.id, name: r.name, kind: r.kind, icon: r.icon, color: r.color, months: Array(12).fill(0), total: 0 });
    const c = cats.get(r.id);
    c.months[r.mm - 1] += r.total;
    c.total += r.total;
  }
  const list = [...cats.values()].sort((a, b) => b.total - a.total);
  const sumKind = (kind) => {
    const months = Array(12).fill(0);
    let total = 0;
    for (const c of list.filter((x) => x.kind === kind)) {
      c.months.forEach((v, i) => { months[i] += v; });
      total += c.total;
    }
    return { months, total };
  };
  return {
    year,
    receitas: list.filter((c) => c.kind === 'receita'),
    despesas: list.filter((c) => c.kind === 'despesa'),
    totalReceitas: sumKind('receita'),
    totalDespesas: sumKind('despesa'),
  };
});

// --- Comprovantes anexados (foto ou PDF por lançamento) ---
const ANEXOS_DIR = path.join(ROOT, 'anexos');
fs.mkdirSync(ANEXOS_DIR, { recursive: true });
const ATTACH_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };

route('POST', /^\/api\/transactions\/(\d+)\/attachment$/, (req, m, q, body) => {
  const id = Number(m[1]);
  const tx = db.prepare('SELECT attachment FROM transactions WHERE id = ?').get(id);
  if (!tx) throw new ApiError(404, 'Lançamento não encontrado.');
  const ext = String(body.ext || '').toLowerCase().replace('.', '');
  if (!ATTACH_EXT[ext]) throw new ApiError(400, 'Formato não aceito. Use JPG, PNG, WEBP ou PDF.');
  const b64 = String(body.data || '').replace(/^data:[^;]+;base64,/, '');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 100) throw new ApiError(400, 'Arquivo vazio ou inválido.');
  if (buf.length > 8 * 1024 * 1024) throw new ApiError(400, 'Arquivo muito grande (máximo 8 MB).');
  if (tx.attachment) { try { fs.unlinkSync(path.join(ANEXOS_DIR, tx.attachment)); } catch {} }
  const name = `tx${id}-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(ANEXOS_DIR, name), buf);
  db.prepare('UPDATE transactions SET attachment = ? WHERE id = ?').run(name, id);
  return { attachment: name };
});

route('DELETE', /^\/api\/transactions\/(\d+)\/attachment$/, (req, m) => {
  const id = Number(m[1]);
  const tx = db.prepare('SELECT attachment FROM transactions WHERE id = ?').get(id);
  if (!tx) throw new ApiError(404, 'Lançamento não encontrado.');
  if (tx.attachment) { try { fs.unlinkSync(path.join(ANEXOS_DIR, tx.attachment)); } catch {} }
  db.prepare('UPDATE transactions SET attachment = NULL WHERE id = ?').run(id);
  return { ok: true };
});

route('GET', /^\/api\/attachments\/([A-Za-z0-9][\w.-]{0,80})$/, (req, m, q, body, res) => {
  const file = path.normalize(path.join(ANEXOS_DIR, m[1]));
  if (!file.startsWith(ANEXOS_DIR + path.sep) || !fs.existsSync(file)) throw new ApiError(404, 'Comprovante não encontrado.');
  const ext = path.extname(file).slice(1).toLowerCase();
  res.writeHead(200, { 'Content-Type': ATTACH_EXT[ext] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
  return null;
});

// --- Restauração de backup (substitui TODOS os dados pelos do arquivo) ---
route('POST', /^\/api\/restore$/, (req, m, q, body) => {
  const b = body.backup;
  if (!b || !Array.isArray(b.accounts) || !Array.isArray(b.categories) || !Array.isArray(b.transactions)) {
    throw new ApiError(400, 'Arquivo de backup inválido — use um arquivo gerado pelo botão "Backup completo".');
  }
  db.exec('BEGIN');
  try {
    for (const t of ['transactions', 'budgets', 'recurring', 'goals', 'categories', 'accounts']) db.exec(`DELETE FROM ${t}`);
    const insAcc = db.prepare('INSERT INTO accounts (id, name, type, initial_balance, color, archived, closing_day, due_day) VALUES (?,?,?,?,?,?,?,?)');
    for (const a of b.accounts) insAcc.run(a.id, a.name, a.type || 'corrente', a.initial_balance || 0, a.color || '#6366f1', a.archived ? 1 : 0, a.closing_day ?? null, a.due_day ?? null);
    const insCat = db.prepare('INSERT INTO categories (id, name, kind, color, icon, archived) VALUES (?,?,?,?,?,?)');
    for (const c of b.categories) insCat.run(c.id, c.name, c.kind, c.color || '#64748b', c.icon || '🏷️', c.archived ? 1 : 0);
    const insTx = db.prepare(`INSERT INTO transactions (id, type, description, amount, date, account_id, to_account_id, category_id, status, notes, recurring_id, installment_group, installment_no, installment_total, reconciled, reconciled_in, attachment)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const t of b.transactions) insTx.run(t.id, t.type, t.description, t.amount, t.date, t.account_id, t.to_account_id ?? null, t.category_id ?? null, t.status || 'pago', t.notes ?? null, t.recurring_id ?? null, t.installment_group ?? null, t.installment_no ?? null, t.installment_total ?? null, t.reconciled ? 1 : 0, t.reconciled_in ? 1 : 0, t.attachment ?? null);
    const insBud = db.prepare('INSERT INTO budgets (id, category_id, amount) VALUES (?,?,?)');
    for (const x of b.budgets || []) insBud.run(x.id, x.category_id, x.amount);
    const insRec = db.prepare('INSERT INTO recurring (id, description, amount, type, day, account_id, category_id, active) VALUES (?,?,?,?,?,?,?,?)');
    for (const x of b.recurring || []) insRec.run(x.id, x.description, x.amount, x.type, x.day, x.account_id, x.category_id ?? null, x.active ? 1 : 0);
    const insGoal = db.prepare('INSERT INTO goals (id, name, target, saved, deadline, color) VALUES (?,?,?,?,?,?)');
    for (const x of b.goals || []) insGoal.run(x.id, x.name, x.target, x.saved || 0, x.deadline ?? null, x.color || '#10b981');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw new ApiError(400, 'Falha ao restaurar — nada foi alterado. Detalhe: ' + err.message);
  }
  return {
    accounts: b.accounts.length, categories: b.categories.length, transactions: b.transactions.length,
    budgets: (b.budgets || []).length, recurring: (b.recurring || []).length, goals: (b.goals || []).length,
  };
});

// --- Exportações ---
function csvEscape(v) {
  const s = String(v ?? '');
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

route('GET', /^\/api\/export\/transactions\.csv$/, (req, m, q, body, res) => {
  const clauses = [];
  const params = [];
  if (q.from && RE_DATE.test(q.from)) { clauses.push('t.date >= ?'); params.push(q.from); }
  if (q.to && RE_DATE.test(q.to)) { clauses.push('t.date <= ?'); params.push(q.to); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const rows = db.prepare(`
    SELECT t.date, t.type, t.description, t.amount, t.status,
           c.name AS category, a.name AS account, a2.name AS to_account, t.notes
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN accounts a2 ON a2.id = t.to_account_id
    ${where} ORDER BY t.date, t.id
  `).all(...params);
  const header = 'Data;Tipo;Descrição;Valor;Status;Categoria;Conta;Conta destino;Observações';
  const lines = rows.map((r) => [
    r.date,
    r.type,
    csvEscape(r.description),
    (r.amount / 100).toFixed(2).replace('.', ','),
    r.status,
    csvEscape(r.category || ''),
    csvEscape(r.account),
    csvEscape(r.to_account || ''),
    csvEscape(r.notes || ''),
  ].join(';'));
  const csv = '﻿' + [header, ...lines].join('\r\n');
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="lancamentos.csv"',
  });
  res.end(csv);
  return null; // resposta já enviada
});

route('GET', /^\/api\/export\/backup\.json$/, (req, m, q, body, res) => {
  const backup = {
    exported_at: new Date().toISOString(),
    accounts: db.prepare('SELECT * FROM accounts').all(),
    categories: db.prepare('SELECT * FROM categories').all(),
    transactions: db.prepare('SELECT * FROM transactions').all(),
    budgets: db.prepare('SELECT * FROM budgets').all(),
    recurring: db.prepare('SELECT * FROM recurring').all(),
    goals: db.prepare('SELECT * FROM goals').all(),
  };
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': 'attachment; filename="backup-financeiro.json"',
  });
  res.end(JSON.stringify(backup, null, 2));
  return null;
});

// ---------------------------------------------------------------------------
// Servidor HTTP
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/manifest+json; charset=utf-8',
};

// Novo front (React) publicado em /novo — migração tela a tela em andamento
const NOVO_DIR = path.join(ROOT, 'public-novo');

function serveStatic(req, res, pathname) {
  let baseDir = PUBLIC_DIR;
  let rel;
  if (pathname === '/novo' || pathname.startsWith('/novo/')) {
    baseDir = NOVO_DIR;
    rel = pathname.replace(/^\/novo\/?/, '');
    // rota de aplicação (sem extensão) cai no index.html — padrão SPA
    if (!rel || !path.extname(rel)) rel = 'index.html';
  } else {
    rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  }
  const file = path.normalize(path.join(baseDir, rel));
  if (!file.startsWith(baseDir + path.sep)) {
    res.writeHead(403); res.end('Acesso negado'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Não encontrado'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 16e6) { reject(new ApiError(413, 'Corpo da requisição muito grande.')); req.destroy(); } // 16 MB: comprovantes em base64 e restauração de backup
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch { reject(new ApiError(400, 'JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // URL malformada (ex.: /%) não pode derrubar o servidor — responde 400 e segue
  let url, pathname;
  try {
    url = new URL(req.url, `http://localhost:${PORT}`);
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Requisição inválida');
    return;
  }

  if (!pathname.startsWith('/api/')) {
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    serveStatic(req, res, pathname);
    return;
  }

  const query = Object.fromEntries(url.searchParams.entries());
  try {
    // Com PIN definido, toda a API exige token de sessão (o token via ?token=
    // existe para os downloads de CSV/backup, que não conseguem enviar cabeçalho)
    if (!pathname.startsWith('/api/auth/') && pinIsSet()) {
      const token = req.headers['x-auth-token'] || query.token;
      if (!tokenValid(token)) throw new ApiError(401, 'Sessão expirada. Digite o PIN.');
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const match = pathname.match(r.pattern);
      if (!match) continue;
      const body = (req.method === 'POST' || req.method === 'PUT') ? await readBody(req) : {};
      const result = r.handler(req, match, query, body, res);
      if (result === null) return; // handler já respondeu (downloads)
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Rota não encontrada.' }));
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 500;
    if (status === 500) console.error(err);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: err.message || 'Erro interno.' }));
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log('O Financeiro Pessoal já está em execução. Abra http://localhost:' + PORT + ' no navegador.');
    process.exit(0);
  }
  throw err;
});

// Escuta em todas as interfaces para permitir acesso pelo celular na rede de casa.
// A proteção por PIN (configurável no app) cobre esse cenário.
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  💰 Financeiro Pessoal está no ar!');
  console.log('  Neste computador:   http://localhost:' + PORT);
  for (const u of lanUrls()) {
    console.log('  Pelo celular:       ' + u + '   (mesmo Wi-Fi)');
  }
  console.log('  Para encerrar, feche esta janela ou pressione Ctrl+C.');
  console.log('');
});
