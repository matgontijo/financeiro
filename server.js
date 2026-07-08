/*
 * Financeiro Pessoal — servidor (Node http nativo + Supabase/Postgres via REST)
 * Zero dependências npm: usa fetch global do Node 24 contra o PostgREST.
 * Todos os valores monetários são armazenados em CENTAVOS (inteiros).
 * Datas no formato ISO: YYYY-MM-DD.
 *
 * Cálculos pesados (saldos, séries, matriz anual) vivem como funções SQL no
 * banco — ver supabase/functions.sql (rodar uma vez no SQL Editor).
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');

// Em casa roda na 3345; em nuvem (Render etc.) a plataforma define a porta
const PORT = Number(process.env.PORT) || 3345;

// ---------------------------------------------------------------------------
// Configuração (.env local ou variáveis de ambiente na nuvem)
// ---------------------------------------------------------------------------

(function loadEnv() {
  try {
    const txt = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch { /* sem .env — usa só o ambiente */ }
})();

const SUPA_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPA_KEY = process.env.SUPABASE_SECRET_KEY || '';
if (!SUPA_URL || !SUPA_KEY) {
  console.error('');
  console.error('  ERRO: faltam as variáveis SUPABASE_URL e SUPABASE_SECRET_KEY.');
  console.error('  Local: crie um arquivo .env na pasta do app com as duas linhas.');
  console.error('  Render: painel do serviço > Environment > Add Environment Variable.');
  console.error('');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Cliente Supabase (PostgREST) — sem bibliotecas, só fetch
// ---------------------------------------------------------------------------

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function sreq(pathQS, { method = 'GET', body, prefer, range } = {}) {
  const headers = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  if (range) { headers.Range = range; headers['Range-Unit'] = 'items'; }
  let res;
  try {
    res = await fetch(`${SUPA_URL}/rest/v1/${pathQS}`, {
      method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ApiError(502, 'Sem conexão com o banco de dados (verifique a internet). ' + e.message);
  }
  if (res.status === 204) return [];
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data && data.message ? data.message : `Supabase respondeu ${res.status}`;
    if (res.status === 404 && /function|relation/.test(msg)) {
      throw new ApiError(500, 'Banco sem as funções de cálculo — rode supabase/functions.sql no SQL Editor. Detalhe: ' + msg);
    }
    throw new ApiError(res.status >= 500 ? 502 : 400, 'Banco de dados: ' + msg);
  }
  return data;
}

const sGet = (pathQS) => sreq(pathQS);
const sInsert = (table, rows) => sreq(table, { method: 'POST', body: rows, prefer: 'return=representation' });
const sUpsert = (table, rows, onConflict) =>
  sreq(`${table}?on_conflict=${onConflict}`, { method: 'POST', body: rows, prefer: 'return=representation,resolution=merge-duplicates' });
const sPatch = (table, qs, patch) => sreq(`${table}?${qs}`, { method: 'PATCH', body: patch, prefer: 'return=representation' });
const sDelete = (table, qs) => sreq(`${table}?${qs}`, { method: 'DELETE', prefer: 'return=representation' });
const rpc = (name, args = {}) => sreq(`rpc/${name}`, { method: 'POST', body: args });
const enc = encodeURIComponent;

// O Supabase limita cada SELECT a 1000 linhas — pagina até o fim (backup/export)
async function sGetAll(pathQS) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const page = await sreq(pathQS, { range: `${from}-${from + 999}` });
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

function localToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const currentMonth = () => localToday().slice(0, 7);
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RE_MONTH = /^\d{4}-\d{2}$/;

function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
const monthRange = (month) => [`${month}-01`, `${month}-${String(daysInMonth(month)).padStart(2, '0')}`];

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
// Consultas de apoio
// ---------------------------------------------------------------------------

const listAccounts = () => rpc('accounts_with_balances');

async function accountExists(id) {
  const rows = await sGet(`accounts?id=eq.${id}&select=id&limit=1`);
  return rows.length > 0;
}

async function monthTotals(month) {
  const [t] = await rpc('month_totals', { m: month });
  return {
    receitas: Number(t.receitas), despesas: Number(t.despesas),
    receitas_pendentes: Number(t.receitas_pendentes), despesas_pendentes: Number(t.despesas_pendentes),
  };
}

const budgetsWithSpent = (month) => rpc('budgets_with_spent', { m: month });

// SELECT com os nomes das categorias/contas embutidos (joins do PostgREST)
const TX_SELECT = 'select=*,cat:categories(name,color,icon),acc:accounts!transactions_account_id_fkey(name),toacc:accounts!transactions_to_account_id_fkey(name)';
function flatTx(t) {
  t.category_name = t.cat ? t.cat.name : null;
  t.category_color = t.cat ? t.cat.color : null;
  t.category_icon = t.cat ? t.cat.icon : null;
  t.account_name = t.acc ? t.acc.name : null;
  t.to_account_name = t.toacc ? t.toacc.name : null;
  delete t.cat; delete t.acc; delete t.toacc;
  return t;
}

async function validateTransactionBody(body) {
  const type = requireOneOf(body.type, 'tipo', ['receita', 'despesa', 'transferencia']);
  const description = requireText(body.description, 'descrição');
  const amount = requireInt(body.amount, 'valor', { min: 1 });
  const date = requireDate(body.date, 'data');
  const account_id = requireInt(body.account_id, 'conta', { min: 1 });
  const status = requireOneOf(body.status || 'pago', 'status', ['pago', 'pendente']);
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) : null;

  if (!(await accountExists(account_id))) throw new ApiError(400, 'Conta não encontrada.');

  let to_account_id = null;
  let category_id = null;
  if (type === 'transferencia') {
    to_account_id = requireInt(body.to_account_id, 'conta de destino', { min: 1 });
    if (to_account_id === account_id) throw new ApiError(400, 'A conta de destino deve ser diferente da conta de origem.');
    if (!(await accountExists(to_account_id))) throw new ApiError(400, 'Conta de destino não encontrada.');
  } else {
    category_id = requireInt(body.category_id, 'categoria', { min: 1 });
    const [cat] = await sGet(`categories?id=eq.${category_id}&select=kind`);
    if (!cat) throw new ApiError(400, 'Categoria não encontrada.');
    if (cat.kind !== type) throw new ApiError(400, 'A categoria escolhida não corresponde ao tipo do lançamento.');
  }
  return { type, description, amount, date, account_id, to_account_id, category_id, status, notes };
}

async function generateRecurringForMonth(month) {
  const items = await sGet('recurring?active=eq.1&select=*');
  if (!items.length) return 0;
  const [first, last] = monthRange(month);
  const existing = await sGet(`transactions?recurring_id=not.is.null&date=gte.${first}&date=lte.${last}&select=recurring_id`);
  const done = new Set(existing.map((e) => e.recurring_id));
  const maxDay = daysInMonth(month);
  const rows = items
    .filter((r) => !done.has(r.id))
    .map((r) => ({
      type: r.type, description: r.description, amount: r.amount,
      date: `${month}-${String(Math.min(r.day, maxDay)).padStart(2, '0')}`,
      account_id: r.account_id, category_id: r.category_id,
      status: 'pendente', recurring_id: r.id,
    }));
  if (rows.length) await sInsert('transactions', rows);
  return rows.length;
}

// ---------------------------------------------------------------------------
// Rotas da API
// ---------------------------------------------------------------------------

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

// --- Autenticação por PIN ---
// O PIN é guardado com scrypt (hash + sal) na tabela settings; as sessões ficam
// na tabela sessions (só o hash do token) com validade de 30 dias.
let loginFails = []; // timestamps das tentativas erradas (limita força bruta)
const tokenCache = new Map(); // token → validado até (evita 1 consulta por requisição)

async function getSetting(key) {
  const rows = await sGet(`settings?key=eq.${enc(key)}&select=value`);
  return rows.length ? rows[0].value : null;
}
async function setSetting(key, value) {
  if (value === null) await sDelete('settings', `key=eq.${enc(key)}`);
  else await sUpsert('settings', [{ key, value }], 'key');
}

const pinIsSet = async () => !!(await getSetting('pin_hash'));
function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 32).toString('hex');
}
async function verifyPin(pin) {
  const salt = await getSetting('pin_salt');
  const hash = await getSetting('pin_hash');
  if (!salt || !hash) return false;
  const candidate = Buffer.from(hashPin(pin, salt), 'hex');
  const stored = Buffer.from(hash, 'hex');
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const cutoff30d = () => new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

async function newToken() {
  const t = crypto.randomBytes(24).toString('hex');
  await sInsert('sessions', [{ token_hash: hashToken(t) }]);
  sDelete('sessions', `created=lte.${enc(cutoff30d())}`).catch(() => {});
  return t;
}
async function tokenValid(t) {
  if (!t) return false;
  const cached = tokenCache.get(t);
  if (cached && cached > Date.now()) return true;
  const rows = await sGet(`sessions?token_hash=eq.${hashToken(t)}&created=gt.${enc(cutoff30d())}&select=token_hash`);
  if (!rows.length) return false;
  tokenCache.set(t, Date.now() + 5 * 60 * 1000);
  return true;
}
async function clearSessions() {
  tokenCache.clear();
  await sDelete('sessions', 'token_hash=neq.');
}

route('GET', /^\/api\/auth\/status$/, async () => ({ required: await pinIsSet() }));

route('POST', /^\/api\/auth\/login$/, async (req, m, q, body) => {
  if (!(await pinIsSet())) return { token: await newToken() };
  const now = Date.now();
  loginFails = loginFails.filter((t) => now - t < 10 * 60 * 1000);
  if (loginFails.length >= 5) throw new ApiError(429, 'Muitas tentativas erradas. Aguarde 10 minutos e tente de novo.');
  if (!(await verifyPin(String(body.pin || '')))) {
    loginFails.push(now);
    throw new ApiError(401, 'PIN incorreto.');
  }
  loginFails = [];
  return { token: await newToken() };
});

route('POST', /^\/api\/auth\/pin$/, async (req, m, q, body) => {
  // Alterar/definir/remover PIN exige o PIN atual (quando existe)
  if ((await pinIsSet()) && !(await verifyPin(String(body.current || '')))) {
    throw new ApiError(401, 'PIN atual incorreto.');
  }
  loginFails = []; // provou que sabe o PIN — zera o bloqueio de tentativas
  const next = body.next === null || body.next === undefined ? '' : String(body.next);
  if (next === '') {
    await setSetting('pin_hash', null);
    await setSetting('pin_salt', null);
    await clearSessions();
    return { required: false };
  }
  if (!/^\d{4,8}$/.test(next)) throw new ApiError(400, 'O PIN deve ter de 4 a 8 números.');
  const salt = crypto.randomBytes(16).toString('hex');
  await setSetting('pin_salt', salt);
  await setSetting('pin_hash', hashPin(next, salt));
  await clearSessions();
  return { required: true, token: await newToken() };
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

route('POST', /^\/api\/accounts$/, async (req, m, q, body) => {
  const name = requireText(body.name, 'nome');
  const type = requireOneOf(body.type || 'corrente', 'tipo', ['corrente', 'poupanca', 'carteira', 'cartao', 'investimento']);
  const initial = requireInt(body.initial_balance ?? 0, 'saldo inicial');
  const color = requireColor(body.color, '#6366f1');
  const { closing_day, due_day } = cardDays(body, type);
  const [row] = await sInsert('accounts', [{ name, type, initial_balance: initial, color, closing_day, due_day }]);
  return { id: row.id };
});

route('PUT', /^\/api\/accounts\/(\d+)$/, async (req, m, q, body) => {
  const id = Number(m[1]);
  if (!(await accountExists(id))) throw new ApiError(404, 'Conta não encontrada.');
  const name = requireText(body.name, 'nome');
  const type = requireOneOf(body.type || 'corrente', 'tipo', ['corrente', 'poupanca', 'carteira', 'cartao', 'investimento']);
  const initial = requireInt(body.initial_balance ?? 0, 'saldo inicial');
  const color = requireColor(body.color, '#6366f1');
  const archived = body.archived ? 1 : 0;
  const { closing_day, due_day } = cardDays(body, type);
  await sPatch('accounts', `id=eq.${id}`, { name, type, initial_balance: initial, color, archived, closing_day, due_day });
  return { ok: true };
});

route('DELETE', /^\/api\/accounts\/(\d+)$/, async (req, m) => {
  const id = Number(m[1]);
  const used = await sGet(`transactions?or=(account_id.eq.${id},to_account_id.eq.${id})&select=id&limit=1`);
  const usedRec = await sGet(`recurring?account_id=eq.${id}&select=id&limit=1`);
  if (used.length || usedRec.length) {
    throw new ApiError(409, 'Esta conta possui lançamentos. Em vez de excluir, arquive-a para preservar o histórico.');
  }
  await sDelete('accounts', `id=eq.${id}`);
  return { ok: true };
});

// --- Categorias ---
route('GET', /^\/api\/categories$/, () => sGet('categories?select=*&order=archived,kind,name'));

route('POST', /^\/api\/categories$/, async (req, m, q, body) => {
  const name = requireText(body.name, 'nome');
  const kind = requireOneOf(body.kind, 'tipo', ['receita', 'despesa']);
  const color = requireColor(body.color, '#64748b');
  const icon = requireText(body.icon || '🏷️', 'ícone', 8);
  const [row] = await sInsert('categories', [{ name, kind, color, icon }]);
  return { id: row.id };
});

route('PUT', /^\/api\/categories\/(\d+)$/, async (req, m, q, body) => {
  const id = Number(m[1]);
  const rows = await sGet(`categories?id=eq.${id}&select=id`);
  if (!rows.length) throw new ApiError(404, 'Categoria não encontrada.');
  const name = requireText(body.name, 'nome');
  const color = requireColor(body.color, '#64748b');
  const icon = requireText(body.icon || '🏷️', 'ícone', 8);
  const archived = body.archived ? 1 : 0;
  await sPatch('categories', `id=eq.${id}`, { name, color, icon, archived });
  return { ok: true };
});

route('DELETE', /^\/api\/categories\/(\d+)$/, async (req, m) => {
  const id = Number(m[1]);
  const usedTx = await sGet(`transactions?category_id=eq.${id}&select=id&limit=1`);
  const usedRec = await sGet(`recurring?category_id=eq.${id}&select=id&limit=1`);
  if (usedTx.length || usedRec.length) {
    throw new ApiError(409, 'Esta categoria está em uso. Em vez de excluir, arquive-a para preservar o histórico.');
  }
  await sDelete('budgets', `category_id=eq.${id}`);
  await sDelete('categories', `id=eq.${id}`);
  return { ok: true };
});

// --- Lançamentos ---
route('GET', /^\/api\/transactions$/, async (req, m, q) => {
  const filters = [];
  if (q.month && RE_MONTH.test(q.month)) {
    const [first, last] = monthRange(q.month);
    filters.push(`date=gte.${first}`, `date=lte.${last}`);
  }
  if (q.type) filters.push(`type=eq.${requireOneOf(q.type, 'tipo', ['receita', 'despesa', 'transferencia'])}`);
  if (q.status) filters.push(`status=eq.${requireOneOf(q.status, 'status', ['pago', 'pendente'])}`);
  if (q.category_id) filters.push(`category_id=eq.${requireInt(q.category_id, 'categoria')}`);
  if (q.account_id) {
    const id = requireInt(q.account_id, 'conta');
    filters.push(`or=(account_id.eq.${id},to_account_id.eq.${id})`);
  }
  if (q.q) {
    // caracteres com significado no PostgREST saem da busca
    const term = String(q.q).replace(/[,()*%\\"]/g, ' ').trim();
    if (term) filters.push(`or=(description.ilike.${enc(`*${term}*`)},notes.ilike.${enc(`*${term}*`)})`);
  }
  const qs = [TX_SELECT, ...filters, 'order=date.desc,id.desc', 'limit=1000'].join('&');
  const items = (await sGet(`transactions?${qs}`)).map(flatTx);
  let receitas = 0, despesas = 0;
  for (const t of items) {
    if (t.type === 'receita') receitas += t.amount;
    if (t.type === 'despesa') despesas += t.amount;
  }
  return { items, totals: { receitas, despesas, saldo: receitas - despesas } };
});

route('POST', /^\/api\/transactions$/, async (req, m, q, body) => {
  const v = await validateTransactionBody(body);
  const installments = body.installments ? requireInt(body.installments, 'parcelas', { min: 1, max: 48 }) : 1;

  if (installments === 1 || v.type !== 'despesa') {
    const [row] = await sInsert('transactions', [v]);
    return { id: row.id };
  }

  // Compra parcelada: v.amount é o valor TOTAL; divide em N parcelas mensais.
  // A sobra do arredondamento vai na 1ª parcela para o total bater ao centavo.
  // As N parcelas entram numa única chamada — ou grava tudo, ou nada.
  const base = Math.floor(v.amount / installments);
  if (base < 1) throw new ApiError(400, 'Valor total muito baixo para esse número de parcelas.');
  const group = `p${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const rows = [];
  for (let i = 0; i < installments; i++) {
    rows.push({
      ...v,
      amount: i === 0 ? v.amount - base * (installments - 1) : base,
      date: addMonthsClamped(v.date, i),
      status: i === 0 ? v.status : 'pendente',
      installment_group: group, installment_no: i + 1, installment_total: installments,
    });
  }
  const inserted = await sInsert('transactions', rows);
  return { id: inserted[0].id, installments };
});

route('PUT', /^\/api\/transactions\/(\d+)$/, async (req, m, q, body) => {
  const id = Number(m[1]);
  const rows = await sGet(`transactions?id=eq.${id}&select=id`);
  if (!rows.length) throw new ApiError(404, 'Lançamento não encontrado.');
  const v = await validateTransactionBody(body);
  // Editar um lançamento invalida a conferência dele (dos dois lados)
  await sPatch('transactions', `id=eq.${id}`, { ...v, reconciled: 0, reconciled_in: 0 });
  return { ok: true };
});

route('DELETE', /^\/api\/transactions\/(\d+)$/, async (req, m) => {
  await sDelete('transactions', `id=eq.${Number(m[1])}`);
  return { ok: true };
});

route('POST', /^\/api\/transactions\/(\d+)\/toggle-status$/, async (req, m) => {
  const [tx] = await sGet(`transactions?id=eq.${Number(m[1])}&select=status`);
  if (!tx) throw new ApiError(404, 'Lançamento não encontrado.');
  const next = tx.status === 'pago' ? 'pendente' : 'pago';
  // Voltar para pendente também desfaz a conferência da conciliação (dos dois lados)
  const patch = next === 'pendente' ? { status: next, reconciled: 0, reconciled_in: 0 } : { status: next };
  await sPatch('transactions', `id=eq.${Number(m[1])}`, patch);
  return { status: next };
});

// --- Orçamentos ---
route('GET', /^\/api\/budgets$/, (req, m, q) => {
  const month = q.month && RE_MONTH.test(q.month) ? q.month : currentMonth();
  return budgetsWithSpent(month);
});

route('POST', /^\/api\/budgets$/, async (req, m, q, body) => {
  const category_id = requireInt(body.category_id, 'categoria', { min: 1 });
  const amount = requireInt(body.amount, 'valor', { min: 1 });
  const [cat] = await sGet(`categories?id=eq.${category_id}&select=kind`);
  if (!cat || cat.kind !== 'despesa') throw new ApiError(400, 'Orçamentos só podem ser definidos para categorias de despesa.');
  await sUpsert('budgets', [{ category_id, amount }], 'category_id');
  return { ok: true };
});

route('DELETE', /^\/api\/budgets\/(\d+)$/, async (req, m) => {
  await sDelete('budgets', `id=eq.${Number(m[1])}`);
  return { ok: true };
});

// --- Recorrências ---
route('GET', /^\/api\/recurring$/, async () => {
  const rows = await sGet('recurring?select=*,cat:categories(name,icon),acc:accounts(name)&order=active.desc,day');
  return rows.map((r) => {
    r.category_name = r.cat ? r.cat.name : null;
    r.category_icon = r.cat ? r.cat.icon : null;
    r.account_name = r.acc ? r.acc.name : null;
    delete r.cat; delete r.acc;
    return r;
  });
});

async function validateRecurringBody(body) {
  const description = requireText(body.description, 'descrição');
  const amount = requireInt(body.amount, 'valor', { min: 1 });
  const type = requireOneOf(body.type, 'tipo', ['receita', 'despesa']);
  const day = requireInt(body.day, 'dia', { min: 1, max: 31 });
  const account_id = requireInt(body.account_id, 'conta', { min: 1 });
  const category_id = requireInt(body.category_id, 'categoria', { min: 1 });
  if (!(await accountExists(account_id))) throw new ApiError(400, 'Conta não encontrada.');
  const [cat] = await sGet(`categories?id=eq.${category_id}&select=kind`);
  if (!cat) throw new ApiError(400, 'Categoria não encontrada.');
  if (cat.kind !== type) throw new ApiError(400, 'A categoria escolhida não corresponde ao tipo.');
  return { description, amount, type, day, account_id, category_id, active: body.active === false ? 0 : 1 };
}

route('POST', /^\/api\/recurring$/, async (req, m, q, body) => {
  const v = await validateRecurringBody(body);
  const [row] = await sInsert('recurring', [v]);
  return { id: row.id };
});

route('PUT', /^\/api\/recurring\/(\d+)$/, async (req, m, q, body) => {
  const id = Number(m[1]);
  const rows = await sGet(`recurring?id=eq.${id}&select=id`);
  if (!rows.length) throw new ApiError(404, 'Recorrência não encontrada.');
  const v = await validateRecurringBody(body);
  await sPatch('recurring', `id=eq.${id}`, v);
  return { ok: true };
});

route('DELETE', /^\/api\/recurring\/(\d+)$/, async (req, m) => {
  await sDelete('recurring', `id=eq.${Number(m[1])}`);
  return { ok: true };
});

route('POST', /^\/api\/recurring\/generate$/, async (req, m, q, body) => {
  const month = body && body.month && RE_MONTH.test(body.month) ? body.month : currentMonth();
  const created = await generateRecurringForMonth(month);
  return { created, month };
});

// --- Metas ---
// (ordenação por expressão não existe no PostgREST — a tabela é pequena, ordena aqui)
function sortGoals(goals) {
  return goals.sort((a, b) =>
    ((a.saved >= a.target) - (b.saved >= b.target))
    || ((a.deadline === null) - (b.deadline === null))
    || String(a.deadline || '').localeCompare(String(b.deadline || '')));
}

route('GET', /^\/api\/goals$/, async () => sortGoals(await sGet('goals?select=*')));

route('POST', /^\/api\/goals$/, async (req, m, q, body) => {
  const name = requireText(body.name, 'nome');
  const target = requireInt(body.target, 'valor da meta', { min: 1 });
  const saved = requireInt(body.saved ?? 0, 'valor guardado', { min: 0 });
  const deadline = body.deadline ? requireDate(body.deadline, 'prazo') : null;
  const color = requireColor(body.color, '#10b981');
  const [row] = await sInsert('goals', [{ name, target, saved, deadline, color }]);
  return { id: row.id };
});

route('PUT', /^\/api\/goals\/(\d+)$/, async (req, m, q, body) => {
  const id = Number(m[1]);
  const rows = await sGet(`goals?id=eq.${id}&select=id`);
  if (!rows.length) throw new ApiError(404, 'Meta não encontrada.');
  const name = requireText(body.name, 'nome');
  const target = requireInt(body.target, 'valor da meta', { min: 1 });
  const saved = requireInt(body.saved ?? 0, 'valor guardado', { min: 0 });
  const deadline = body.deadline ? requireDate(body.deadline, 'prazo') : null;
  const color = requireColor(body.color, '#10b981');
  await sPatch('goals', `id=eq.${id}`, { name, target, saved, deadline, color });
  return { ok: true };
});

route('DELETE', /^\/api\/goals\/(\d+)$/, async (req, m) => {
  await sDelete('goals', `id=eq.${Number(m[1])}`);
  return { ok: true };
});

route('POST', /^\/api\/goals\/(\d+)\/add$/, async (req, m, q, body) => {
  const id = Number(m[1]);
  const [goal] = await sGet(`goals?id=eq.${id}&select=*`);
  if (!goal) throw new ApiError(404, 'Meta não encontrada.');
  const amount = requireInt(body.amount, 'valor');
  const saved = Math.max(0, goal.saved + amount);
  await sPatch('goals', `id=eq.${id}`, { saved });
  return { saved };
});

// --- Dashboard ---
route('GET', /^\/api\/dashboard$/, async (req, m, q) => {
  const month = q.month && RE_MONTH.test(q.month) ? q.month : currentMonth();
  if (month === currentMonth()) await generateRecurringForMonth(month);

  const [first, last] = monthRange(month);
  const [allAccounts, totals, catTotals, historyRows, upcomingRaw, budgets, allGoals] = await Promise.all([
    listAccounts(),
    monthTotals(month),
    rpc('category_range_totals', { dfrom: first, dto: last }),
    rpc('monthly_series', { n: 6, end_month: month }),
    sGet(`transactions?${TX_SELECT}&status=eq.pendente&date=gte.${first}&date=lte.${last}&order=date&limit=8`),
    budgetsWithSpent(month),
    sGet('goals?select=*'),
  ]);

  const accounts = allAccounts.filter((a) => !a.archived);
  const byCategory = catTotals
    .filter((c) => c.kind === 'despesa')
    .map((c) => ({ id: c.id, name: c.name, color: c.color, icon: c.icon, total: Number(c.total) }));

  return {
    month,
    totalBalance: accounts.reduce((s, a) => s + Number(a.balance), 0),
    receitas: totals.receitas,
    despesas: totals.despesas,
    resultado: totals.receitas - totals.despesas,
    pendentes: { despesas: totals.despesas_pendentes, receitas: totals.receitas_pendentes },
    accounts,
    byCategory,
    history: historyRows.map((h) => ({ month: h.month, receitas: Number(h.receitas), despesas: Number(h.despesas) })),
    upcoming: upcomingRaw.map(flatTx),
    budgets,
    goals: sortGoals(allGoals).slice(0, 4),
  };
});

// --- Conciliação: confere o app contra o extrato real do banco ---
route('GET', /^\/api\/reconcile$/, async (req, m, q) => {
  const account_id = requireInt(q.account_id, 'conta', { min: 1 });
  const account = (await listAccounts()).find((a) => a.id === account_id);
  if (!account) throw new ApiError(404, 'Conta não encontrada.');
  const filter = `or=(and(account_id.eq.${account_id},reconciled.eq.0),and(to_account_id.eq.${account_id},reconciled_in.eq.0))`;
  const items = (await sGet(`transactions?${TX_SELECT}&status=eq.pago&${filter}&order=date,id`)).map(flatTx);
  // efeito de cada lançamento NESTA conta (transferência recebida entra positiva)
  for (const t of items) {
    t.effect = t.type === 'receita' ? t.amount
      : t.type === 'despesa' ? -t.amount
      : (t.to_account_id === account_id ? t.amount : -t.amount);
  }
  return { account: { ...account, balance: Number(account.balance), reconciled_balance: Number(account.reconciled_balance) }, items };
});

// Decide qual lado da conferência mexer: transferência RECEBIDA nesta conta usa
// reconciled_in; todo o resto (receita, despesa, transferência enviada) usa reconciled.
function reconcileFlagFor(tx, account_id) {
  return tx.type === 'transferencia' && tx.to_account_id === account_id ? 'reconciled_in' : 'reconciled';
}

route('POST', /^\/api\/reconcile\/toggle$/, async (req, m, q, body) => {
  const id = requireInt(body.id, 'lançamento', { min: 1 });
  const account_id = requireInt(body.account_id, 'conta', { min: 1 });
  const [tx] = await sGet(`transactions?id=eq.${id}&select=type,to_account_id,reconciled,reconciled_in`);
  if (!tx) throw new ApiError(404, 'Lançamento não encontrado.');
  const flag = reconcileFlagFor(tx, account_id);
  const next = tx[flag] ? 0 : 1;
  await sPatch('transactions', `id=eq.${id}`, { [flag]: next });
  return { [flag]: next };
});

route('POST', /^\/api\/reconcile\/bulk$/, async (req, m, q, body) => {
  if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 5000) {
    throw new ApiError(400, 'Lista de lançamentos inválida.');
  }
  const account_id = requireInt(body.account_id, 'conta', { min: 1 });
  const value = body.value ? 1 : 0;
  const ids = body.ids.map((i) => requireInt(i, 'lançamento', { min: 1 }));
  const txs = await sGet(`transactions?id=in.(${ids.join(',')})&select=id,type,to_account_id`);
  const outIds = txs.filter((t) => reconcileFlagFor(t, account_id) === 'reconciled').map((t) => t.id);
  const inIds = txs.filter((t) => reconcileFlagFor(t, account_id) === 'reconciled_in').map((t) => t.id);
  let changed = 0;
  if (outIds.length) changed += (await sPatch('transactions', `id=in.(${outIds.join(',')})`, { reconciled: value })).length;
  if (inIds.length) changed += (await sPatch('transactions', `id=in.(${inIds.join(',')})`, { reconciled_in: value })).length;
  return { changed, value };
});

// Cria um lançamento de ajuste para o saldo conferido bater com o saldo real do banco
route('POST', /^\/api\/reconcile\/adjust$/, async (req, m, q, body) => {
  const account_id = requireInt(body.account_id, 'conta', { min: 1 });
  const bank_balance = requireInt(body.bank_balance, 'saldo do banco');
  const account = (await listAccounts()).find((a) => a.id === account_id);
  if (!account) throw new ApiError(404, 'Conta não encontrada.');
  const diff = bank_balance - Number(account.reconciled_balance);
  if (diff === 0) throw new ApiError(400, 'Os saldos já estão iguais — nada a ajustar.');
  const kind = diff > 0 ? 'receita' : 'despesa';
  let [cat] = await sGet(`categories?name=eq.${enc('Ajuste de conciliação')}&kind=eq.${kind}&select=id`);
  if (!cat) {
    [cat] = await sInsert('categories', [{ name: 'Ajuste de conciliação', kind, color: '#94a3b8', icon: '🧮' }]);
  }
  const [row] = await sInsert('transactions', [{
    type: kind, description: 'Ajuste de conciliação', amount: Math.abs(diff), date: localToday(),
    account_id, category_id: cat.id, status: 'pago', reconciled: 1,
    notes: 'Criado automaticamente para igualar o saldo conferido ao saldo real do banco.',
  }]);
  return { id: row.id, diff, new_reconciled_balance: bank_balance };
});

// --- Fatura de cartão de crédito ---
// Fatura do mês M = despesas do cartão depois do fechamento de M-1 (exclusivo)
// até o fechamento de M (inclusivo). Vence no due_day de M — ou de M+1 quando o
// vencimento cai antes do fechamento, como é comum nos cartões brasileiros.
function closingDateOf(month, closingDay) {
  return `${month}-${String(Math.min(closingDay, daysInMonth(month))).padStart(2, '0')}`;
}

async function cardInvoices(month) {
  const cards = await sGet("accounts?type=eq.cartao&archived=eq.0&closing_day=not.is.null&select=*");
  return Promise.all(cards.map(async (c) => {
    const closing = closingDateOf(month, c.closing_day);
    const prevClosing = closingDateOf(shiftMonthStr(month, -1), c.closing_day);
    const dueMonth = c.due_day && c.due_day > c.closing_day ? month : shiftMonthStr(month, 1);
    const due_date = c.due_day ? `${dueMonth}-${String(Math.min(c.due_day, daysInMonth(dueMonth))).padStart(2, '0')}` : null;
    const rows = await sGet(`transactions?account_id=eq.${c.id}&type=eq.despesa&date=gt.${prevClosing}&date=lte.${closing}&select=amount`);
    return {
      account_id: c.id, name: c.name, color: c.color,
      from: prevClosing, closing_date: closing, due_date,
      total: rows.reduce((s, r) => s + r.amount, 0),
    };
  }));
}

route('GET', /^\/api\/cards\/invoices$/, (req, m, q) => {
  const month = q.month && RE_MONTH.test(q.month) ? q.month : currentMonth();
  return cardInvoices(month);
});

// --- Radar financeiro (insights automáticos) ---
route('GET', /^\/api\/insights$/, async (req, m, q) => {
  const month = q.month && RE_MONTH.test(q.month) ? q.month : currentMonth();
  const prev = shiftMonthStr(month, -1);
  const today = localToday();
  const isCurrent = month === currentMonth();
  const [mFirst, mLast] = monthRange(month);
  const [pFirst, pLast] = monthRange(prev);

  const [cur, prv, curCats, prvCats, budgets] = await Promise.all([
    monthTotals(month), monthTotals(prev),
    rpc('category_range_totals', { dfrom: mFirst, dto: mLast }),
    rpc('category_range_totals', { dfrom: pFirst, dto: pLast }),
    budgetsWithSpent(month),
  ]);
  const insights = [];

  // Comparação de despesas com o mês anterior
  if (prv.despesas > 0 && cur.despesas > 0) {
    const diff = cur.despesas - prv.despesas;
    const pct = Math.round((diff / prv.despesas) * 100);
    if (pct <= -5) insights.push({ icon: '📉', tone: 'good', text: `Suas despesas estão ${Math.abs(pct)}% menores que em ${monthName(prev)}. Continue assim!` });
    else if (pct >= 10) insights.push({ icon: '📈', tone: 'warn', text: `Suas despesas estão ${pct}% maiores que em ${monthName(prev)} (${fmtBRL(diff)} a mais).` });
  }

  // Categoria de despesa que mais cresceu vs mês anterior
  const prvMap = new Map(prvCats.filter((c) => c.kind === 'despesa').map((c) => [c.id, Number(c.total)]));
  let growth = null;
  for (const c of curCats.filter((x) => x.kind === 'despesa')) {
    const before = prvMap.get(c.id) || 0;
    const now = Number(c.total);
    if (before > 0 && now > before && (!growth || now - before > growth.diff)) {
      growth = { name: c.name, icon: c.icon, cur: now, prev: before, diff: now - before };
    }
  }
  if (growth && growth.diff >= 5000) {
    insights.push({ icon: growth.icon, tone: 'warn', text: `${growth.name} foi a categoria que mais cresceu: ${fmtBRL(growth.prev)} → ${fmtBRL(growth.cur)}.` });
  }

  // Orçamentos perto do limite ou estourados
  for (const b of budgets) {
    const spent = Number(b.spent);
    const pct = Math.round((spent / b.amount) * 100);
    if (pct >= 100) insights.push({ icon: '🚨', tone: 'bad', text: `Orçamento de ${b.name} estourado: ${fmtBRL(spent)} de ${fmtBRL(b.amount)} (${pct}%).` });
    else if (pct >= 80) insights.push({ icon: '⚠️', tone: 'warn', text: `Orçamento de ${b.name} em ${pct}% — restam ${fmtBRL(b.amount - spent)}.` });
  }

  // Contas vencendo / atrasadas / fatura de cartão (apenas no mês corrente)
  if (isCurrent) {
    const limit = new Date();
    limit.setDate(limit.getDate() + 7);
    const limitIso = `${limit.getFullYear()}-${String(limit.getMonth() + 1).padStart(2, '0')}-${String(limit.getDate()).padStart(2, '0')}`;
    const [dueRows, lateRows, invoices] = await Promise.all([
      sGet(`transactions?status=eq.pendente&type=eq.despesa&date=gte.${today}&date=lte.${limitIso}&select=amount`),
      sGet(`transactions?status=eq.pendente&type=eq.despesa&date=lt.${today}&select=amount`),
      cardInvoices(month),
    ]);
    if (dueRows.length) insights.push({ icon: '⏰', tone: 'warn', text: `${dueRows.length} conta(s) vencendo nos próximos 7 dias, totalizando ${fmtBRL(dueRows.reduce((s, r) => s + r.amount, 0))}.` });
    if (lateRows.length) insights.push({ icon: '🔴', tone: 'bad', text: `${lateRows.length} conta(s) atrasada(s) somando ${fmtBRL(lateRows.reduce((s, r) => s + r.amount, 0))}. Vale conferir!` });
    for (const inv of invoices) {
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
  const [biggest] = await sGet(`transactions?type=eq.despesa&date=gte.${mFirst}&date=lte.${mLast}&select=description,amount&order=amount.desc&limit=1`);
  if (biggest && cur.despesas > 0 && biggest.amount >= cur.despesas * 0.3) {
    insights.push({ icon: '🐘', tone: 'info', text: `"${biggest.description}" sozinho representa ${Math.round((biggest.amount / cur.despesas) * 100)}% das despesas do mês.` });
  }

  // Projeção de fim de mês (ritmo atual + pendentes)
  let projection = null;
  if (isCurrent) {
    const dayOfMonth = Number(today.slice(8, 10));
    const totalDays = daysInMonth(month);
    const paidRows = await sGet(`transactions?type=eq.despesa&status=eq.pago&date=gte.${mFirst}&date=lte.${mLast}&select=amount`);
    const paid = paidRows.reduce((s, r) => s + r.amount, 0);
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
route('GET', /^\/api\/suggestions$/, async () => (await rpc('suggestions_list'))
  .sort((a, b) => Number(b.uses) - Number(a.uses) || String(b.last_used).localeCompare(String(a.last_used)))
  .slice(0, 150)
  .map((s) => ({ ...s, uses: Number(s.uses) })));

// --- Patrimônio: evolução do saldo total mês a mês ---
route('GET', /^\/api\/reports\/networth$/, async (req, m, q) => {
  const n = Math.min(Math.max(Number(q.months) || 12, 2), 36);
  const rows = await rpc('networth_series', { n });
  return rows.map((r) => ({ month: r.month, total: Number(r.total) }));
});

// --- Comparativo com o mês anterior, por categoria ---
route('GET', /^\/api\/reports\/compare$/, async (req, m, q) => {
  const month = q.month && RE_MONTH.test(q.month) ? q.month : currentMonth();
  const prev = shiftMonthStr(month, -1);
  const [mFirst, mLast] = monthRange(month);
  const [pFirst, pLast] = monthRange(prev);
  const [curRows, prvRows] = await Promise.all([
    rpc('category_range_totals', { dfrom: mFirst, dto: mLast }),
    rpc('category_range_totals', { dfrom: pFirst, dto: pLast }),
  ]);
  const map = new Map();
  for (const r of curRows) map.set(r.id, { id: r.id, name: r.name, kind: r.kind, color: r.color, icon: r.icon, cur: Number(r.total), prev: 0 });
  for (const r of prvRows) {
    if (!map.has(r.id)) map.set(r.id, { id: r.id, name: r.name, kind: r.kind, color: r.color, icon: r.icon, cur: 0, prev: 0 });
    map.get(r.id).prev = Number(r.total);
  }
  const rows = [...map.values()].sort((a, b) => b.cur - a.cur);
  return {
    month, prev,
    despesas: rows.filter((r) => r.kind === 'despesa'),
    receitas: rows.filter((r) => r.kind === 'receita'),
  };
});

// --- Importação de extrato (o navegador envia as linhas já interpretadas) ---
route('POST', /^\/api\/import$/, async (req, m, q, body) => {
  const account_id = requireInt(body.account_id, 'conta', { min: 1 });
  if (!(await accountExists(account_id))) throw new ApiError(400, 'Conta não encontrada.');
  const catDespesa = requireInt(body.expense_category_id, 'categoria de despesa', { min: 1 });
  const catReceita = requireInt(body.income_category_id, 'categoria de receita', { min: 1 });
  if (!Array.isArray(body.items) || body.items.length === 0) throw new ApiError(400, 'Nenhum lançamento para importar.');
  if (body.items.length > 2000) throw new ApiError(400, 'Máximo de 2000 lançamentos por importação.');

  // valida tudo primeiro
  const items = body.items.map((item) => ({
    type: requireOneOf(item.type, 'tipo', ['receita', 'despesa']),
    description: requireText(item.description, 'descrição'),
    amount: requireInt(item.amount, 'valor', { min: 1 }),
    date: requireDate(item.date, 'data'),
  }));

  // detecção de duplicados: mesmo dia + valor + descrição (sem diferenciar maiúsculas)
  const dates = [...new Set(items.map((i) => i.date))];
  const existing = await sGetAll(`transactions?account_id=eq.${account_id}&date=in.(${dates.join(',')})&select=date,amount,description`);
  const seen = new Set(existing.map((e) => `${e.date}|${e.amount}|${e.description.toLowerCase()}`));

  const rows = [];
  let skipped = 0;
  for (const item of items) {
    const key = `${item.date}|${item.amount}|${item.description.toLowerCase()}`;
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key); // evita duplicado dentro do próprio arquivo
    rows.push({
      type: item.type, description: item.description, amount: item.amount, date: item.date,
      account_id, category_id: item.type === 'despesa' ? catDespesa : catReceita, status: 'pago',
    });
  }
  if (rows.length) await sInsert('transactions', rows);
  return { created: rows.length, skipped };
});

// --- Relatórios ---
route('GET', /^\/api\/reports\/summary$/, async (req, m, q) => {
  const from = q.from && RE_DATE.test(q.from) ? q.from : `${currentMonth()}-01`;
  const to = q.to && RE_DATE.test(q.to) ? q.to : localToday();
  const rows = (await rpc('category_range_totals', { dfrom: from, dto: to }))
    .map((r) => ({ ...r, total: Number(r.total), count: Number(r.count) }));
  const receitas = rows.filter((r) => r.kind === 'receita');
  const despesas = rows.filter((r) => r.kind === 'despesa');
  return {
    from, to, receitas, despesas,
    totalReceitas: receitas.reduce((s, r) => s + r.total, 0),
    totalDespesas: despesas.reduce((s, r) => s + r.total, 0),
  };
});

route('GET', /^\/api\/reports\/monthly$/, async (req, m, q) => {
  const n = Math.min(Math.max(Number(q.months) || 12, 1), 36);
  const rows = await rpc('monthly_series', { n, end_month: currentMonth() });
  return rows.map((r) => ({
    month: r.month, receitas: Number(r.receitas), despesas: Number(r.despesas),
    resultado: Number(r.receitas) - Number(r.despesas),
  }));
});

// --- Fluxo de caixa projetado ---
// Projeta o saldo total dia a dia: começa do saldo real (pago) e vai somando
// pendências futuras (incluindo parcelas), atrasados (contam como "hoje") e
// recorrências de meses que ainda nem foram gerados. Transferências não mudam o total.
route('GET', /^\/api\/reports\/cashflow$/, async (req, m, q) => {
  const days = Math.min(Math.max(Number(q.days) || 30, 7), 120);
  const today = localToday();
  const addDays = (iso, n) => {
    const d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const endDate = addDays(today, days);

  const [accounts, pend, recs, generated] = await Promise.all([
    listAccounts(),
    sGetAll(`transactions?status=eq.pendente&date=lte.${endDate}&select=date,type,amount`),
    sGet('recurring?active=eq.1&select=*'),
    sGet(`transactions?recurring_id=not.is.null&date=gte.${currentMonth()}-01&date=lte.${endDate}&select=recurring_id,date`),
  ]);
  const start = accounts.filter((a) => !a.archived).reduce((s, a) => s + Number(a.balance), 0);

  const deltas = {}; // date -> variação do dia (centavos)
  const bump = (date, v) => { deltas[date] = (deltas[date] || 0) + v; };

  // pendências (parcelas futuras já são lançamentos pendentes)
  for (const t of pend) {
    const delta = t.type === 'receita' ? t.amount : t.type === 'despesa' ? -t.amount : 0;
    bump(t.date < today ? today : t.date, delta);
  }

  // recorrências de meses ainda não gerados dentro da janela
  const done = new Set(generated.map((g) => `${g.recurring_id}|${g.date.slice(0, 7)}`));
  let mm = currentMonth();
  while (mm <= endDate.slice(0, 7)) {
    for (const r of recs) {
      if (done.has(`${r.id}|${mm}`)) continue;
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
route('GET', /^\/api\/reports\/annual$/, async (req, m, q) => {
  const year = /^\d{4}$/.test(q.year || '') ? q.year : localToday().slice(0, 4);
  const rows = await rpc('annual_rows', { y: year });
  const cats = new Map();
  for (const r of rows) {
    if (!cats.has(r.id)) cats.set(r.id, { id: r.id, name: r.name, kind: r.kind, icon: r.icon, color: r.color, months: Array(12).fill(0), total: 0 });
    const c = cats.get(r.id);
    c.months[r.mm - 1] += Number(r.total);
    c.total += Number(r.total);
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
// Os arquivos ficam no disco local. Em nuvem (Render) o disco é temporário:
// os comprovantes somem no redeploy — próxima etapa é migrá-los ao Supabase Storage.
const ANEXOS_DIR = path.join(ROOT, 'anexos');
fs.mkdirSync(ANEXOS_DIR, { recursive: true });
const ATTACH_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };

route('POST', /^\/api\/transactions\/(\d+)\/attachment$/, async (req, m, q, body) => {
  const id = Number(m[1]);
  const [tx] = await sGet(`transactions?id=eq.${id}&select=attachment`);
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
  await sPatch('transactions', `id=eq.${id}`, { attachment: name });
  return { attachment: name };
});

route('DELETE', /^\/api\/transactions\/(\d+)\/attachment$/, async (req, m) => {
  const id = Number(m[1]);
  const [tx] = await sGet(`transactions?id=eq.${id}&select=attachment`);
  if (!tx) throw new ApiError(404, 'Lançamento não encontrado.');
  if (tx.attachment) { try { fs.unlinkSync(path.join(ANEXOS_DIR, tx.attachment)); } catch {} }
  await sPatch('transactions', `id=eq.${id}`, { attachment: null });
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
route('POST', /^\/api\/restore$/, async (req, m, q, body) => {
  const b = body.backup;
  if (!b || !Array.isArray(b.accounts) || !Array.isArray(b.categories) || !Array.isArray(b.transactions)) {
    throw new ApiError(400, 'Arquivo de backup inválido — use um arquivo gerado pelo botão "Backup completo".');
  }
  // apaga na ordem inversa das dependências, insere na ordem direta
  await sDelete('transactions', 'id=gte.0');
  await sDelete('budgets', 'id=gte.0');
  await sDelete('recurring', 'id=gte.0');
  await sDelete('goals', 'id=gte.0');
  await sDelete('categories', 'id=gte.0');
  await sDelete('accounts', 'id=gte.0');

  if (b.accounts.length) await sInsert('accounts', b.accounts.map((a) => ({
    id: a.id, name: a.name, type: a.type || 'corrente', initial_balance: a.initial_balance || 0,
    color: a.color || '#6366f1', archived: a.archived ? 1 : 0,
    closing_day: a.closing_day ?? null, due_day: a.due_day ?? null,
  })));
  if (b.categories.length) await sInsert('categories', b.categories.map((c) => ({
    id: c.id, name: c.name, kind: c.kind, color: c.color || '#64748b', icon: c.icon || '🏷️', archived: c.archived ? 1 : 0,
  })));
  if (b.transactions.length) {
    const rows = b.transactions.map((t) => ({
      id: t.id, type: t.type, description: t.description, amount: t.amount, date: t.date,
      account_id: t.account_id, to_account_id: t.to_account_id ?? null, category_id: t.category_id ?? null,
      status: t.status || 'pago', notes: t.notes ?? null, recurring_id: t.recurring_id ?? null,
      installment_group: t.installment_group ?? null, installment_no: t.installment_no ?? null,
      installment_total: t.installment_total ?? null,
      reconciled: t.reconciled ? 1 : 0, reconciled_in: t.reconciled_in ? 1 : 0, attachment: t.attachment ?? null,
    }));
    for (let i = 0; i < rows.length; i += 500) await sInsert('transactions', rows.slice(i, i + 500));
  }
  if ((b.budgets || []).length) await sInsert('budgets', b.budgets.map((x) => ({ id: x.id, category_id: x.category_id, amount: x.amount })));
  if ((b.recurring || []).length) await sInsert('recurring', b.recurring.map((x) => ({
    id: x.id, description: x.description, amount: x.amount, type: x.type, day: x.day,
    account_id: x.account_id, category_id: x.category_id ?? null, active: x.active ? 1 : 0,
  })));
  if ((b.goals || []).length) await sInsert('goals', b.goals.map((x) => ({
    id: x.id, name: x.name, target: x.target, saved: x.saved || 0, deadline: x.deadline ?? null, color: x.color || '#10b981',
  })));
  await rpc('fix_sequences');

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

route('GET', /^\/api\/export\/transactions\.csv$/, async (req, m, q, body, res) => {
  const filters = [];
  if (q.from && RE_DATE.test(q.from)) filters.push(`date=gte.${q.from}`);
  if (q.to && RE_DATE.test(q.to)) filters.push(`date=lte.${q.to}`);
  const qs = [TX_SELECT, ...filters, 'order=date,id'].join('&');
  const rows = (await sGetAll(`transactions?${qs}`)).map(flatTx);
  const header = 'Data;Tipo;Descrição;Valor;Status;Categoria;Conta;Conta destino;Observações';
  const lines = rows.map((r) => [
    r.date,
    r.type,
    csvEscape(r.description),
    (r.amount / 100).toFixed(2).replace('.', ','),
    r.status,
    csvEscape(r.category_name || ''),
    csvEscape(r.account_name || ''),
    csvEscape(r.to_account_name || ''),
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

route('GET', /^\/api\/export\/backup\.json$/, async (req, m, q, body, res) => {
  const [accounts, categories, transactions, budgets, recurring, goals] = await Promise.all([
    sGetAll('accounts?select=*&order=id'),
    sGetAll('categories?select=*&order=id'),
    sGetAll('transactions?select=*&order=id'),
    sGetAll('budgets?select=*&order=id'),
    sGetAll('recurring?select=*&order=id'),
    sGetAll('goals?select=*&order=id'),
  ]);
  const backup = { exported_at: new Date().toISOString(), accounts, categories, transactions, budgets, recurring, goals };
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
  '.woff2': 'font/woff2',
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
    if (!pathname.startsWith('/api/auth/') && (await pinIsSet())) {
      const token = req.headers['x-auth-token'] || query.token;
      if (!(await tokenValid(token))) throw new ApiError(401, 'Sessão expirada. Digite o PIN.');
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const match = pathname.match(r.pattern);
      if (!match) continue;
      const body = (req.method === 'POST' || req.method === 'PUT') ? await readBody(req) : {};
      const result = await r.handler(req, match, query, body, res);
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
server.listen(PORT, '0.0.0.0', async () => {
  console.log('');
  console.log('  💰 Financeiro Pessoal está no ar! (banco: Supabase)');
  console.log('  Neste computador:   http://localhost:' + PORT);
  for (const u of lanUrls()) {
    console.log('  Pelo celular:       ' + u + '   (mesmo Wi-Fi)');
  }
  console.log('  Para encerrar, feche esta janela ou pressione Ctrl+C.');
  console.log('');
  // teste de fumaça: banco alcançável e funções instaladas?
  try {
    await rpc('accounts_with_balances');
    console.log('  ✓ Conexão com o Supabase OK');
  } catch (e) {
    console.error('  ✗ ATENÇÃO: ' + e.message);
  }
});
