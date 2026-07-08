/* ============ Financeiro Pessoal — aplicação (v2 ✨) ============ */
'use strict';

// ---------------------------------------------------------------------------
// Estado e utilitários
// ---------------------------------------------------------------------------

const state = {
  view: 'dashboard',
  month: null,          // 'AAAA-MM' selecionado
  today: null,          // 'AAAA-MM-DD'
  currentMonth: null,   // mês real de hoje
  accounts: [],
  categories: [],
  suggestions: null,    // autocompletar (carregado sob demanda)
  txFilters: { q: '', type: '', account_id: '', category_id: '', status: '' },
  reconcile: { account_id: null, bank: '' },  // tela de conciliação
};

const $ = (sel) => document.querySelector(sel);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = (cents) => BRL.format((cents || 0) / 100);

function parseMoney(str) {
  if (typeof str !== 'string') return null;
  let s = str.trim().replace(/R\$|\s/g, '');
  if (!s) return null;
  let neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const v = Number(s);
  if (!isFinite(v) || v < 0) return null;
  const cents = Math.round(v * 100);
  return neg ? -cents : cents;
}
const moneyToInput = (cents) => ((cents || 0) / 100).toFixed(2).replace('.', ',');

function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}
function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const fmtDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const fmtDateFull = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

const getToken = () => localStorage.getItem('fp-token') || '';
const setToken = (t) => t ? localStorage.setItem('fp-token', t) : localStorage.removeItem('fp-token');

async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: {} };
  if (getToken()) opts.headers['x-auth-token'] = getToken();
  if (body !== null) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    // sessão caiu (ex.: servidor reiniciou) — pede o PIN e repete a chamada
    await loginOverlay();
    return api(path, method, body);
  }
  if (!res.ok) throw new Error(data.error || 'Erro ao comunicar com o servidor.');
  return data;
}

// URL de download com o token (downloads não conseguem enviar cabeçalho)
function exportUrl(path, params = {}) {
  const qs = new URLSearchParams(params);
  if (getToken()) qs.set('token', getToken());
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

// Antes de baixar, confirma que a sessão está viva (senão pede o PIN primeiro,
// em vez de abrir uma aba com mensagem de erro)
async function openExport(path, params = {}) {
  try { await api('/api/meta'); } catch { return; }
  window.open(exportUrl(path, params));
}

// ---------------------------------------------------------------------------
// Login por PIN (quando o dono ativa a proteção)
// ---------------------------------------------------------------------------

let loginPromise = null;
function loginOverlay() {
  if (loginPromise) return loginPromise; // já tem uma tela de PIN aberta
  loginPromise = new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'modal-backdrop';
    root.style.zIndex = 400;
    root.innerHTML = `
      <div class="modal" style="max-width:340px;text-align:center">
        <div style="margin-bottom:10px;color:var(--text-dim)">${icon('lock', 34)}</div>
        <h2 style="margin-bottom:6px">Financeiro Pessoal</h2>
        <p class="muted" style="margin-bottom:16px;font-size:13.5px">Digite seu PIN para entrar</p>
        <form id="loginForm">
          <div class="field"><input name="pin" type="password" inputmode="numeric" autocomplete="off"
            maxlength="8" placeholder="••••" style="text-align:center;font-size:22px;letter-spacing:8px" required></div>
          <div class="muted" id="loginErr" style="min-height:18px;font-size:13px;color:var(--red)"></div>
          <button type="submit" class="btn" style="width:100%;margin-top:8px">Entrar</button>
        </form>
      </div>`;
    document.body.appendChild(root);
    const form = root.querySelector('#loginForm');
    form.pin.focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await fetch('/api/auth/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: form.pin.value }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'PIN incorreto.');
        setToken(data.token);
        root.remove();
        loginPromise = null;
        resolve();
      } catch (err) {
        root.querySelector('#loginErr').textContent = err.message;
        form.pin.value = '';
        form.pin.focus();
      }
    });
  });
  return loginPromise;
}

function pinModal() {
  api('/api/auth/status').then(({ required }) => {
    openModal(required ? 'Alterar ou remover PIN' : 'Proteger com PIN', `
      <p class="muted" style="margin-bottom:14px;font-size:13.5px">
        Com o PIN ativo, qualquer aparelho (inclusive o celular) precisa digitá-lo para
        ver seus dados. Recomendado se você liberou o acesso pela rede de casa.</p>
      ${required ? fld('PIN atual', '<input name="current" type="password" inputmode="numeric" maxlength="8" required>') : ''}
      ${fld(required ? 'Novo PIN (deixe vazio para REMOVER a proteção)' : 'Novo PIN (4 a 8 números)',
        '<input name="next" type="password" inputmode="numeric" maxlength="8" placeholder="ex.: 2580">')}
    `, {
      onSubmit: async (form) => {
        const body = { current: required ? form.current.value : '', next: form.next.value };
        if (body.next && !/^\d{4,8}$/.test(body.next)) { toast('O PIN deve ter de 4 a 8 números.', true); return; }
        const r = await tryApi(() => api('/api/auth/pin', 'POST', body));
        if (r) {
          setToken(r.token || null);
          closeModal();
          toast(r.required ? 'PIN ativado. Ele será pedido em todos os aparelhos.' : 'Proteção por PIN removida.');
        }
      },
    });
  });
}

function phoneModal() {
  api('/api/meta').then((meta) => {
    const urls = (meta.lan || []).map((u) =>
      `<div class="card" style="text-align:center;padding:14px;margin:8px 0">
        <div class="stat-value" style="font-size:20px;user-select:all">${esc(u)}</div>
      </div>`).join('') || '<p class="muted">Nenhuma rede detectada. O computador está conectado no Wi-Fi?</p>';
    openModal('Acessar pelo celular', `
      <ol style="margin:0 0 14px 18px;line-height:1.9;font-size:14px">
        <li>Execute <strong>uma vez</strong> o arquivo <strong>"Permitir celular (executar 1 vez).bat"</strong> (está na pasta do app) e aceite a permissão.</li>
        <li>Conecte o celular no <strong>mesmo Wi-Fi</strong> deste computador.</li>
        <li>Abra este endereço no navegador do celular:</li>
      </ol>
      ${urls}
      <p class="muted" style="font-size:13px;margin-top:10px">Dica: no celular, use "Adicionar à tela inicial" para virar um ícone de aplicativo. E ative o <strong>PIN</strong> para proteger seus dados na rede.</p>
    `, { submitLabel: 'Entendi', onSubmit: async () => closeModal() });
  });
}

function toast(msg, isError = false, action = null) {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : '');
  el.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-action';
    b.textContent = action.label;
    b.addEventListener('click', () => { el.remove(); action.fn(); });
    el.appendChild(b);
  }
  $('#toastRoot').appendChild(el);
  setTimeout(() => el.remove(), action ? 6500 : 3500);
}

async function tryApi(fn, successMsg) {
  try {
    const r = await fn();
    if (successMsg) toast(successMsg);
    return r;
  } catch (e) {
    toast(e.message, true);
    return null;
  }
}

async function refreshLookups() {
  [state.accounts, state.categories] = await Promise.all([api('/api/accounts'), api('/api/categories')]);
}

async function loadSuggestions(force = false) {
  if (state.suggestions && !force) return state.suggestions;
  state.suggestions = await api('/api/suggestions').catch(() => []);
  return state.suggestions;
}

// Números que "contam" até o valor final — dá vida ao dashboard
function countUp(el, target, { signed = false } = {}) {
  const dur = 650;
  const start = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  function frame(now) {
    const p = Math.min(1, (now - start) / dur);
    const v = Math.round(target * ease(p));
    el.textContent = (signed && v > 0 ? '+' : '') + fmt(v);
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
function runCountUps(root) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  root.querySelectorAll('[data-count]').forEach((el) =>
    countUp(el, Number(el.dataset.count), { signed: el.dataset.signed === '1' }));
}

function confetti() {
  const colors = ['#6366f1', '#ec4899', '#10b981', '#eab308', '#3b82f6', '#f97316'];
  for (let i = 0; i < 90; i++) {
    const d = document.createElement('div');
    d.className = 'confetti';
    d.style.left = Math.random() * 100 + 'vw';
    d.style.background = colors[i % colors.length];
    d.style.animationDuration = (2.2 + Math.random() * 1.6) + 's';
    d.style.animationDelay = (Math.random() * 0.5) + 's';
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 4600);
  }
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

function openModal(title, bodyHtml, { submitLabel = 'Salvar', onSubmit = null, danger = false, wide = false } = {}) {
  const root = $('#modalRoot');
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal${wide ? ' wide' : ''}">
        <h2>${esc(title)}</h2>
        <form id="modalForm">${bodyHtml}
          <div class="modal-actions">
            <button type="button" class="btn subtle" data-close>Cancelar</button>
            <button type="submit" class="btn${danger ? ' red' : ''}">${esc(submitLabel)}</button>
          </div>
        </form>
      </div>
    </div>`;
  const backdrop = root.firstElementChild;
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeModal(); });
  backdrop.querySelector('[data-close]').addEventListener('click', closeModal);
  document.addEventListener('keydown', escClose);
  const form = backdrop.querySelector('#modalForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (onSubmit) await onSubmit(form);
  });
  const first = form.querySelector('input:not([type=hidden]), select');
  if (first) first.focus();
  return backdrop;
}
function escClose(e) { if (e.key === 'Escape') closeModal(); }
function closeModal() {
  $('#modalRoot').innerHTML = '';
  document.removeEventListener('keydown', escClose);
}
const modalIsOpen = () => !!$('#modalRoot').firstElementChild;

function confirmModal(title, message, onConfirm) {
  openModal(title, `<p class="muted" style="margin-bottom:6px">${esc(message)}</p>`, {
    submitLabel: 'Confirmar', danger: true,
    onSubmit: async () => { closeModal(); await onConfirm(); },
  });
}

// campos de formulário -------------------------------------------------------

const fld = (label, inner) => `<div class="field"><label>${esc(label)}</label>${inner}</div>`;
const inputFld = (label, name, value = '', attrs = '') =>
  fld(label, `<input name="${name}" value="${esc(value)}" ${attrs}>`);
const moneyFld = (label, name, cents = null) =>
  fld(label, `<input name="${name}" inputmode="decimal" placeholder="0,00" value="${cents === null ? '' : moneyToInput(cents)}" required>`);
const dateFld = (label, name, value) =>
  fld(label, `<input type="date" name="${name}" value="${esc(value)}" required>`);

function selectFld(label, name, options, selected) {
  const opts = options.map((o) => `<option value="${o.value}" ${String(o.value) === String(selected) ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
  return fld(label, `<select name="${name}">${opts}</select>`);
}
const accountOptions = () => state.accounts.filter((a) => !a.archived).map((a) => ({ value: a.id, label: a.name }));
const categoryOptions = (kind) => state.categories.filter((c) => !c.archived && c.kind === kind).map((c) => ({ value: c.id, label: `${c.icon} ${c.name}` }));

// ---------------------------------------------------------------------------
// Gráficos (SVG/CSS puros)
// ---------------------------------------------------------------------------

function donutChart(items) {
  const total = items.reduce((s, i) => s + i.total, 0);
  if (!total) return `<div class="empty"><span class="big">${icon('target', 32)}</span>Nenhuma despesa neste mês ainda.</div>`;
  const r = 60, C = 2 * Math.PI * r;
  let offset = 0;
  const segs = items.map((i) => {
    const dash = (i.total / total) * C;
    const s = `<circle r="${r}" cx="85" cy="85" fill="none" stroke="${esc(i.color)}" stroke-width="27" stroke-dasharray="${dash} ${C - dash}" stroke-dashoffset="${-offset}"><title>${esc(i.name)}: ${fmt(i.total)}</title></circle>`;
    offset += dash;
    return s;
  }).join('');
  const legend = items.slice(0, 8).map((i) => `
    <div class="legend-item">
      <span class="dot" style="background:${esc(i.color)}"></span>
      <span class="lname">${esc(i.name)}</span>
      <span class="lval">${fmt(i.total)}</span>
    </div>`).join('');
  return `
    <div class="chart-wrap">
      <svg width="170" height="170" viewBox="0 0 170 170" style="transform:rotate(-90deg);flex-shrink:0">${segs}</svg>
      <div class="legend">${legend}${items.length > 8 ? `<div class="legend-item muted">+ ${items.length - 8} outras…</div>` : ''}</div>
    </div>`;
}

function historyBars(history) {
  const max = Math.max(...history.map((h) => Math.max(h.receitas, h.despesas)), 1);
  const groups = history.map((h) => {
    const [y, m] = h.month.split('-').map(Number);
    const lbl = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short' });
    return `
      <div class="bar-group">
        <div class="bar-pair">
          <div class="bar receita" style="height:${Math.round((h.receitas / max) * 100)}%" title="Receitas ${lbl}: ${fmt(h.receitas)}"></div>
          <div class="bar despesa" style="height:${Math.round((h.despesas / max) * 100)}%" title="Despesas ${lbl}: ${fmt(h.despesas)}"></div>
        </div>
        <div class="bar-label">${lbl}</div>
      </div>`;
  }).join('');
  return `<div class="bars">${groups}</div>`;
}

// Gráfico de linha (patrimônio). points = [{month, total}]
function lineChart(points, { w = 640, h = 200, mini = false } = {}) {
  if (points.length < 2) return '<div class="muted">Sem dados suficientes ainda.</div>';
  const vals = points.map((p) => p.total);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 100; max += 100; }
  const padY = (max - min) * 0.12;
  min -= padY; max += padY;
  const padL = mini ? 2 : 8, padR = mini ? 2 : 8, padT = 6, padB = mini ? 4 : 26;
  const X = (i) => padL + (i / (points.length - 1)) * (w - padL - padR);
  const Y = (v) => padT + (1 - (v - min) / (max - min)) * (h - padT - padB);
  const pts = points.map((p, i) => `${X(i).toFixed(1)},${Y(p.total).toFixed(1)}`).join(' ');
  const area = `${padL},${(h - padB).toFixed(1)} ${pts} ${(w - padR).toFixed(1)},${(h - padB).toFixed(1)}`;
  const labels = mini ? '' : points.map((p, i) => {
    if (points.length > 8 && i % 2 === 1 && i !== points.length - 1) return '';
    const [y, m] = p.month.split('-').map(Number);
    const lbl = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short' });
    return `<text x="${X(i).toFixed(1)}" y="${h - 8}" font-size="10.5" fill="var(--text-dim)" text-anchor="middle">${lbl}</text>`;
  }).join('');
  const dots = mini ? '' : points.map((p, i) =>
    `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.total).toFixed(1)}" r="3.2" fill="var(--accent)"><title>${monthLabel(p.month)}: ${fmt(p.total)}</title></circle>`).join('');
  return `
    <svg class="${mini ? 'sparkline' : 'linechart'}" ${mini ? `width="${w}" height="${h}"` : ''} viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <polygon points="${area}" fill="var(--accent)" opacity="0.12"/>
      <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}${labels}
    </svg>`;
}

function progressRow(label, spent, total, color) {
  const pct = total > 0 ? Math.min(100, Math.round((spent / total) * 100)) : 0;
  const over = spent > total;
  return `
    <div class="progress-row">
      <div class="progress-head">
        <span class="lbl">${label}</span>
        <span class="val ${over ? 'over' : ''}">${fmt(spent)} / ${fmt(total)}</span>
      </div>
      <div class="progress"><div style="width:${pct}%;background:${over ? 'var(--red)' : color}"></div></div>
    </div>`;
}

// Gráfico do fluxo de caixa projetado (saldo dia a dia, com linha do zero)
function cashflowChart(cf, { w = 640, h = 190 } = {}) {
  const pts = cf.points;
  if (!pts || pts.length < 2) return '<div class="muted">Sem dados suficientes.</div>';
  const vals = pts.map((p) => p.balance);
  let min = Math.min(...vals, 0), max = Math.max(...vals, 1);
  const pad = (max - min) * 0.1 || 100;
  min -= pad; max += pad;
  const padL = 8, padR = 8, padT = 6, padB = 26;
  const X = (i) => padL + (i / (pts.length - 1)) * (w - padL - padR);
  const Y = (v) => padT + (1 - (v - min) / (max - min)) * (h - padT - padB);
  const line = pts.map((p, i) => `${X(i).toFixed(1)},${Y(p.balance).toFixed(1)}`).join(' ');
  const area = `${padL},${(h - padB).toFixed(1)} ${line} ${(w - padR).toFixed(1)},${(h - padB).toFixed(1)}`;
  const zeroY = Y(0).toFixed(1);
  const step = Math.max(1, Math.ceil(pts.length / 6));
  const labels = pts.map((p, i) => (i % step === 0 || i === pts.length - 1)
    ? `<text x="${X(i).toFixed(1)}" y="${h - 8}" font-size="10.5" fill="var(--text-dim)" text-anchor="middle">${fmtDate(p.date)}</text>` : '').join('');
  const dots = pts.map((p, i) => (i % step === 0 || i === pts.length - 1)
    ? `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.balance).toFixed(1)}" r="3" fill="${cf.firstNegative ? 'var(--red)' : 'var(--accent)'}"><title>${fmtDateFull(p.date)}: ${fmt(p.balance)}</title></circle>` : '').join('');
  const stroke = cf.firstNegative ? 'var(--red)' : 'var(--accent)';
  return `
    <svg class="linechart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <line x1="${padL}" x2="${w - padR}" y1="${zeroY}" y2="${zeroY}" stroke="var(--border)" stroke-dasharray="4 4"/>
      <polygon points="${area}" fill="${stroke}" opacity="0.1"/>
      <polyline points="${line}" fill="none" stroke="${stroke}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}${labels}
    </svg>`;
}

// resumo abaixo do gráfico de fluxo de caixa
function cashflowSummary(cf, days) {
  const minPoint = cf.points.reduce((a, b) => (b.balance < a.balance ? b : a));
  return cf.firstNegative
    ? `<div class="insight bad" style="margin-top:10px"><span class="em">${icon('alert-triangle', 16)}</span><span>Atenção: mantendo as pendências e contas fixas, o saldo fica <strong>negativo em ${fmtDateFull(cf.firstNegative)}</strong>. Antecipe receitas ou corte gastos antes dessa data.</span></div>`
    : `<div class="insight good" style="margin-top:10px"><span class="em">${icon('check-circle', 16)}</span><span>Saldo permanece positivo nos próximos ${days} dias. Ponto mais baixo: <strong>${fmt(minPoint.balance)}</strong> em ${fmtDateFull(minPoint.date)}.</span></div>`;
}

// valores compactos (sem centavos) para a matriz anual
const fmtShort = (cents) => (cents / 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 });

