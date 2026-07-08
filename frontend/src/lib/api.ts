/* Cliente da API do Financeiro Pessoal — mesma sessão/token do app clássico. */

const TOKEN_KEY = 'fp-token'

export const getToken = () => localStorage.getItem(TOKEN_KEY) ?? ''
export const setToken = (t: string | null) =>
  t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY)

export class AuthError extends Error {}

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (getToken()) headers['x-auth-token'] = getToken()
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401 && !path.startsWith('/api/auth/')) throw new AuthError()
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Erro ao comunicar com o servidor.')
  return data as T
}

/* ---------- tipos das respostas usadas pelo painel ---------- */

export interface Meta { today: string; month: string; lan: string[] }

export interface Account {
  id: number; name: string; type: string; color: string
  balance: number; archived: 0 | 1
}

export interface CategoryTotal {
  id: number; name: string; color: string; icon: string; total: number
}

export interface UpcomingTx {
  id: number; description: string; date: string; amount: number
  type: 'receita' | 'despesa'
  installment_no: number | null; installment_total: number | null
}

export interface BudgetRow {
  id: number; category_id: number; amount: number; spent: number
  name: string; color: string; icon: string
}

export interface Dashboard {
  month: string
  totalBalance: number; receitas: number; despesas: number; resultado: number
  pendentes: { despesas: number; receitas: number }
  accounts: Account[]
  byCategory: CategoryTotal[]
  history: { month: string; receitas: number; despesas: number }[]
  upcoming: UpcomingTx[]
  budgets: BudgetRow[]
  goals: { id: number; name: string; target: number; saved: number; color: string }[]
}

export interface Insights {
  month: string
  projection: number | null
  insights: { icon: string; tone: 'good' | 'warn' | 'bad' | 'info'; text: string }[]
}

export interface Cashflow {
  start: number
  firstNegative: string | null
  points: { date: string; balance: number }[]
}

export interface NetworthPoint { month: string; total: number }

export interface Tx {
  id: number; type: 'receita' | 'despesa' | 'transferencia'
  description: string; amount: number; date: string
  status: 'pago' | 'pendente'
  category_name: string | null; category_color: string | null; category_icon: string | null
  account_name: string; to_account_name: string | null
  installment_no: number | null; installment_total: number | null
}

export interface TxList { items: Tx[]; totals: { receitas: number; despesas: number; saldo: number } }
