import { useEffect, useState } from 'react'
import {
  Activity, TrendingUp, PieChart as PieIcon, BarChart3, CalendarClock,
  ListOrdered, Target, CheckCircle2, AlertTriangle, Info, LineChart as LineIcon,
} from 'lucide-react'
import { api } from '../lib/api'
import type { Dashboard as Dash, Insights, Cashflow, NetworthPoint, TxList } from '../lib/api'
import { fmt, fmtDay, greeting } from '../lib/format'
import { Kpi, Panel } from '../components/ui'
import { CashflowArea, CategoryDonut, MonthlyBars, NetworthLine } from '../components/charts'

interface Data {
  d: Dash
  ins: Insights
  cf: Cashflow
  nw: NetworthPoint[]
  txs: TxList
}

const TONE_ICON = { good: CheckCircle2, warn: AlertTriangle, bad: AlertTriangle, info: Info } as const
const TONE_CLS = {
  good: 'border-l-good text-good',
  warn: 'border-l-warn text-warn',
  bad: 'border-l-crit text-crit',
  info: 'border-l-brand text-brand-2',
} as const

export function Dashboard({ month }: { month: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setError('')
    Promise.all([
      api<Dash>(`/api/dashboard?month=${month}`),
      api<Insights>(`/api/insights?month=${month}`),
      api<Cashflow>('/api/reports/cashflow?days=30'),
      api<NetworthPoint[]>('/api/reports/networth?months=12'),
      api<TxList>(`/api/transactions?month=${month}`),
    ])
      .then(([d, ins, cf, nw, txs]) => { if (alive) setData({ d, ins, cf, nw, txs }) })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Erro ao carregar.') })
    return () => { alive = false }
  }, [month])

  if (error) return <div className="glass mt-6 p-8 text-center text-sm text-crit">{error}</div>
  if (!data) return <DashboardSkeleton />

  const { d, ins, cf, nw, txs } = data
  const minPoint = cf.points.reduce((a, b) => (b.balance < a.balance ? b : a))

  return (
    <div className="space-y-4">
      <p className="text-sm text-mute">
        {greeting()} · {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
      </p>

      {/* faixa de indicadores */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi hero label="Saldo em contas" value={fmt(d.totalBalance)} sub={`${d.accounts.length} conta(s) ativa(s)`} />
        <Kpi label="Receitas do mês" value={fmt(d.receitas)} tone="good"
          sub={d.pendentes.receitas ? `${fmt(d.pendentes.receitas)} a receber` : 'tudo recebido'} delay={30} />
        <Kpi label="Despesas do mês" value={fmt(d.despesas)} tone="bad"
          sub={d.pendentes.despesas ? `${fmt(d.pendentes.despesas)} a pagar` : 'tudo pago'} delay={60} />
        <Kpi label="Resultado do mês" value={`${d.resultado >= 0 ? '+' : ''}${fmt(d.resultado)}`}
          tone={d.resultado >= 0 ? 'good' : 'bad'} sub="receitas − despesas" delay={90} />
        <Kpi label="A pagar no mês" value={fmt(d.pendentes.despesas)} sub={`${d.upcoming.length} pendência(s)`} delay={120} />
        <Kpi label="Projeção de despesas" value={ins.projection !== null ? fmt(ins.projection) : '—'}
          sub="ritmo atual até o fim do mês" delay={150} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Radar financeiro" icon={Activity} delay={60}>
          <ul className="space-y-2">
            {ins.insights.map((i, idx) => {
              const Icon = TONE_ICON[i.tone]
              return (
                <li key={idx}
                  className={`flex items-start gap-2.5 rounded-lg border border-line/50 border-l-2 bg-white/[0.03] px-3 py-2.5 text-[13px] leading-relaxed ${TONE_CLS[i.tone]}`}>
                  <Icon size={15} className="mt-0.5 shrink-0" />
                  <span className="text-ink-2">{i.text}</span>
                </li>
              )
            })}
          </ul>
        </Panel>

        <Panel title="Fluxo de caixa — 30 dias" icon={LineIcon} delay={90}
          right={
            cf.firstNegative
              ? <span className="flex items-center gap-1.5 rounded-full bg-crit/15 px-2.5 py-1 text-[11px] font-semibold text-crit">
                  <AlertTriangle size={12} /> negativo em {fmtDay(cf.firstNegative)}
                </span>
              : <span className="flex items-center gap-1.5 rounded-full bg-good/15 px-2.5 py-1 text-[11px] font-semibold text-good">
                  <CheckCircle2 size={12} /> mínimo {fmt(minPoint.balance)}
                </span>
          }>
          <CashflowArea cf={cf} />
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Últimos lançamentos" icon={ListOrdered} delay={120}>
          <TxTable txs={txs} />
        </Panel>
        <Panel title="Contas a pagar / receber" icon={CalendarClock} delay={150}>
          {d.upcoming.length ? (
            <ul className="divide-y divide-line/40">
              {d.upcoming.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2 text-[13px]">
                  <span className="w-12 shrink-0 tabular-nums text-mute">{fmtDay(t.date)}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {t.description}
                    {t.installment_total && (
                      <span className="ml-1.5 rounded bg-brand/15 px-1 py-px text-[10px] font-bold text-brand-2">
                        {t.installment_no}/{t.installment_total}
                      </span>
                    )}
                  </span>
                  <span className={`shrink-0 font-semibold tabular-nums ${t.type === 'receita' ? 'text-good' : 'text-chart-red'}`}>
                    {t.type === 'receita' ? '+' : '−'}{fmt(t.amount)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-sm text-mute">Nada pendente neste mês.</p>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Despesas por categoria" icon={PieIcon} delay={180}>
          <CategoryDonut items={d.byCategory} />
        </Panel>
        <Panel title="Receitas × despesas — 6 meses" icon={BarChart3} delay={210}>
          <MonthlyBars history={d.history} />
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Orçamento do mês" icon={Target} delay={240}>
          {d.budgets.length ? (
            <ul className="space-y-3.5">
              {d.budgets.slice(0, 6).map((b) => {
                const pct = Math.min(100, Math.round((b.spent / b.amount) * 100))
                const over = b.spent > b.amount
                return (
                  <li key={b.id}>
                    <div className="mb-1.5 flex items-center justify-between text-[12.5px]">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px]"
                          style={{ background: `${b.color}26` }}>{b.icon}</span>
                        <span className="truncate text-ink-2">{b.name}</span>
                      </span>
                      <span className={`tabular-nums ${over ? 'font-bold text-crit' : 'text-mute'}`}>
                        {fmt(b.spent)} / {fmt(b.amount)}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, background: over ? '#d03b3b' : b.color }} />
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="py-8 text-center text-sm text-mute">Nenhum orçamento definido — configure no app clássico.</p>
          )}
        </Panel>

        <Panel title="Evolução do patrimônio — 12 meses" icon={TrendingUp} delay={270}>
          <NetworthLine points={nw} />
        </Panel>
      </div>
    </div>
  )
}

function TxTable({ txs }: { txs: TxList }) {
  const items = txs.items.slice(0, 8)
  if (!items.length) return <p className="py-8 text-center text-sm text-mute">Nenhum lançamento neste mês ainda.</p>
  return (
    <table className="w-full text-[13px]">
      <tbody className="divide-y divide-line/40">
        {items.map((t) => (
          <tr key={t.id}>
            <td className="w-12 py-2 pr-2 tabular-nums text-mute">{fmtDay(t.date)}</td>
            <td className="max-w-0 truncate py-2 pr-2">
              {t.description}
              {t.installment_total && (
                <span className="ml-1.5 rounded bg-brand/15 px-1 py-px text-[10px] font-bold text-brand-2">
                  {t.installment_no}/{t.installment_total}
                </span>
              )}
            </td>
            <td className="hidden max-w-0 truncate py-2 pr-2 text-mute sm:table-cell">
              {t.type === 'transferencia' ? `${t.account_name} → ${t.to_account_name}` : t.category_name}
            </td>
            <td className={`py-2 text-right font-semibold tabular-nums ${
              t.type === 'receita' ? 'text-good' : t.type === 'despesa' ? 'text-chart-red' : 'text-ink-2'}`}>
              {t.type === 'receita' ? '+' : t.type === 'despesa' ? '−' : ''}{fmt(t.amount)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-4 w-64 animate-pulse rounded bg-white/5" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="glass h-20 animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="glass h-64 animate-pulse" />
        <div className="glass h-64 animate-pulse" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="glass h-64 animate-pulse" />
        <div className="glass h-64 animate-pulse" />
      </div>
    </div>
  )
}