// Prepara arquivo de comprovante: imagem é reduzida e convertida para JPEG
// (foto de celular cai de ~5 MB para ~300 KB); PDF vai como está.
async function fileToUpload(file) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (isPdf) {
    if (file.size > 8 * 1024 * 1024) throw new Error('PDF muito grande (máximo 8 MB).');
    const data = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(new Error('Falha ao ler o arquivo.'));
      fr.readAsDataURL(file);
    });
    return { ext: 'pdf', data };
  }
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('Arquivo de imagem inválido.'));
    i.src = URL.createObjectURL(file);
  });
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.width * scale);
  cv.height = Math.round(img.height * scale);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  URL.revokeObjectURL(img.src);
  return { ext: 'jpg', data: cv.toDataURL('image/jpeg', 0.82) };
}

// ---------------------------------------------------------------------------
// Formulário de lançamento (novo/editar) com autocompletar e parcelamento
// ---------------------------------------------------------------------------

async function transactionModal(tx = null, defaultType = 'despesa', presetDate = null) {
  await loadSuggestions();
  let type = tx ? tx.type : defaultType;
  const isNew = !tx || !tx.id;

  function bodyFor(type, tx) {
    const isTransfer = type === 'transferencia';
    const sugg = (state.suggestions || []).filter((s) => s.type === type).slice(0, 60);
    const datalist = `<datalist id="descSugg">${sugg.map((s) => `<option value="${esc(s.description)}">`).join('')}</datalist>`;
    return `
      <div class="field"><div class="seg" id="typeSeg">
        <button type="button" data-t="receita" class="${type === 'receita' ? 'on-receita' : ''}">Receita</button>
        <button type="button" data-t="despesa" class="${type === 'despesa' ? 'on-despesa' : ''}">Despesa</button>
        <button type="button" data-t="transferencia" class="${type === 'transferencia' ? 'on-transferencia' : ''}">Transferência</button>
      </div></div>
      ${fld('Descrição', `<input name="description" list="descSugg" value="${esc(tx ? tx.description : '')}" required maxlength="200" placeholder="Ex.: Supermercado" autocomplete="off">${datalist}<div class="hint" id="suggHint" style="display:none">Categoria e conta preenchidas com base no seu histórico.</div>`)}
      <div class="field-row">
        ${moneyFld(isNew && type === 'despesa' ? 'Valor total (R$)' : 'Valor (R$)', 'amount', tx ? tx.amount : null)}
        ${dateFld('Data', 'date', tx ? tx.date : (presetDate || state.today))}
      </div>
      <div class="field-row">
        ${selectFld(isTransfer ? 'Conta de origem' : 'Conta', 'account_id', accountOptions(), tx ? tx.account_id : '')}
        ${isTransfer
          ? selectFld('Conta de destino', 'to_account_id', accountOptions(), tx ? tx.to_account_id : '')
          : selectFld('Categoria', 'category_id', categoryOptions(type), tx ? tx.category_id : '')}
      </div>
      <div class="field-row">
        ${selectFld('Situação', 'status', [{ value: 'pago', label: type === 'receita' ? 'Recebido' : 'Pago' }, { value: 'pendente', label: 'Pendente' }], tx ? tx.status : 'pago')}
        ${isNew && type === 'despesa'
          ? selectFld('Parcelamento', 'installments', [{ value: 1, label: 'À vista (1x)' }, ...[2,3,4,5,6,7,8,9,10,11,12,15,18,24].map((n) => ({ value: n, label: `${n}x de (total ÷ ${n})` }))], 1)
          : ''}
      </div>
      ${isNew && type === 'despesa' ? '<div class="hint" id="parcHint" style="display:none;margin:-6px 0 12px"></div>' : ''}
      ${fld('Observações (opcional)', `<textarea name="notes" rows="2" maxlength="500">${esc(tx ? tx.notes || '' : '')}</textarea>`)}
      <div class="field" id="attachArea">
        <label>Comprovante (foto ou PDF, opcional)</label>
        ${tx && tx.id && tx.attachment
          ? `<div style="display:flex;gap:8px">
              <button type="button" class="btn subtle" id="attachView" style="flex:1">${icon('eye', 14)} Ver comprovante</button>
              <button type="button" class="btn subtle" id="attachRemove">${icon('trash', 14)} Remover</button>
            </div>`
          : `<input type="file" name="attachFile" accept="image/*,application/pdf">
             <div class="hint">No celular, dá para tirar a foto na hora. Imagens são comprimidas automaticamente.</div>`}
      </div>
    `;
  }

  const backdrop = openModal(tx && tx.id ? 'Editar lançamento' : 'Novo lançamento', bodyFor(type, tx), {
    onSubmit: async (form) => {
      const amount = parseMoney(form.amount.value);
      if (amount === null || amount <= 0) { toast('Informe um valor válido, ex.: 149,90', true); return; }
      const body = {
        type,
        description: form.description.value,
        amount,
        date: form.date.value,
        account_id: Number(form.account_id.value),
        status: form.status.value,
        notes: form.notes.value || null,
      };
      if (type === 'transferencia') body.to_account_id = Number(form.to_account_id.value);
      else body.category_id = Number(form.category_id.value);
      if (isNew && form.installments) body.installments = Number(form.installments.value);
      const r = await tryApi(
        () => (tx && tx.id) ? api(`/api/transactions/${tx.id}`, 'PUT', body) : api('/api/transactions', 'POST', body),
        (tx && tx.id) ? 'Lançamento atualizado.'
          : body.installments > 1 ? `Compra registrada em ${body.installments} parcelas.` : 'Lançamento adicionado.'
      );
      if (r) {
        // se escolheu um comprovante, envia agora (para lançamento novo, depois de criar)
        const fileInput = form.attachFile;
        const txId = (tx && tx.id) || r.id;
        if (fileInput && fileInput.files && fileInput.files[0] && txId) {
          try {
            const up = await fileToUpload(fileInput.files[0]);
            await api(`/api/transactions/${txId}/attachment`, 'POST', up);
            toast('Comprovante anexado.');
          } catch (e) {
            toast('O lançamento foi salvo, mas o comprovante falhou: ' + e.message, true);
          }
        }
        state.suggestions = null; closeModal(); render();
      }
    },
  });

  const form = backdrop.querySelector('#modalForm');

  // troca de tipo re-renderiza o corpo preservando o que der
  backdrop.querySelector('#typeSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-t]');
    if (!btn || btn.dataset.t === type) return;
    const keep = {
      description: form.description.value,
      amount: parseMoney(form.amount.value),
      date: form.date.value,
      account_id: Number(form.account_id.value),
      status: form.status.value,
      notes: form.notes.value,
    };
    closeModal();
    transactionModal(tx && tx.id ? { ...tx, ...keep, type: btn.dataset.t }
      : { id: null, ...keep, type: btn.dataset.t, category_id: null, to_account_id: null }, btn.dataset.t, presetDate);
  });

  // 🧠 autocompletar: descrição conhecida preenche categoria/conta/valor
  if (type !== 'transferencia') {
    form.description.addEventListener('change', () => {
      const v = form.description.value.trim().toLowerCase();
      const s = (state.suggestions || []).find((x) => x.type === type && x.description.toLowerCase() === v);
      if (!s) return;
      if (s.category_id && form.category_id) form.category_id.value = s.category_id;
      if (s.account_id) form.account_id.value = s.account_id;
      if (!form.amount.value && s.amount) form.amount.value = moneyToInput(s.amount);
      const hint = form.querySelector('#suggHint');
      if (hint) hint.style.display = 'block';
    });
  }

  // comprovante já anexado: ver / remover
  const attachView = backdrop.querySelector('#attachView');
  if (attachView && tx && tx.attachment) {
    attachView.addEventListener('click', () => openExport(`/api/attachments/${tx.attachment}`));
    backdrop.querySelector('#attachRemove').addEventListener('click', async () => {
      const ok = await tryApi(() => api(`/api/transactions/${tx.id}/attachment`, 'DELETE'), 'Comprovante removido.');
      if (ok) {
        tx.attachment = null;
        backdrop.querySelector('#attachArea').innerHTML = `
          <label>Comprovante (foto ou PDF, opcional)</label>
          <input type="file" name="attachFile" accept="image/*,application/pdf">`;
      }
    });
  }

  // dica do valor da parcela
  if (isNew && type === 'despesa') {
    const updateParc = () => {
      const hint = form.querySelector('#parcHint');
      const n = Number(form.installments.value);
      const total = parseMoney(form.amount.value);
      if (hint) {
        if (n > 1 && total) {
          hint.style.display = 'block';
          hint.textContent = `${n} parcelas de ~${fmt(Math.floor(total / n))} — a 1ª entra em ${fmtDateFull(form.date.value)} e as demais nos meses seguintes, como pendentes.`;
        } else hint.style.display = 'none';
      }
    };
    form.installments.addEventListener('change', updateParc);
    form.amount.addEventListener('input', updateParc);
  }
}

// ---------------------------------------------------------------------------
// VIEW: Dashboard
// ---------------------------------------------------------------------------

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

async function renderDashboard(el) {
  const [d, ins, nw, cf, recentes] = await Promise.all([
    api(`/api/dashboard?month=${state.month}`),
    api(`/api/insights?month=${state.month}`),
    api('/api/reports/networth?months=6'),
    api('/api/reports/cashflow?days=30'),
    api(`/api/transactions?month=${state.month}`),
  ]);
  const res = d.resultado;

  const toneIcon = (tone) => icon(tone === 'good' ? 'check-circle' : tone === 'info' ? 'info' : 'alert-triangle', 16);
  const insightsHtml = ins.insights.map((i) => `
    <div class="insight ${esc(i.tone)}"><span class="em">${toneIcon(i.tone)}</span><span>${esc(i.text)}</span></div>`).join('');

  const upcoming = d.upcoming.length ? d.upcoming.map((t) => `
    <tr>
      <td>${fmtDate(t.date)}</td>
      <td>${esc(t.description)}${t.installment_total ? `<span class="parcela-tag">${t.installment_no}/${t.installment_total}</span>` : ''}</td>
      <td class="num ${t.type === 'receita' ? 'pos' : 'neg'}">${t.type === 'receita' ? '+' : '−'}${fmt(t.amount)}</td>
      <td class="actions"><button class="btn-ghost small" data-pay="${t.id}">${icon('check', 12)} ${t.type === 'receita' ? 'recebi' : 'paguei'}</button></td>
    </tr>`).join('')
    : `<tr><td colspan="4" class="muted" style="text-align:center;padding:18px">Nada pendente neste mês.</td></tr>`;

  const budgets = d.budgets.slice(0, 6).map((b) =>
    progressRow(`<span class="cat-avatar" style="background:${esc(b.color)}22">${esc(b.icon)}</span><span class="name">${esc(b.name)}</span>`, b.spent, b.amount, b.color)).join('')
    || `<div class="muted">Nenhum orçamento definido. Configure na aba <strong>Orçamento</strong>.</div>`;

  const goals = d.goals.map((g) =>
    progressRow(`<span class="name">${esc(g.name)}</span>`, g.saved, g.target, g.color)).join('');

  const todayLong = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  // últimos lançamentos do mês (dá densidade de informação ao painel)
  const ultimos = recentes.items.slice(0, 8).map((t) => {
    const val = t.type === 'receita' ? `<span class="pos">+${fmt(t.amount)}</span>`
      : t.type === 'despesa' ? `<span class="neg">−${fmt(t.amount)}</span>` : fmt(t.amount);
    return `<tr>
      <td class="muted" style="white-space:nowrap">${fmtDate(t.date)}</td>
      <td>${esc(t.description)}${t.installment_total ? `<span class="parcela-tag">${t.installment_no}/${t.installment_total}</span>` : ''}</td>
      <td class="muted">${t.type === 'transferencia' ? '—' : esc(t.category_name || '')}</td>
      <td class="num">${val}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="4" class="muted" style="text-align:center;padding:14px">Nenhum lançamento neste mês ainda.</td></tr>`;

  el.innerHTML = `
    <div class="hero">
      <div class="hi">${greeting()}</div>
      <div class="sub">${esc(todayLong)}</div>
    </div>

    <div class="kpis">
      <div class="kpi"><div class="k-label">Saldo em contas</div>
        <div class="k-value hero stat-value" style="font-size:16.5px" data-count="${d.totalBalance}">${fmt(d.totalBalance)}</div>
        <div class="k-sub">${d.accounts.length} conta(s) ativa(s)</div></div>
      <div class="kpi"><div class="k-label">Receitas do mês</div>
        <div class="k-value pos" data-count="${d.receitas}">${fmt(d.receitas)}</div>
        <div class="k-sub">${d.pendentes.receitas ? fmt(d.pendentes.receitas) + ' a receber' : 'tudo recebido'}</div></div>
      <div class="kpi"><div class="k-label">Despesas do mês</div>
        <div class="k-value neg" data-count="${d.despesas}">${fmt(d.despesas)}</div>
        <div class="k-sub">${d.pendentes.despesas ? fmt(d.pendentes.despesas) + ' a pagar' : 'tudo pago'}</div></div>
      <div class="kpi"><div class="k-label">Resultado do mês</div>
        <div class="k-value ${res >= 0 ? 'pos' : 'neg'}" data-count="${res}" data-signed="1">${res >= 0 ? '+' : ''}${fmt(res)}</div>
        <div class="k-sub">receitas − despesas</div></div>
      <div class="kpi"><div class="k-label">A pagar no mês</div>
        <div class="k-value">${fmt(d.pendentes.despesas)}</div>
        <div class="k-sub">${d.upcoming.length} lançamento(s) pendente(s)</div></div>
      <div class="kpi"><div class="k-label">Projeção de despesas</div>
        <div class="k-value">${ins.projection !== null ? fmt(ins.projection) : '—'}</div>
        <div class="k-sub">no ritmo atual, até o fim do mês</div></div>
    </div>

    <div class="grid cols-2 mt">
      <div class="card"><h3>${icon('activity', 13)} Radar financeiro</h3><div class="insights">${insightsHtml}</div></div>
      <div class="card"><h3>${icon('chart-line', 13)} Fluxo de caixa — 30 dias</h3>
        ${cashflowChart(cf, { w: 640, h: 165 })}${cashflowSummary(cf, 30)}</div>
    </div>

    <div class="grid cols-2 mt">
      <div class="card"><h3>${icon('list', 13)} Últimos lançamentos</h3>
        <div class="table-wrap"><table class="table"><tbody>${ultimos}</tbody></table></div></div>
      <div class="card"><h3>${icon('calendar', 13)} Contas a pagar / receber no mês</h3>
        <div class="table-wrap"><table class="table"><tbody>${upcoming}</tbody></table></div></div>
    </div>

    <div class="grid cols-2 mt">
      <div class="card"><h3>${icon('arrow-out', 13)} Despesas por categoria</h3>${donutChart(d.byCategory)}</div>
      <div class="card"><h3>${icon('bar-chart', 13)} Últimos 6 meses <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">(verde = receitas, vermelho = despesas)</span></h3>${historyBars(d.history)}</div>
    </div>

    <div class="grid cols-2 mt">
      <div class="card"><h3>${icon('target', 13)} Orçamento do mês</h3>${budgets}</div>
      <div class="card"><h3>${icon('flag', 13)} Metas · ${icon('trending-up', 13)} Patrimônio</h3>
        ${goals || '<div class="muted" style="font-size:12.5px;margin-bottom:10px">Nenhuma meta criada ainda.</div>'}
        <div class="stat-sub" style="margin-top:10px">Evolução do patrimônio (6 meses)</div>
        ${lineChart(nw, { w: 640, h: 90 })}</div>
    </div>`;

  runCountUps(el);
  el.querySelectorAll('[data-pay]').forEach((btn) => btn.addEventListener('click', async () => {
    await tryApi(() => api(`/api/transactions/${btn.dataset.pay}/toggle-status`, 'POST'), 'Marcado como pago!');
    render();
  }));
}

// ---------------------------------------------------------------------------
// VIEW: Lançamentos
// ---------------------------------------------------------------------------

async function renderTransactions(el) {
  const f = state.txFilters;
  const params = new URLSearchParams({ month: state.month });
  for (const [k, v] of Object.entries(f)) if (v) params.set(k, v);
  const { items, totals } = await api('/api/transactions?' + params);

  const typeOpts = [['', 'Todos os tipos'], ['receita', 'Receitas'], ['despesa', 'Despesas'], ['transferencia', 'Transferências']];
  const statusOpts = [['', 'Qualquer situação'], ['pago', 'Pagos'], ['pendente', 'Pendentes']];

  const rows = items.length ? items.map((t) => {
    const cat = t.type === 'transferencia'
      ? `<span class="chip"><span class="cat-avatar" style="background:var(--accent-soft);color:var(--accent-text)">${icon('swap', 12)}</span>${esc(t.account_name)} → ${esc(t.to_account_name)}</span>`
      : `<span class="chip"><span class="cat-avatar" style="background:${esc(t.category_color || '#888')}22">${esc(t.category_icon || '')}</span>${esc(t.category_name || 'Sem categoria')}</span>`;
    const val = t.type === 'receita' ? `<span class="pos">+${fmt(t.amount)}</span>`
      : t.type === 'despesa' ? `<span class="neg">−${fmt(t.amount)}</span>`
      : fmt(t.amount);
    return `
      <tr>
        <td>${fmtDate(t.date)}</td>
        <td>${esc(t.description)}${t.installment_total ? `<span class="parcela-tag">${t.installment_no}/${t.installment_total}</span>` : ''}${t.attachment ? ` <button data-att="${esc(t.attachment)}" class="muted" style="border:none;background:none;cursor:pointer;padding:0" title="Ver comprovante">${icon('paperclip', 13)}</button>` : ''}${t.notes ? ` <span class="muted" title="${esc(t.notes)}">${icon('info', 13)}</span>` : ''}${t.recurring_id ? ` <span class="muted" title="Gerado por recorrência">${icon('repeat', 13)}</span>` : ''}</td>
        <td>${cat}</td>
        <td class="muted">${t.type === 'transferencia' ? '—' : esc(t.account_name)}</td>
        <td><button class="badge ${t.status}" data-toggle="${t.id}" style="border:none;cursor:pointer" title="Clique para alternar">${t.status}</button>${t.reconciled ? ` <span class="rec-check" title="Conferido na conciliação com o banco">${icon('check-circle', 13)}</span>` : ''}</td>
        <td class="num">${val}</td>
        <td class="actions">
          <button class="btn-icon" data-dup="${t.id}" title="Duplicar (lançar de novo hoje)">${icon('copy', 14)}</button>
          <button class="btn-icon" data-edit="${t.id}" title="Editar">${icon('edit', 14)}</button>
          <button class="btn-icon danger" data-del="${t.id}" title="Excluir">${icon('trash', 14)}</button>
        </td>
      </tr>`;
  }).join('') : `<tr><td colspan="7"><div class="empty"><span class="big">${icon('list', 32)}</span>Nenhum lançamento encontrado com esses filtros.</div></td></tr>`;

  el.innerHTML = `
    <div class="actions-bar">
      <button class="btn green" id="addReceita">+ Receita</button>
      <button class="btn red" id="addDespesa">+ Despesa</button>
      <button class="btn subtle" id="addTransfer">${icon('swap', 14)} Transferência</button>
      <button class="btn subtle" id="importBtn" title="Importar extrato do banco (CSV ou OFX)">${icon('download', 14)} Importar extrato</button>
      <div class="spacer"></div>
      <span class="muted">Receitas <strong class="pos">${fmt(totals.receitas)}</strong> · Despesas <strong class="neg">${fmt(totals.despesas)}</strong> · Saldo <strong class="${totals.saldo >= 0 ? 'pos' : 'neg'}">${fmt(totals.saldo)}</strong></span>
    </div>
    <div class="filters">
      <input type="search" id="fQ" placeholder="Buscar descrição…" value="${esc(f.q)}">
      <select id="fType">${typeOpts.map(([v, l]) => `<option value="${v}" ${f.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select id="fAccount"><option value="">Todas as contas</option>${state.accounts.map((a) => `<option value="${a.id}" ${String(f.account_id) === String(a.id) ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
      <select id="fCategory"><option value="">Todas as categorias</option>${state.categories.filter((c) => !c.archived).map((c) => `<option value="${c.id}" ${String(f.category_id) === String(c.id) ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</select>
      <select id="fStatus">${statusOpts.map(([v, l]) => `<option value="${v}" ${f.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <div class="card" style="padding:6px 14px">
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Conta</th><th>Situação</th><th class="num">Valor</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;

  $('#addReceita').addEventListener('click', () => transactionModal(null, 'receita'));
  $('#addDespesa').addEventListener('click', () => transactionModal(null, 'despesa'));
  $('#addTransfer').addEventListener('click', () => transactionModal(null, 'transferencia'));
  $('#importBtn').addEventListener('click', importModal);

  const applyFilters = () => {
    state.txFilters = {
      q: $('#fQ').value, type: $('#fType').value, account_id: $('#fAccount').value,
      category_id: $('#fCategory').value, status: $('#fStatus').value,
    };
    render();
  };
  ['fType', 'fAccount', 'fCategory', 'fStatus'].forEach((id) => $('#' + id).addEventListener('change', applyFilters));
  let searchTimer;
  $('#fQ').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(applyFilters, 350); });

  el.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    await tryApi(() => api(`/api/transactions/${b.dataset.toggle}/toggle-status`, 'POST'));
    render();
  }));
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    const tx = items.find((t) => t.id === Number(b.dataset.edit));
    transactionModal(tx);
  }));
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    const tx = items.find((t) => t.id === Number(b.dataset.del));
    confirmModal('Excluir lançamento', `Excluir "${tx.description}" (${fmt(tx.amount)})?`, async () => {
      const ok = await tryApi(() => api(`/api/transactions/${tx.id}`, 'DELETE'));
      if (ok) {
        // guarda os dados para poder desfazer (recria o lançamento)
        const undo = {
          type: tx.type, description: tx.description, amount: tx.amount, date: tx.date,
          account_id: tx.account_id, to_account_id: tx.to_account_id,
          category_id: tx.category_id, status: tx.status, notes: tx.notes,
        };
        toast('Lançamento excluído.', false, {
          label: 'Desfazer',
          fn: async () => {
            await tryApi(() => api('/api/transactions', 'POST', undo), 'Lançamento recuperado.');
            render();
          },
        });
        render();
      }
    });
  }));
  el.querySelectorAll('[data-dup]').forEach((b) => b.addEventListener('click', () => {
    const tx = items.find((t) => t.id === Number(b.dataset.dup));
    transactionModal({
      id: null, type: tx.type, description: tx.description, amount: tx.amount,
      date: state.today, account_id: tx.account_id, to_account_id: tx.to_account_id,
      category_id: tx.category_id, status: 'pago', notes: tx.notes,
    }, tx.type);
  }));
  el.querySelectorAll('[data-att]').forEach((b) => b.addEventListener('click', () =>
    openExport(`/api/attachments/${b.dataset.att}`)));
}

// ---------------------------------------------------------------------------
// Importação de extrato (CSV / OFX)
// ---------------------------------------------------------------------------

function parseDateLoose(s) {
  s = String(s).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})$/);
  if (m) return `20${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function parseAmountLoose(s) {
  s = String(s).trim().replace(/R\$|\s/g, '');
  if (!s) return null;
  const neg = /^-|^\(/.test(s);
  s = s.replace(/[()]/g, '').replace(/^-/, '').replace(/^\+/, '');
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc > ld) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const v = Number(s);
  if (!isFinite(v) || v === 0) return null;
  return Math.round(Math.abs(v) * 100) * (neg || v < 0 ? -1 : 1);
}

function splitCsvLine(line, sep) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// Extrai lançamentos de um arquivo OFX (formato comum de bancos brasileiros)
function parseOfx(text) {
  const items = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  for (const b of blocks) {
    const grab = (tag) => {
      const m = b.match(new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i'));
      return m ? m[1].trim() : null;
    };
    const date = parseDateLoose(grab('DTPOSTED') || '');
    const amount = parseAmountLoose(grab('TRNAMT') || '');
    const desc = grab('MEMO') || grab('NAME') || 'Lançamento importado';
    if (date && amount) items.push({ date, description: desc.slice(0, 200), amount });
  }
  return items;
}

// Extrai lançamentos de um CSV, adivinhando separador e colunas
function parseCsvStatement(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = [';', ',', '\t'].map((s) => ({ s, n: (lines[0].match(new RegExp(s === '\t' ? '\t' : '\\' + s, 'g')) || []).length }))
    .sort((a, b) => b.n - a.n)[0].s;
  const rows = lines.map((l) => splitCsvLine(l, sep));
  // adivinha colunas testando as primeiras linhas de dados
  const sample = rows.slice(0, 8);
  const nCols = Math.max(...sample.map((r) => r.length));
  let dateCol = -1, amountCol = -1;
  for (let c = 0; c < nCols; c++) {
    const dates = sample.filter((r) => r[c] && parseDateLoose(r[c])).length;
    if (dates >= sample.length - 1 && dateCol === -1) dateCol = c;
  }
  for (let c = nCols - 1; c >= 0; c--) {
    if (c === dateCol) continue;
    const nums = sample.filter((r) => r[c] && parseAmountLoose(r[c]) !== null && !parseDateLoose(r[c])).length;
    if (nums >= sample.length - 1) { amountCol = c; break; }
  }
  if (dateCol === -1 || amountCol === -1) return [];
  // coluna de descrição: a com textos mais longos que não seja data/valor
  let descCol = -1, best = -1;
  for (let c = 0; c < nCols; c++) {
    if (c === dateCol || c === amountCol) continue;
    const len = sample.reduce((s, r) => s + String(r[c] || '').length, 0);
    if (len > best) { best = len; descCol = c; }
  }
  const items = [];
  for (const r of rows) {
    const date = r[dateCol] && parseDateLoose(r[dateCol]);
    const amount = r[amountCol] && parseAmountLoose(r[amountCol]);
    if (!date || !amount) continue; // pula cabeçalho e linhas inválidas
    const description = String(descCol >= 0 ? r[descCol] || '' : '').trim().slice(0, 200) || 'Lançamento importado';
    items.push({ date, description, amount });
  }
  return items;
}

function importModal() {
  const catDesp = state.categories.find((c) => c.kind === 'despesa' && c.name.startsWith('Outras')) || state.categories.find((c) => c.kind === 'despesa');
  const catRec = state.categories.find((c) => c.kind === 'receita' && c.name.startsWith('Outras')) || state.categories.find((c) => c.kind === 'receita');
  let parsed = [];

  const backdrop = openModal('Importar extrato do banco', `
    ${fld('Arquivo do extrato (CSV ou OFX)', `<input type="file" name="file" accept=".csv,.ofx,.txt,.tsv" required>
      <div class="hint">Baixe o extrato no site/app do seu banco em formato CSV ou OFX e selecione aqui. As colunas são detectadas automaticamente.</div>`)}
    <div class="field-row">
      ${selectFld('Importar para a conta', 'account_id', accountOptions(), '')}
      ${selectFld('Categoria p/ despesas', 'expense_category_id', categoryOptions('despesa'), catDesp ? catDesp.id : '')}
    </div>
    ${selectFld('Categoria p/ receitas', 'income_category_id', categoryOptions('receita'), catRec ? catRec.id : '')}
    <div id="importPreview"></div>
  `, {
    submitLabel: 'Importar', wide: true,
    onSubmit: async (form) => {
      if (!parsed.length) { toast('Selecione um arquivo de extrato primeiro.', true); return; }
      const items = parsed.map((p) => ({
        date: p.date, description: p.description,
        amount: Math.abs(p.amount),
        type: p.amount < 0 ? 'despesa' : 'receita',
      }));
      const r = await tryApi(() => api('/api/import', 'POST', {
        account_id: Number(form.account_id.value),
        expense_category_id: Number(form.expense_category_id.value),
        income_category_id: Number(form.income_category_id.value),
        items,
      }));
      if (r) {
        closeModal();
        toast(`${r.created} lançamento(s) importado(s)${r.skipped ? ` · ${r.skipped} duplicado(s) ignorado(s)` : ''}.`);
        state.suggestions = null;
        render();
      }
    },
  });

  backdrop.querySelector('input[name=file]').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    parsed = /<OFX|<STMTTRN/i.test(text) ? parseOfx(text) : parseCsvStatement(text);
    const box = backdrop.querySelector('#importPreview');
    if (!parsed.length) {
      box.innerHTML = `<div class="empty" style="padding:20px">Não consegui entender esse arquivo. Verifique se é um extrato em CSV (com colunas de data, descrição e valor) ou OFX.</div>`;
      return;
    }
    const totalIn = parsed.filter((p) => p.amount > 0).reduce((s, p) => s + p.amount, 0);
    const totalOut = parsed.filter((p) => p.amount < 0).reduce((s, p) => s - p.amount, 0);
    box.innerHTML = `
      <p style="margin:8px 0" class="muted">Encontrei <strong>${parsed.length}</strong> lançamentos ·
        <span class="pos">+${fmt(totalIn)}</span> · <span class="neg">−${fmt(totalOut)}</span>.
        Duplicados já importados antes serão ignorados automaticamente.</p>
      <div class="import-preview"><table class="table">
        <thead><tr><th>Data</th><th>Descrição</th><th class="num">Valor</th></tr></thead>
        <tbody>${parsed.slice(0, 50).map((p) => `
          <tr><td>${fmtDateFull(p.date)}</td><td>${esc(p.description)}</td>
          <td class="num ${p.amount < 0 ? 'neg' : 'pos'}">${p.amount < 0 ? '−' : '+'}${fmt(Math.abs(p.amount))}</td></tr>`).join('')}
        </tbody></table>
        ${parsed.length > 50 ? `<p class="muted" style="padding:8px 12px">… e mais ${parsed.length - 50} linha(s)</p>` : ''}
      </div>`;
  });
}

// ---------------------------------------------------------------------------
// VIEW: Calendário
// ---------------------------------------------------------------------------

async function renderCalendar(el) {
  const { items } = await api(`/api/transactions?month=${state.month}`);
  const byDay = {};
  for (const t of items) (byDay[t.date] = byDay[t.date] || []).push(t);

  const [y, m] = state.month.split('-').map(Number);
  const totalDays = new Date(y, m, 0).getDate();
  const firstWeekday = new Date(y, m - 1, 1).getDay();

  const heads = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'].map((d) => `<div class="cal-head">${d}</div>`).join('');
  let cells = '';
  for (let i = 0; i < firstWeekday; i++) cells += '<div class="cal-day empty"></div>';
  for (let day = 1; day <= totalDays; day++) {
    const iso = `${state.month}-${String(day).padStart(2, '0')}`;
    const list = byDay[iso] || [];
    let net = 0;
    for (const t of list) net += t.type === 'receita' ? t.amount : t.type === 'despesa' ? -t.amount : 0;
    const preview = list.slice(0, 2).map((t) =>
      `<div class="cal-item">${t.category_icon ? esc(t.category_icon) + ' ' : ''}${esc(t.description)}</div>`).join('')
      + (list.length > 2 ? `<div class="cal-item">+ ${list.length - 2} mais…</div>` : '');
    cells += `
      <div class="cal-day${iso === state.today ? ' today' : ''}" data-day="${iso}" style="animation-delay:${Math.min(day * 12, 350)}ms">
        <div class="cal-num">${day}</div>
        ${preview}
        ${list.length ? `<div class="cal-total ${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : '−'}${fmt(Math.abs(net))}</div>` : ''}
      </div>`;
  }

  el.innerHTML = `
    <p class="muted" style="margin-bottom:14px">Clique em um dia para ver os detalhes ou adicionar um lançamento nele.</p>
    <div class="cal-grid">${heads}${cells}</div>`;

  el.querySelectorAll('.cal-day[data-day]').forEach((cell) => cell.addEventListener('click', () => {
    const iso = cell.dataset.day;
    const list = byDay[iso] || [];
    dayModal(iso, list);
  }));
}

function dayModal(iso, list) {
  const rows = list.length ? list.map((t) => {
    const val = t.type === 'receita' ? `<span class="pos">+${fmt(t.amount)}</span>`
      : t.type === 'despesa' ? `<span class="neg">−${fmt(t.amount)}</span>` : fmt(t.amount);
    return `<tr>
      <td>${t.category_icon ? esc(t.category_icon) + ' ' : ''}${esc(t.description)}${t.installment_total ? `<span class="parcela-tag">${t.installment_no}/${t.installment_total}</span>` : ''}</td>
      <td><span class="badge ${t.status}">${t.status}</span></td>
      <td class="num">${val}</td>
      <td class="actions"><button type="button" class="btn-icon" data-edit="${t.id}">${icon('edit', 14)}</button></td>
    </tr>`;
  }).join('') : `<tr><td colspan="4" class="muted" style="text-align:center;padding:16px">Nenhum lançamento neste dia.</td></tr>`;

  const backdrop = openModal(fmtDateFull(iso), `
    <table class="table"><tbody>${rows}</tbody></table>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button type="button" class="btn green" data-new="receita">+ Receita</button>
      <button type="button" class="btn red" data-new="despesa">+ Despesa</button>
    </div>
  `, { submitLabel: 'Fechar', onSubmit: async () => closeModal() });

  backdrop.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => {
    closeModal();
    transactionModal(null, b.dataset.new, iso);
  }));
  backdrop.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    const tx = list.find((t) => t.id === Number(b.dataset.edit));
    closeModal();
    transactionModal(tx);
  }));
}

// ---------------------------------------------------------------------------
// VIEW: Conciliação — confere o app contra o banco, todo dia
// ---------------------------------------------------------------------------

async function renderReconcile(el) {
  await refreshLookups();
  const active = state.accounts.filter((a) => !a.archived);
  if (!active.length) {
    el.innerHTML = `<div class="empty"><span class="big">${icon('landmark', 32)}</span>Crie uma conta primeiro, na aba <strong>Contas</strong>.</div>`;
    return;
  }
  if (!state.reconcile.account_id || !active.some((a) => a.id === state.reconcile.account_id)) {
    state.reconcile.account_id = active[0].id;
  }
  const { account, items } = await api(`/api/reconcile?account_id=${state.reconcile.account_id}`);

  const bankCents = parseMoney(state.reconcile.bank);
  const diff = bankCents !== null ? bankCents - account.reconciled_balance : null;

  const rows = items.length ? items.map((t) => `
    <tr>
      <td><input type="checkbox" data-check="${t.id}" style="width:17px;height:17px;cursor:pointer" title="Confirmei este lançamento no extrato do banco"></td>
      <td>${fmtDate(t.date)}</td>
      <td>${t.category_icon ? esc(t.category_icon) + ' ' : ''}${esc(t.description)}${t.installment_total ? `<span class="parcela-tag">${t.installment_no}/${t.installment_total}</span>` : ''}
        ${t.type === 'transferencia' ? `<span class="muted" style="font-size:12px"> (${esc(t.account_name)} → ${esc(t.to_account_name)})</span>` : ''}</td>
      <td class="num ${t.effect >= 0 ? 'pos' : 'neg'}">${t.effect >= 0 ? '+' : '−'}${fmt(Math.abs(t.effect))}</td>
    </tr>`).join('')
    : `<tr><td colspan="4"><div class="empty" style="padding:26px"><span class="big">${icon('check-circle', 32)}</span>Tudo conferido nesta conta. Nenhum lançamento pago aguardando conciliação.</div></td></tr>`;

  el.innerHTML = `
    <div class="filters" style="align-items:center">
      <label class="muted">Conta:</label>
      <select id="recAccount">${active.map((a) => `<option value="${a.id}" ${a.id === state.reconcile.account_id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
      <div class="spacer"></div>
      <button class="btn subtle" id="recImport">${icon('download', 14)} Importar extrato</button>
    </div>

    <div class="grid cards-4">
      <div class="card"><h3>Saldo no app (tudo pago)</h3><div class="stat-value">${fmt(account.balance)}</div></div>
      <div class="card"><h3>${icon('check-circle', 13)} Saldo conferido</h3><div class="stat-value ${account.reconciled_balance < 0 ? 'neg' : ''}">${fmt(account.reconciled_balance)}</div>
        <div class="stat-sub">só o que você já confirmou no banco</div></div>
      <div class="card"><h3>${icon('landmark', 13)} Saldo real no banco</h3>
        <input id="recBank" inputmode="decimal" placeholder="0,00" value="${esc(state.reconcile.bank)}"
          style="width:100%;background:var(--bg-soft);border:1px solid var(--border);color:var(--text);border-radius:10px;padding:9px 12px;font-size:18px;font-weight:700">
        <div class="stat-sub">digite o saldo que aparece no app do banco</div></div>
      <div class="card"><h3>Diferença</h3>
        <div class="stat-value ${diff === null ? '' : diff === 0 ? 'pos' : 'neg'}" id="recDiff">${diff === null ? '—' : fmt(diff)}</div>
        ${diff !== null && diff !== 0 ? `<button class="btn subtle" id="recAdjust" style="margin-top:8px;width:100%">${icon('check', 14)} Lançar ajuste de ${fmt(Math.abs(diff))}</button>` : `<div class="stat-sub">${diff === 0 ? 'os saldos batem exatamente' : 'preencha o saldo do banco'}</div>`}
      </div>
    </div>

    <div class="actions-bar mt">
      <button class="btn green" id="recAll" ${items.length ? '' : 'disabled'}>${icon('check', 14)} Conferir selecionados</button>
      <button class="btn subtle" id="recSelAll" ${items.length ? '' : 'disabled'}>Marcar todos</button>
      <div class="spacer"></div>
      <span class="muted">${items.length} lançamento(s) aguardando conferência</span>
    </div>

    <div class="card" style="padding:6px 14px">
      <div class="table-wrap"><table class="table">
        <thead><tr><th></th><th>Data</th><th>Descrição</th><th class="num">Efeito na conta</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>

    <p class="muted mt" style="font-size:13px"><strong>Rotina diária sugerida:</strong> abra o app do banco, compare os lançamentos,
      marque aqui os que conferem e clique em <strong>Conferir</strong>. Se no fim a diferença não for zero,
      falta lançar algo — ou use o ajuste. Editar um lançamento desfaz a conferência dele.</p>`;

  $('#recAccount').addEventListener('change', (e) => {
    state.reconcile.account_id = Number(e.target.value);
    state.reconcile.bank = '';
    render();
  });
  $('#recImport').addEventListener('click', importModal);
  $('#recBank').addEventListener('change', (e) => {
    state.reconcile.bank = e.target.value;
    render();
  });
  $('#recSelAll')?.addEventListener('click', () => {
    const boxes = [...el.querySelectorAll('[data-check]')];
    const allOn = boxes.every((b) => b.checked);
    boxes.forEach((b) => { b.checked = !allOn; });
  });
  $('#recAll')?.addEventListener('click', async () => {
    const ids = [...el.querySelectorAll('[data-check]:checked')].map((b) => Number(b.dataset.check));
    if (!ids.length) { toast('Marque os lançamentos que você conferiu no banco.', true); return; }
    const r = await tryApi(() => api('/api/reconcile/bulk', 'POST', { ids, value: 1, account_id: state.reconcile.account_id }));
    if (r) { toast(`${r.changed} lançamento(s) conferido(s).`); render(); }
  });
  $('#recAdjust')?.addEventListener('click', () => {
    confirmModal('Lançar ajuste de conciliação',
      `Será criado um lançamento de ${fmt(Math.abs(diff))} (${diff > 0 ? 'receita' : 'despesa'}) na categoria "Ajuste de conciliação" para o saldo conferido bater com o banco. Use quando a diferença vier de lançamentos antigos que você não quer caçar um por um.`,
      async () => {
        const r = await tryApi(() => api('/api/reconcile/adjust', 'POST', {
          account_id: state.reconcile.account_id, bank_balance: bankCents,
        }), 'Ajuste lançado. Saldos igualados.');
        if (r) render();
      });
  });
}

// ---------------------------------------------------------------------------
// VIEW: Contas
// ---------------------------------------------------------------------------

const ACC_TYPES = { corrente: 'Conta corrente', poupanca: 'Poupança', carteira: 'Carteira', cartao: 'Cartão de crédito', investimento: 'Investimentos' };
const ACC_ICONS = { corrente: 'landmark', poupanca: 'coins', carteira: 'wallet', cartao: 'credit-card', investimento: 'trending-up' };

function accountModal(acc = null) {
  const isCard = acc && acc.type === 'cartao';
  const backdrop = openModal(acc ? 'Editar conta' : 'Nova conta', `
    ${inputFld('Nome da conta', 'name', acc ? acc.name : '', 'required maxlength="60" placeholder="Ex.: Nubank"')}
    ${selectFld('Tipo', 'type', Object.entries(ACC_TYPES).map(([v, l]) => ({ value: v, label: l })), acc ? acc.type : 'corrente')}
    <div class="field-row">
      ${moneyFld('Saldo inicial (R$)', 'initial_balance', acc ? acc.initial_balance : 0)}
      ${fld('Cor', `<input type="color" name="color" value="${acc ? acc.color : '#6366f1'}" style="height:40px;padding:3px">`)}
    </div>
    <div id="cardFields" style="display:${isCard ? 'block' : 'none'}">
      <div class="field-row">
        ${fld('Dia de fechamento da fatura', `<input type="number" name="closing_day" min="1" max="31" value="${acc && acc.closing_day ? acc.closing_day : ''}" placeholder="ex.: 28">`)}
        ${fld('Dia de vencimento', `<input type="number" name="due_day" min="1" max="31" value="${acc && acc.due_day ? acc.due_day : ''}" placeholder="ex.: 7">`)}
      </div>
      <div class="hint" style="margin:-6px 0 12px">Preencha para o app calcular a fatura do mês e avisar do vencimento.</div>
    </div>
    ${acc ? fld('Situação', `<select name="archived"><option value="0" ${!acc.archived ? 'selected' : ''}>Ativa</option><option value="1" ${acc.archived ? 'selected' : ''}>Arquivada</option></select>`) : ''}
  `, {
    onSubmit: async (form) => {
      const initial = parseMoney(form.initial_balance.value);
      if (initial === null) { toast('Saldo inicial inválido.', true); return; }
      const body = {
        name: form.name.value, type: form.type.value, initial_balance: initial,
        color: form.color.value, archived: acc ? form.archived.value === '1' : false,
        closing_day: form.closing_day.value ? Number(form.closing_day.value) : null,
        due_day: form.due_day.value ? Number(form.due_day.value) : null,
      };
      const r = await tryApi(
        () => acc ? api(`/api/accounts/${acc.id}`, 'PUT', body) : api('/api/accounts', 'POST', body),
        'Conta salva.');
      if (r) { closeModal(); await refreshLookups(); render(); }
    },
  });
  // campos de fatura só aparecem para cartão de crédito
  const form = backdrop.querySelector('#modalForm');
  form.type.addEventListener('change', () => {
    form.querySelector('#cardFields').style.display = form.type.value === 'cartao' ? 'block' : 'none';
  });
}

async function renderAccounts(el) {
  await refreshLookups();
  const invoices = await api(`/api/cards/invoices?month=${state.currentMonth}`).catch(() => []);
  const invoiceOf = (id) => invoices.find((i) => i.account_id === id);
  const total = state.accounts.filter((a) => !a.archived).reduce((s, a) => s + a.balance, 0);

  const cards = state.accounts.map((a) => {
    const inv = a.type === 'cartao' ? invoiceOf(a.id) : null;
    const invoiceHtml = inv ? `
      <div style="border-top:1px solid var(--border);margin-top:12px;padding-top:10px">
        <div class="stat-sub" style="margin:0 0 4px">Fatura do mês: <strong class="${inv.total > 0 ? 'neg' : ''}">${fmt(inv.total)}</strong></div>
        <div class="stat-sub" style="margin:0 0 10px">fecha ${fmtDate(inv.closing_date)}${inv.due_date ? ` · vence ${fmtDate(inv.due_date)}` : ''}</div>
        ${inv.total > 0 ? `<button class="btn subtle" style="width:100%" data-payinv="${a.id}">${icon('credit-card', 14)} Pagar fatura</button>` : ''}
      </div>`
      : (a.type === 'cartao' ? `<div class="stat-sub" style="margin-top:10px">Edite e informe o dia de fechamento para calcular a fatura.</div>` : '');
    return `
    <div class="card acc-card">
      <div class="stripe" style="background:${esc(a.color)}"></div>
      <div class="card-tools">
        <button class="btn-icon" data-edit="${a.id}" title="Editar">${icon('edit', 14)}</button>
        <button class="btn-icon danger" data-del="${a.id}" title="Excluir">${icon('trash', 14)}</button>
      </div>
      <div class="acc-type">${icon(ACC_ICONS[a.type] || 'landmark', 13)} ${ACC_TYPES[a.type] || a.type}${a.archived ? '<span class="archived-tag">arquivada</span>' : ''}</div>
      <div class="acc-name">${esc(a.name)}</div>
      <div class="stat-value ${a.balance < 0 ? 'neg' : ''}" style="font-size:21px">${fmt(a.balance)}</div>
      <div class="stat-sub">saldo inicial ${fmt(a.initial_balance)}</div>
      ${invoiceHtml}
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="actions-bar">
      <button class="btn" id="addAcc">+ Nova conta</button>
      <div class="spacer"></div>
      <span class="muted">Saldo total (contas ativas): <strong class="${total < 0 ? 'neg' : 'pos'}">${fmt(total)}</strong></span>
    </div>
    <div class="grid acc-grid">${cards}</div>
    <p class="muted mt" style="font-size:13px">Dica: para cartão de crédito, lance as compras como despesas na conta do cartão (use o parcelamento para compras em N×). O pagamento da fatura é uma <strong>transferência</strong> — o botão "Pagar fatura" já prepara tudo.</p>`;

  $('#addAcc').addEventListener('click', () => accountModal());
  el.querySelectorAll('[data-payinv]').forEach((b) => b.addEventListener('click', () => {
    const card = state.accounts.find((a) => a.id === Number(b.dataset.payinv));
    const inv = invoiceOf(card.id);
    const source = state.accounts.find((a) => !a.archived && a.type !== 'cartao');
    transactionModal({
      id: null, type: 'transferencia', description: `Pagamento fatura ${card.name}`,
      amount: inv.total, date: state.today, account_id: source ? source.id : card.id,
      to_account_id: card.id, category_id: null, status: 'pago', notes: null,
    }, 'transferencia');
  }));
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () =>
    accountModal(state.accounts.find((a) => a.id === Number(b.dataset.edit)))));
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    const acc = state.accounts.find((a) => a.id === Number(b.dataset.del));
    confirmModal('Excluir conta', `Excluir a conta "${acc.name}"?`, async () => {
      await tryApi(() => api(`/api/accounts/${acc.id}`, 'DELETE'), 'Conta excluída.');
      await refreshLookups(); render();
    });
  }));
}

// ---------------------------------------------------------------------------
// VIEW: Categorias
// ---------------------------------------------------------------------------

function categoryModal(cat = null, kind = 'despesa') {
  openModal(cat ? 'Editar categoria' : 'Nova categoria', `
    ${!cat ? selectFld('Tipo', 'kind', [{ value: 'despesa', label: 'Despesa' }, { value: 'receita', label: 'Receita' }], kind) : ''}
    ${inputFld('Nome', 'name', cat ? cat.name : '', 'required maxlength="60"')}
    <div class="field-row">
      ${inputFld('Ícone (emoji)', 'icon', cat ? cat.icon : '🏷️', 'maxlength="4"')}
      ${fld('Cor', `<input type="color" name="color" value="${cat ? cat.color : '#6366f1'}" style="height:40px;padding:3px">`)}
    </div>
    ${cat ? fld('Situação', `<select name="archived"><option value="0" ${!cat.archived ? 'selected' : ''}>Ativa</option><option value="1" ${cat.archived ? 'selected' : ''}>Arquivada</option></select>`) : ''}
  `, {
    onSubmit: async (form) => {
      const body = {
        name: form.name.value, icon: form.icon.value || '🏷️', color: form.color.value,
        kind: cat ? cat.kind : form.kind.value,
        archived: cat ? form.archived.value === '1' : false,
      };
      const r = await tryApi(
        () => cat ? api(`/api/categories/${cat.id}`, 'PUT', body) : api('/api/categories', 'POST', body),
        'Categoria salva.');
      if (r) { closeModal(); await refreshLookups(); render(); }
    },
  });
}

async function renderCategories(el) {
  await refreshLookups();
  const pill = (c) => `
    <div class="cat-pill">
      <span class="cat-avatar" style="background:${esc(c.color)}22">${esc(c.icon)}</span><span>${esc(c.name)}</span>
      ${c.archived ? '<span class="archived-tag">arquivada</span>' : ''}
      <span class="tools">
        <button data-edit="${c.id}" title="Editar">${icon('edit', 14)}</button>
        <button data-del="${c.id}" title="Excluir">${icon('trash', 14)}</button>
      </span>
    </div>`;
  const despesas = state.categories.filter((c) => c.kind === 'despesa');
  const receitas = state.categories.filter((c) => c.kind === 'receita');

  el.innerHTML = `
    <div class="actions-bar">
      <button class="btn red" id="addDesp">+ Categoria de despesa</button>
      <button class="btn green" id="addRec">+ Categoria de receita</button>
    </div>
    <div class="section-title">${icon('arrow-out', 15)} Despesas</div>
    <div class="cat-list">${despesas.map(pill).join('')}</div>
    <div class="section-title">${icon('arrow-in', 15)} Receitas</div>
    <div class="cat-list">${receitas.map(pill).join('')}</div>`;

  $('#addDesp').addEventListener('click', () => categoryModal(null, 'despesa'));
  $('#addRec').addEventListener('click', () => categoryModal(null, 'receita'));
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () =>
    categoryModal(state.categories.find((c) => c.id === Number(b.dataset.edit)))));
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    const cat = state.categories.find((c) => c.id === Number(b.dataset.del));
    confirmModal('Excluir categoria', `Excluir a categoria "${cat.name}"?`, async () => {
      await tryApi(() => api(`/api/categories/${cat.id}`, 'DELETE'), 'Categoria excluída.');
      await refreshLookups(); render();
    });
  }));
}

// ---------------------------------------------------------------------------
// VIEW: Orçamento
// ---------------------------------------------------------------------------

async function renderBudgets(el) {
  await refreshLookups();
  const budgets = await api(`/api/budgets?month=${state.month}`);
  const withBudget = new Set(budgets.map((b) => b.category_id));
  const available = state.categories.filter((c) => c.kind === 'despesa' && !c.archived && !withBudget.has(c.id));

  const totalBudget = budgets.reduce((s, b) => s + b.amount, 0);
  const totalSpent = budgets.reduce((s, b) => s + b.spent, 0);

  const rows = budgets.map((b) => `
    <div class="card" style="margin-bottom:12px;position:relative">
      <div class="card-tools">
        <button class="btn-icon" data-edit="${b.category_id}" data-amount="${b.amount}" title="Alterar valor">${icon('edit', 14)}</button>
        <button class="btn-icon danger" data-del="${b.id}" title="Remover orçamento">${icon('trash', 14)}</button>
      </div>
      ${progressRow(`<span class="cat-avatar" style="background:${esc(b.color)}22">${esc(b.icon)}</span><span class="name">${esc(b.name)}</span>`, b.spent, b.amount, b.color)}
      <div class="muted" style="font-size:13px">${b.spent > b.amount
        ? `Estourou ${fmt(b.spent - b.amount)} do limite`
        : `Restam ${fmt(b.amount - b.spent)} para gastar`}</div>
    </div>`).join('');

  el.innerHTML = `
    <div class="actions-bar">
      <button class="btn" id="addBudget" ${available.length ? '' : 'disabled'}>+ Definir orçamento</button>
      <div class="spacer"></div>
      ${budgets.length ? `<span class="muted">Total orçado <strong>${fmt(totalBudget)}</strong> · Gasto <strong class="${totalSpent > totalBudget ? 'neg' : ''}">${fmt(totalSpent)}</strong></span>` : ''}
    </div>
    ${budgets.length ? rows : `<div class="empty"><span class="big">${icon('target', 32)}</span>Defina limites mensais de gasto por categoria e acompanhe o progresso aqui.<br>O orçamento vale para todos os meses.</div>`}`;

  const budgetModal = (categoryId = null, amount = null) => {
    openModal(categoryId ? 'Alterar orçamento' : 'Definir orçamento', `
      ${categoryId
        ? `<input type="hidden" name="category_id" value="${categoryId}">`
        : selectFld('Categoria', 'category_id', available.map((c) => ({ value: c.id, label: `${c.icon} ${c.name}` })), '')}
      ${moneyFld('Limite mensal (R$)', 'amount', amount)}
    `, {
      onSubmit: async (form) => {
        const val = parseMoney(form.amount.value);
        if (val === null || val <= 0) { toast('Valor inválido.', true); return; }
        const r = await tryApi(() => api('/api/budgets', 'POST', { category_id: Number(form.category_id.value), amount: val }), 'Orçamento salvo.');
        if (r) { closeModal(); render(); }
      },
    });
  };

  $('#addBudget')?.addEventListener('click', () => budgetModal());
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () =>
    budgetModal(Number(b.dataset.edit), Number(b.dataset.amount))));
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    await tryApi(() => api(`/api/budgets/${b.dataset.del}`, 'DELETE'), 'Orçamento removido.');
    render();
  }));
}

// ---------------------------------------------------------------------------
// VIEW: Recorrências
// ---------------------------------------------------------------------------

function recurringModal(rec = null) {
  const kind = rec ? rec.type : 'despesa';
  openModal(rec ? 'Editar recorrência' : 'Nova recorrência', `
    ${selectFld('Tipo', 'type', [{ value: 'despesa', label: 'Despesa fixa (ex.: aluguel)' }, { value: 'receita', label: 'Receita fixa (ex.: salário)' }], kind)}
    ${inputFld('Descrição', 'description', rec ? rec.description : '', 'required maxlength="200" placeholder="Ex.: Aluguel"')}
    <div class="field-row">
      ${moneyFld('Valor (R$)', 'amount', rec ? rec.amount : null)}
      ${fld('Dia do mês', `<input type="number" name="day" min="1" max="31" value="${rec ? rec.day : 5}" required>`)}
    </div>
    <div class="field-row">
      ${selectFld('Conta', 'account_id', accountOptions(), rec ? rec.account_id : '')}
      <div class="field"><label>Categoria</label><select name="category_id" id="recCat"></select></div>
    </div>
    ${rec ? selectFld('Situação', 'active', [{ value: '1', label: 'Ativa' }, { value: '0', label: 'Pausada' }], String(rec.active)) : ''}
  `, {
    onSubmit: async (form) => {
      const amount = parseMoney(form.amount.value);
      if (amount === null || amount <= 0) { toast('Valor inválido.', true); return; }
      const body = {
        description: form.description.value, amount, type: form.type.value,
        day: Number(form.day.value), account_id: Number(form.account_id.value),
        category_id: Number(form.category_id.value),
        active: rec ? form.active.value === '1' : true,
      };
      const r = await tryApi(
        () => rec ? api(`/api/recurring/${rec.id}`, 'PUT', body) : api('/api/recurring', 'POST', body),
        'Recorrência salva.');
      if (r) { closeModal(); render(); }
    },
  });
  const form = $('#modalForm');
  const fillCats = () => {
    const opts = categoryOptions(form.type.value);
    form.category_id.innerHTML = opts.map((o) => `<option value="${o.value}" ${rec && String(rec.category_id) === String(o.value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
  };
  form.type.addEventListener('change', fillCats);
  fillCats();
}

async function renderRecurring(el) {
  await refreshLookups();
  const items = await api('/api/recurring');
  const totalDesp = items.filter((r) => r.active && r.type === 'despesa').reduce((s, r) => s + r.amount, 0);
  const totalRec = items.filter((r) => r.active && r.type === 'receita').reduce((s, r) => s + r.amount, 0);

  const rows = items.length ? items.map((r) => `
    <tr style="${r.active ? '' : 'opacity:.45'}">
      <td>dia ${r.day}</td>
      <td>${esc(r.description)}${r.active ? '' : ' <span class="archived-tag">pausada</span>'}</td>
      <td><span class="chip"><span class="cat-avatar" style="background:var(--bg-soft)">${esc(r.category_icon || '')}</span>${esc(r.category_name || '')}</span></td>
      <td class="muted">${esc(r.account_name)}</td>
      <td class="num ${r.type === 'receita' ? 'pos' : 'neg'}">${r.type === 'receita' ? '+' : '−'}${fmt(r.amount)}</td>
      <td class="actions">
        <button class="btn-icon" data-edit="${r.id}" title="Editar">${icon('edit', 14)}</button>
        <button class="btn-icon danger" data-del="${r.id}" title="Excluir">${icon('trash', 14)}</button>
      </td>
    </tr>`).join('') : `<tr><td colspan="6"><div class="empty"><span class="big">${icon('repeat', 32)}</span>Cadastre contas fixas (aluguel, assinaturas, salário…).<br>Elas entram automaticamente todo mês como lançamentos pendentes.</div></td></tr>`;

  el.innerHTML = `
    <div class="actions-bar">
      <button class="btn" id="addRec">+ Nova recorrência</button>
      <button class="btn subtle" id="genNow" title="Cria os lançamentos pendentes deste mês">Gerar lançamentos do mês</button>
      <div class="spacer"></div>
      <span class="muted">Fixas ativas: <strong class="pos">+${fmt(totalRec)}</strong> · <strong class="neg">−${fmt(totalDesp)}</strong> por mês</span>
    </div>
    <div class="card" style="padding:6px 14px">
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Dia</th><th>Descrição</th><th>Categoria</th><th>Conta</th><th class="num">Valor</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>
    <p class="muted mt" style="font-size:13px">Os lançamentos do mês atual são gerados automaticamente ao abrir a Visão geral, com situação <strong>pendente</strong>. Marque como pago quando efetivar.</p>`;

  $('#addRec').addEventListener('click', () => recurringModal());
  $('#genNow').addEventListener('click', async () => {
    const r = await tryApi(() => api('/api/recurring/generate', 'POST', { month: state.month }));
    if (r) toast(r.created ? `${r.created} lançamento(s) criado(s) em ${monthLabel(r.month)}.` : 'Este mês já está em dia — nada a gerar.');
  });
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () =>
    recurringModal(items.find((r) => r.id === Number(b.dataset.edit)))));
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    const rec = items.find((r) => r.id === Number(b.dataset.del));
    confirmModal('Excluir recorrência', `Excluir "${rec.description}"? Os lançamentos já criados serão mantidos.`, async () => {
      await tryApi(() => api(`/api/recurring/${rec.id}`, 'DELETE'), 'Recorrência excluída.');
      render();
    });
  }));
}

// ---------------------------------------------------------------------------
// VIEW: Metas
// ---------------------------------------------------------------------------

function goalModal(goal = null) {
  openModal(goal ? 'Editar meta' : 'Nova meta', `
    ${inputFld('Nome da meta', 'name', goal ? goal.name : '', 'required maxlength="100" placeholder="Ex.: Reserva de emergência"')}
    <div class="field-row">
      ${moneyFld('Valor da meta (R$)', 'target', goal ? goal.target : null)}
      ${moneyFld('Já guardado (R$)', 'saved', goal ? goal.saved : 0)}
    </div>
    <div class="field-row">
      ${fld('Prazo (opcional)', `<input type="date" name="deadline" value="${goal && goal.deadline ? goal.deadline : ''}">`)}
      ${fld('Cor', `<input type="color" name="color" value="${goal ? goal.color : '#10b981'}" style="height:40px;padding:3px">`)}
    </div>
  `, {
    onSubmit: async (form) => {
      const target = parseMoney(form.target.value);
      const saved = parseMoney(form.saved.value);
      if (target === null || target <= 0) { toast('Valor da meta inválido.', true); return; }
      const body = {
        name: form.name.value, target, saved: saved ?? 0,
        deadline: form.deadline.value || null, color: form.color.value,
      };
      const r = await tryApi(
        () => goal ? api(`/api/goals/${goal.id}`, 'PUT', body) : api('/api/goals', 'POST', body),
        'Meta salva.');
      if (r) { closeModal(); render(); }
    },
  });
}

async function renderGoals(el) {
  const goals = await api('/api/goals');
  const cards = goals.map((g) => {
    const pct = Math.min(100, Math.round((g.saved / g.target) * 100));
    const done = g.saved >= g.target;
    return `
      <div class="card acc-card">
        <div class="stripe" style="background:${esc(g.color)}"></div>
        <div class="card-tools">
          <button class="btn-icon" data-edit="${g.id}" title="Editar">${icon('edit', 14)}</button>
          <button class="btn-icon danger" data-del="${g.id}" title="Excluir">${icon('trash', 14)}</button>
        </div>
        <div class="acc-name">${icon(done ? 'trophy' : 'flag', 14)} ${esc(g.name)}</div>
        ${progressRow('<span class="name">progresso</span>', g.saved, g.target, g.color)}
        <div class="stat-sub" style="margin-bottom:12px">
          ${done ? 'Meta concluída. Parabéns!' : `${pct}% — faltam ${fmt(g.target - g.saved)}`}
          ${g.deadline ? ` · prazo ${fmtDateFull(g.deadline)}` : ''}
        </div>
        ${done ? '' : `<div style="display:flex;gap:8px">
          <button class="btn green" style="flex:1" data-add="${g.id}">+ Guardar</button>
          <button class="btn subtle" data-sub="${g.id}">− Retirar</button>
        </div>`}
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="actions-bar"><button class="btn" id="addGoal">+ Nova meta</button></div>
    ${goals.length ? `<div class="grid acc-grid">${cards}</div>`
      : `<div class="empty"><span class="big">${icon('trophy', 32)}</span>Crie metas de economia — reserva de emergência, viagem, entrada do apartamento…<br>e registre cada valor guardado.</div>`}`;

  $('#addGoal').addEventListener('click', () => goalModal());
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () =>
    goalModal(goals.find((g) => g.id === Number(b.dataset.edit)))));
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    const g = goals.find((x) => x.id === Number(b.dataset.del));
    confirmModal('Excluir meta', `Excluir a meta "${g.name}"?`, async () => {
      await tryApi(() => api(`/api/goals/${g.id}`, 'DELETE'), 'Meta excluída.');
      render();
    });
  }));
  const contribute = (id, sign) => {
    const goal = goals.find((g) => g.id === id);
    openModal(sign > 0 ? 'Guardar dinheiro' : 'Retirar dinheiro', moneyFld('Valor (R$)', 'amount'), {
      submitLabel: sign > 0 ? 'Guardar' : 'Retirar',
      onSubmit: async (form) => {
        const v = parseMoney(form.amount.value);
        if (v === null || v <= 0) { toast('Valor inválido.', true); return; }
        const r = await tryApi(() => api(`/api/goals/${id}/add`, 'POST', { amount: v * sign }));
        if (r) {
          closeModal();
          if (sign > 0 && goal && r.saved >= goal.target) {
            confetti();
            toast(`Meta "${goal.name}" concluída! Parabéns!`);
          } else {
            toast(sign > 0 ? 'Valor guardado.' : 'Valor retirado.');
          }
          render();
        }
      },
    });
  };
  el.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => contribute(Number(b.dataset.add), 1)));
  el.querySelectorAll('[data-sub]').forEach((b) => b.addEventListener('click', () => contribute(Number(b.dataset.sub), -1)));
}

// ---------------------------------------------------------------------------
// VIEW: Relatórios
// ---------------------------------------------------------------------------

const reportRange = { from: null, to: null, flowDays: 60, year: null };

async function renderReports(el) {
  if (!reportRange.from) {
    reportRange.from = `${state.currentMonth}-01`;
    reportRange.to = state.today;
  }
  if (!reportRange.year) reportRange.year = state.today.slice(0, 4);
  const [summary, monthly, networth, compare, cashflow, annual] = await Promise.all([
    api(`/api/reports/summary?from=${reportRange.from}&to=${reportRange.to}`),
    api('/api/reports/monthly?months=12'),
    api('/api/reports/networth?months=12'),
    api(`/api/reports/compare?month=${state.currentMonth}`),
    api(`/api/reports/cashflow?days=${reportRange.flowDays}`),
    api(`/api/reports/annual?year=${reportRange.year}`),
  ]);

  const catTable = (rows, total, cls) => rows.length ? `
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Categoria</th><th class="num">Lançamentos</th><th class="num">Total</th><th class="num">%</th></tr></thead>
      <tbody>${rows.map((r) => `
        <tr>
          <td><span class="chip"><span class="cat-avatar" style="background:${esc(r.color)}22">${esc(r.icon)}</span>${esc(r.name)}</span></td>
          <td class="num muted">${r.count}</td>
          <td class="num ${cls}">${fmt(r.total)}</td>
          <td class="num muted">${total ? Math.round((r.total / total) * 100) : 0}%</td>
        </tr>`).join('')}
      </tbody>
    </table></div>` : '<div class="muted" style="padding:14px 0">Nenhum lançamento no período.</div>';

  const compareRows = compare.despesas.map((r) => {
    const delta = r.cur - r.prev;
    const arrow = delta > 0 ? `<span class="delta-up">▲ ${fmt(delta)}</span>`
      : delta < 0 ? `<span class="delta-down">▼ ${fmt(-delta)}</span>`
      : '<span class="muted">=</span>';
    return `<tr>
      <td><span class="chip"><span class="cat-avatar" style="background:${esc(r.color)}22">${esc(r.icon)}</span>${esc(r.name)}</span></td>
      <td class="num muted">${fmt(r.prev)}</td>
      <td class="num">${fmt(r.cur)}</td>
      <td class="num">${arrow}</td>
    </tr>`;
  }).join('');

  const saldoPeriodo = summary.totalReceitas - summary.totalDespesas;

  // matriz anual: categoria × 12 meses
  const MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const cell = (v, cls = '') => v ? `<td class="num ${cls}" title="${fmt(v)}">${fmtShort(v)}</td>` : '<td class="num muted">–</td>';
  const annualRow = (c, cls) => `<tr>
    <td style="white-space:nowrap"><span class="cat-avatar" style="background:${esc(c.color)}22;width:18px;height:18px;font-size:10px">${esc(c.icon)}</span> ${esc(c.name)}</td>
    ${c.months.map((v) => cell(v)).join('')}
    ${cell(c.total, cls)}
  </tr>`;
  const annualTotalRow = (label, t, cls) => `<tr style="font-weight:700;border-top:2px solid var(--border)">
    <td>${label}</td>${t.months.map((v) => cell(v, cls)).join('')}${cell(t.total, cls)}
  </tr>`;
  const resultadoMeses = annual.totalReceitas.months.map((v, i) => v - annual.totalDespesas.months[i]);
  const annualHtml = (annual.receitas.length || annual.despesas.length) ? `
    <div class="table-wrap"><table class="table" style="min-width:900px">
      <thead><tr><th>Categoria</th>${MES.map((m) => `<th class="num">${m}</th>`).join('')}<th class="num">Total</th></tr></thead>
      <tbody>
        ${annual.receitas.map((c) => annualRow(c, 'pos')).join('')}
        ${annual.receitas.length ? annualTotalRow('Total de receitas', annual.totalReceitas, 'pos') : ''}
        ${annual.despesas.map((c) => annualRow(c, 'neg')).join('')}
        ${annual.despesas.length ? annualTotalRow('Total de despesas', annual.totalDespesas, 'neg') : ''}
        <tr style="font-weight:700;border-top:2px solid var(--border)">
          <td>Resultado</td>
          ${resultadoMeses.map((v) => `<td class="num ${v > 0 ? 'pos' : v < 0 ? 'neg' : 'muted'}" title="${fmt(v)}">${v ? fmtShort(v) : '–'}</td>`).join('')}
          ${(() => { const t = annual.totalReceitas.total - annual.totalDespesas.total; return `<td class="num ${t >= 0 ? 'pos' : 'neg'}" title="${fmt(t)}">${fmtShort(t)}</td>`; })()}
        </tr>
      </tbody>
    </table></div>
    <p class="muted" style="font-size:12px;margin-top:8px">Valores em reais, sem centavos — passe o mouse para ver o valor exato.</p>`
    : '<div class="muted" style="padding:14px 0">Nenhum lançamento neste ano ainda.</div>';

  el.innerHTML = `
    <div class="filters" style="align-items:center">
      <label class="muted">De</label><input type="date" id="repFrom" value="${reportRange.from}">
      <label class="muted">até</label><input type="date" id="repTo" value="${reportRange.to}">
      <button class="btn subtle" id="repApply">Aplicar</button>
      <button class="btn-ghost small" data-range="month">este mês</button>
      <button class="btn-ghost small" data-range="3m">últimos 3 meses</button>
      <button class="btn-ghost small" data-range="year">este ano</button>
      <div class="spacer"></div>
      <button class="btn subtle" id="expCsv">${icon('download', 14)} Exportar CSV</button>
      <button class="btn subtle" id="expBackup">${icon('file-text', 14)} Backup completo</button>
      <button class="btn subtle" id="restoreBtn" title="Substitui todos os dados pelos de um arquivo de backup">${icon('restore', 14)} Restaurar backup</button>
      <input type="file" id="restoreFile" accept=".json" style="display:none">
    </div>

    <div class="grid cards-4">
      <div class="card"><h3>Receitas no período</h3><div class="stat-value pos" data-count="${summary.totalReceitas}">${fmt(summary.totalReceitas)}</div></div>
      <div class="card"><h3>Despesas no período</h3><div class="stat-value neg" data-count="${summary.totalDespesas}">${fmt(summary.totalDespesas)}</div></div>
      <div class="card"><h3>Saldo do período</h3><div class="stat-value ${saldoPeriodo >= 0 ? 'pos' : 'neg'}" data-count="${saldoPeriodo}" data-signed="1">${saldoPeriodo >= 0 ? '+' : ''}${fmt(saldoPeriodo)}</div></div>
      <div class="card"><h3>Taxa de poupança</h3><div class="stat-value">${summary.totalReceitas > 0 ? Math.round((saldoPeriodo / summary.totalReceitas) * 100) : 0}%</div>
        <div class="stat-sub">do que entrou, quanto sobrou</div></div>
    </div>

    <div class="card mt"><h3>${icon('trending-up', 13)} Evolução do patrimônio — últimos 12 meses</h3>${lineChart(networth)}</div>

    <div class="card mt">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <h3 style="margin:0">${icon('chart-line', 13)} Fluxo de caixa projetado</h3>
        <div class="seg" style="max-width:220px">
          ${[30, 60, 90].map((n) => `<button type="button" data-flow="${n}" class="${reportRange.flowDays === n ? 'on-transferencia' : ''}">${n} dias</button>`).join('')}
        </div>
      </div>
      ${cashflowChart(cashflow)}${cashflowSummary(cashflow, reportRange.flowDays)}
    </div>

    <div class="card mt">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px">
        <h3 style="margin:0">${icon('calendar', 13)} Visão anual — categoria × mês</h3>
        <div class="month-nav">
          <button class="btn-icon" id="yearPrev">‹</button>
          <span style="font-weight:700;min-width:52px;text-align:center">${esc(annual.year)}</span>
          <button class="btn-icon" id="yearNext">›</button>
        </div>
      </div>
      ${annualHtml}
    </div>

    <div class="grid cols-2 mt">
      <div class="card"><h3>${icon('arrow-out', 13)} Despesas por categoria</h3>${catTable(summary.despesas, summary.totalDespesas, 'neg')}</div>
      <div class="card"><h3>${icon('arrow-in', 13)} Receitas por categoria</h3>${catTable(summary.receitas, summary.totalReceitas, 'pos')}</div>
    </div>

    <div class="grid cols-2 mt">
      <div class="card"><h3>Evolução mensal — últimos 12 meses</h3>${historyBars(monthly)}</div>
      <div class="card"><h3>${icon('scale', 13)} ${monthLabel(compare.month)} vs ${monthLabel(compare.prev)} (despesas)</h3>
        ${compareRows ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Categoria</th><th class="num">Anterior</th><th class="num">Atual</th><th class="num">Variação</th></tr></thead>
          <tbody>${compareRows}</tbody></table></div>` : '<div class="muted" style="padding:14px 0">Sem despesas para comparar ainda.</div>'}
      </div>
    </div>`;

  runCountUps(el);
  const apply = () => {
    reportRange.from = $('#repFrom').value || reportRange.from;
    reportRange.to = $('#repTo').value || reportRange.to;
    render();
  };
  $('#repApply').addEventListener('click', apply);
  el.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => {
    const today = state.today;
    const [y] = today.split('-');
    if (b.dataset.range === 'month') { reportRange.from = `${state.currentMonth}-01`; reportRange.to = today; }
    if (b.dataset.range === '3m') { reportRange.from = `${shiftMonth(state.currentMonth, -2)}-01`; reportRange.to = today; }
    if (b.dataset.range === 'year') { reportRange.from = `${y}-01-01`; reportRange.to = today; }
    render();
  }));
  $('#expCsv').addEventListener('click', () =>
    openExport('/api/export/transactions.csv', { from: reportRange.from, to: reportRange.to }));
  $('#expBackup').addEventListener('click', () => openExport('/api/export/backup.json'));

  el.querySelectorAll('[data-flow]').forEach((b) => b.addEventListener('click', () => {
    reportRange.flowDays = Number(b.dataset.flow);
    render();
  }));
  $('#yearPrev').addEventListener('click', () => { reportRange.year = String(Number(reportRange.year) - 1); render(); });
  $('#yearNext').addEventListener('click', () => { reportRange.year = String(Number(reportRange.year) + 1); render(); });

  // restauração de backup: escolhe o arquivo, mostra o que vai acontecer e confirma
  $('#restoreBtn').addEventListener('click', () => $('#restoreFile').click());
  $('#restoreFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    let backup;
    try { backup = JSON.parse(await file.text()); }
    catch { toast('Este arquivo não é um backup válido.', true); return; }
    if (!backup || !Array.isArray(backup.transactions)) { toast('Este arquivo não é um backup do Financeiro Pessoal.', true); return; }
    confirmModal('Restaurar backup',
      `Isto vai APAGAR todos os dados atuais e substituí-los pelos do arquivo (${backup.transactions.length} lançamentos, ${(backup.accounts || []).length} contas, backup de ${backup.exported_at ? backup.exported_at.slice(0, 10) : 'data desconhecida'}). Essa ação não pode ser desfeita. Continuar?`,
      async () => {
        const r = await tryApi(() => api('/api/restore', 'POST', { backup }));
        if (r) {
          toast(`Backup restaurado: ${r.transactions} lançamentos, ${r.accounts} contas.`);
          state.suggestions = null;
          await refreshLookups();
          render();
        }
      });
  });
}

// ---------------------------------------------------------------------------
// Paleta de comandos (Ctrl+K)
// ---------------------------------------------------------------------------

let paletteState = { open: false, sel: 0, items: [] };

function paletteActions() {
  return [
    { icon: 'arrow-out', label: 'Nova despesa', sub: 'tecla N', run: () => transactionModal(null, 'despesa') },
    { icon: 'arrow-in', label: 'Nova receita', run: () => transactionModal(null, 'receita') },
    { icon: 'swap', label: 'Nova transferência', run: () => transactionModal(null, 'transferencia') },
    { icon: 'download', label: 'Importar extrato do banco', sub: 'CSV ou OFX', run: importModal },
    { icon: 'check-circle', label: 'Ir para Conciliação', sub: 'conferir com o banco', run: () => setView('reconcile') },
    { icon: 'grid', label: 'Ir para Visão geral', run: () => setView('dashboard') },
    { icon: 'list', label: 'Ir para Lançamentos', run: () => setView('transactions') },
    { icon: 'calendar', label: 'Ir para Calendário', run: () => setView('calendar') },
    { icon: 'landmark', label: 'Ir para Contas', run: () => setView('accounts') },
    { icon: 'tag', label: 'Ir para Categorias', run: () => setView('categories') },
    { icon: 'target', label: 'Ir para Orçamento', run: () => setView('budgets') },
    { icon: 'repeat', label: 'Ir para Recorrências', run: () => setView('recurring') },
    { icon: 'flag', label: 'Ir para Metas', run: () => setView('goals') },
    { icon: 'bar-chart', label: 'Ir para Relatórios', run: () => setView('reports') },
    { icon: 'moon', label: 'Trocar estilo visual', sub: 'Aurora · Corporativo · Escuro', run: cycleSkin },
    { icon: 'smartphone', label: 'Acessar pelo celular', sub: 'endereço na rede de casa', run: phoneModal },
    { icon: 'lock', label: 'Proteger com PIN', run: pinModal },
    { icon: 'download', label: 'Exportar lançamentos (CSV)', run: () => openExport('/api/export/transactions.csv') },
    { icon: 'file-text', label: 'Baixar backup completo', run: () => openExport('/api/export/backup.json') },
  ];
}

function openPalette() {
  if (paletteState.open) { closePalette(); return; }
  paletteState = { open: true, sel: 0, items: [] };
  $('#paletteRoot').innerHTML = `
    <div class="palette-backdrop">
      <div class="palette">
        <input type="text" id="paletteInput" placeholder="Digite um comando ou busque um lançamento…" autocomplete="off">
        <div class="palette-list" id="paletteList"></div>
        <div class="palette-hint"><span><kbd>↑</kbd><kbd>↓</kbd> navegar</span><span><kbd>Enter</kbd> executar</span><span><kbd>Esc</kbd> fechar</span></div>
      </div>
    </div>`;
  const backdrop = $('#paletteRoot').firstElementChild;
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closePalette(); });
  const input = $('#paletteInput');
  input.focus();
  let debounce;
  input.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => updatePalette(input.value), 180); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); movePaletteSel(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); movePaletteSel(-1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const it = paletteState.items[paletteState.sel];
      if (it) { closePalette(); it.run(); }
    }
  });
  updatePalette('');
}
function closePalette() {
  paletteState.open = false;
  $('#paletteRoot').innerHTML = '';
}
function movePaletteSel(delta) {
  const n = paletteState.items.length;
  if (!n) return;
  paletteState.sel = (paletteState.sel + delta + n) % n;
  document.querySelectorAll('.palette-item').forEach((el, i) => {
    el.classList.toggle('sel', i === paletteState.sel);
    if (i === paletteState.sel) el.scrollIntoView({ block: 'nearest' });
  });
}
async function updatePalette(query) {
  const q = query.trim().toLowerCase();
  let items = paletteActions().filter((a) => !q || a.label.toLowerCase().includes(q));
  if (q.length >= 2) {
    const res = await api(`/api/transactions?q=${encodeURIComponent(q)}`).catch(() => ({ items: [] }));
    for (const t of res.items.slice(0, 8)) {
      items.push({
        icon: t.type === 'receita' ? 'arrow-in' : t.type === 'despesa' ? 'arrow-out' : 'swap',
        label: t.description,
        sub: `${fmtDateFull(t.date)} · ${t.type === 'despesa' ? '−' : t.type === 'receita' ? '+' : ''}${fmt(t.amount)}`,
        run: () => transactionModal(t),
      });
    }
  }
  paletteState.items = items;
  paletteState.sel = 0;
  const list = $('#paletteList');
  if (!list) return;
  list.innerHTML = items.length ? items.map((it, i) => `
    <button class="palette-item${i === 0 ? ' sel' : ''}" data-i="${i}">
      <span class="pi-ico">${icon(it.icon, 16)}</span>
      <span class="pi-main">${esc(it.label)}</span>
      ${it.sub ? `<span class="pi-sub">${esc(it.sub)}</span>` : ''}
    </button>`).join('')
    : '<div class="palette-empty">Nada encontrado.</div>';
  list.querySelectorAll('.palette-item').forEach((el) => el.addEventListener('click', () => {
    const it = paletteState.items[Number(el.dataset.i)];
    closePalette();
    it.run();
  }));
}

// ---------------------------------------------------------------------------
// Navegação e inicialização
// ---------------------------------------------------------------------------

const VIEWS = {
  dashboard: { title: 'Visão geral', month: true, render: renderDashboard },
  transactions: { title: 'Lançamentos', month: true, render: renderTransactions },
  reconcile: { title: 'Conciliação', month: false, render: renderReconcile },
  calendar: { title: 'Calendário', month: true, render: renderCalendar },
  accounts: { title: 'Contas', month: false, render: renderAccounts },
  categories: { title: 'Categorias', month: false, render: renderCategories },
  budgets: { title: 'Orçamento', month: true, render: renderBudgets },
  recurring: { title: 'Recorrências', month: false, render: renderRecurring },
  goals: { title: 'Metas', month: false, render: renderGoals },
  reports: { title: 'Relatórios', month: false, render: renderReports },
};

async function render() {
  const v = VIEWS[state.view];
  $('#viewTitle').textContent = v.title;
  $('#monthNav').style.visibility = v.month ? 'visible' : 'hidden';
  $('#monthLabel').textContent = monthLabel(state.month);
  const el = $('#content');
  el.classList.remove('view-enter');
  void el.offsetWidth; // reinicia a animação de entrada
  el.classList.add('view-enter');
  try {
    await v.render(el);
  } catch (e) {
    el.innerHTML = `<div class="empty"><span class="big">${icon('alert-triangle', 32)}</span>Erro ao carregar: ${esc(e.message)}<br><button class="btn mt" onclick="render()">Tentar de novo</button></div>`;
  }
}

function setView(view) {
  state.view = view;
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.bottomnav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  render();
}

// Folha "Mais" da navegação inferior do celular
function moreSheet() {
  const views = [
    ['accounts', 'landmark', 'Contas'], ['categories', 'tag', 'Categorias'], ['budgets', 'target', 'Orçamento'],
    ['recurring', 'repeat', 'Recorrências'], ['goals', 'flag', 'Metas'], ['reports', 'bar-chart', 'Relatórios'],
  ];
  const backdrop = openModal('Mais opções', `
    <div class="more-grid">
      ${views.map(([v, ico, lbl]) => `<button type="button" class="more-item" data-goto="${v}">${icon(ico, 16)}${lbl}</button>`).join('')}
      <button type="button" class="more-item" data-act="theme">${icon('moon', 16)}Tema</button>
      <button type="button" class="more-item" data-act="phone">${icon('smartphone', 16)}Celular</button>
      <button type="button" class="more-item" data-act="pin">${icon('lock', 16)}PIN</button>
    </div>
    <div class="accent-row" id="accentRowSheet" style="margin-top:16px;justify-content:flex-start"></div>
  `, { submitLabel: 'Fechar', onSubmit: async () => closeModal() });
  backdrop.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => { closeModal(); setView(b.dataset.goto); }));
  backdrop.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.act === 'theme') { cycleSkin(); return; }
    closeModal();
    if (b.dataset.act === 'phone') phoneModal();
    if (b.dataset.act === 'pin') pinModal();
  }));
  const row = backdrop.querySelector('#accentRowSheet');
  row.innerHTML = ACCENTS.map((c) => `<button type="button" class="accent-dot${currentAccent() === c ? ' on' : ''}" data-color="${c}" style="background:${c}"></button>`).join('');
  row.querySelectorAll('.accent-dot').forEach((d) => d.addEventListener('click', () => applyAccent(d.dataset.color)));
}

// Três estilos completos, troca em 1 clique. "Aurora" é a vitrine do produto;
// os outros dois atendem quem prefere visual de banco ou tela escura sóbria.
const SKINS = [
  { id: 'aurora', label: 'Aurora (vitrine)', icon: 'activity' },
  { id: 'banking', label: 'Claro corporativo', icon: 'sun' },
  { id: 'dark', label: 'Escuro sóbrio', icon: 'moon' },
];
function currentSkin() {
  const s = localStorage.getItem('fp-skin');
  return SKINS.some((k) => k.id === s) ? s : 'aurora';
}
function applySkin(id) {
  document.body.classList.remove('light', 'aurora');
  if (id === 'banking') document.body.classList.add('light');
  if (id === 'aurora') document.body.classList.add('aurora');
  localStorage.setItem('fp-skin', id);
  const skin = SKINS.find((k) => k.id === id);
  const btn = $('#themeToggle');
  if (btn) { btn.innerHTML = icon(skin.icon, 15); btn.title = `Estilo: ${skin.label} — clique para trocar`; }
  applyAccent(currentAccent());
}
function cycleSkin() {
  const i = SKINS.findIndex((k) => k.id === currentSkin());
  const next = SKINS[(i + 1) % SKINS.length];
  applySkin(next.id);
  toast(`Estilo visual: ${next.label}`);
}

const ACCENTS = ['#1f4e96', '#0e7490', '#15803d', '#6d28d9', '#b45309', '#b91c1c', '#0f766e', '#334155'];

// cor salva antes da mudança para o visual bancário migra para o azul-marinho
function currentAccent() {
  const saved = localStorage.getItem('fp-accent');
  return !saved || saved === '#6366f1' || !ACCENTS.includes(saved) ? ACCENTS[0] : saved;
}

// Cores derivadas calculadas aqui (e não com color-mix no CSS) para funcionar
// em qualquer navegador de celular, mesmo os mais antigos.
function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
function withAlpha(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function applyAccent(color) {
  const light = document.body.classList.contains('light');
  const aurora = document.body.classList.contains('aurora');
  const s = document.documentElement.style;
  s.setProperty('--accent', aurora ? mixHex(color, '#6366f1', 0.5) : color);
  // no Aurora o gradiente corre para o ciano; nos sóbrios, para um tom mais escuro
  s.setProperty('--accent-2', aurora ? '#22d3ee' : mixHex(color, '#0f2440', 0.35));
  s.setProperty('--accent-soft', withAlpha(color, light ? 0.10 : 0.14));
  s.setProperty('--accent-text', light ? mixHex(color, '#000000', 0.15) : mixHex(color, '#ffffff', aurora ? 0.45 : 0.25));
  s.setProperty('--accent-shadow', withAlpha(color, 0.35));
  s.setProperty('--accent-glow', withAlpha(color, light ? 0.09 : 0.13));
  localStorage.setItem('fp-accent', color);
  document.querySelectorAll('.accent-dot').forEach((d) => d.classList.toggle('on', d.dataset.color === color));
}
function buildAccentRow() {
  const row = $('#accentRow');
  row.innerHTML = ACCENTS.map((c) => `<button class="accent-dot" data-color="${c}" style="background:${c}" title="Usar esta cor"></button>`).join('');
  row.querySelectorAll('.accent-dot').forEach((d) => d.addEventListener('click', () => applyAccent(d.dataset.color)));
}

async function init() {
  // ícones da interface (SVG, sem emojis)
  const NAV_ICONS = {
    dashboard: 'grid', transactions: 'list', reconcile: 'check-circle', calendar: 'calendar',
    accounts: 'landmark', categories: 'tag', budgets: 'target', recurring: 'repeat',
    goals: 'flag', reports: 'bar-chart',
  };
  $('#brandMark').innerHTML = icon('wallet', 17);
  document.querySelectorAll('.nav-item').forEach((b) => {
    const el = b.querySelector('.ico');
    if (el && NAV_ICONS[b.dataset.view]) el.innerHTML = icon(NAV_ICONS[b.dataset.view], 17);
  });
  document.querySelectorAll('.bottomnav button[data-view]').forEach((b) => {
    b.querySelector('.bico').innerHTML = icon(NAV_ICONS[b.dataset.view], 20);
  });
  $('#moreBtn').querySelector('.bico').innerHTML = icon('more-horizontal', 20);
  $('#paletteHintIco').innerHTML = icon('search', 13);
  $('#prevMonth').innerHTML = icon('chevron-left', 15);
  $('#nextMonth').innerHTML = icon('chevron-right', 15);
  $('#fab').innerHTML = icon('plus', 22);
  $('#phoneBtn').innerHTML = icon('smartphone', 15);
  $('#pinBtn').innerHTML = icon('lock', 15);

  applySkin(currentSkin());
  $('#themeToggle').addEventListener('click', cycleSkin);
  buildAccentRow();
  applyAccent(currentAccent());
  $('#phoneBtn').addEventListener('click', phoneModal);
  $('#pinBtn').addEventListener('click', pinModal);

  // Se o dono ativou o PIN, pede antes de mostrar qualquer dado
  const auth = await fetch('/api/auth/status').then((r) => r.json()).catch(() => ({ required: false }));
  if (auth.required) {
    const check = await fetch('/api/meta', { headers: getToken() ? { 'x-auth-token': getToken() } : {} });
    if (check.status === 401) await loginOverlay();
  }

  const meta = await api('/api/meta');
  state.today = meta.today;
  state.month = meta.month;
  state.currentMonth = meta.month;

  $('#nav').addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-item');
    if (btn) setView(btn.dataset.view);
  });
  $('#prevMonth').addEventListener('click', () => { state.month = shiftMonth(state.month, -1); render(); });
  $('#nextMonth').addEventListener('click', () => { state.month = shiftMonth(state.month, 1); render(); });
  $('#todayBtn').addEventListener('click', () => { state.month = state.currentMonth; render(); });
  $('#fab').addEventListener('click', () => transactionModal(null, 'despesa'));
  $('#paletteHint').addEventListener('click', openPalette);
  $('#bottomNav').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (btn) setView(btn.dataset.view);
  });
  $('#moreBtn').addEventListener('click', moreSheet);

  // Atalhos de teclado globais
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
    if (paletteState.open && e.key === 'Escape') { closePalette(); return; }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (typing || modalIsOpen() || paletteState.open) return;
    if (e.key.toLowerCase() === 'n') { e.preventDefault(); transactionModal(null, 'despesa'); }
  });

  await refreshLookups();
  render();
}

init().catch((e) => {
  $('#content').innerHTML = `<div class="empty"><span class="big">${icon('alert-triangle', 32)}</span>Não foi possível conectar ao servidor.<br>${esc(e.message)}</div>`;
});
