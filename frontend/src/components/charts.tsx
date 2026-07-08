import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, BarChart, Bar, PieChart, Pie, Cell, LineChart, Line, Legend,
} from 'recharts'
import type { Cashflow, CategoryTotal, NetworthPoint } from '../lib/api'
import { fmt, fmtAxis, fmtDay, fmtDateFull, monthShort } from '../lib/format'
import { ChartTip } from './ui'

/* Especificação (dataviz): grade horizontal hairline, eixos recessivos,
   linhas 2px, gaps de 2px entre fatias/barras, tooltip sempre presente. */

const GRID = '#202942'
const MUTE = '#7c869f'
const BLUE = '#3987e5'
const GREEN = '#0ca30c'
const RED = '#e66767'
const CRIT = '#d03b3b'

const axisTick = { fill: MUTE, fontSize: 11 }

/* ---------- Fluxo de caixa (área, 30 dias) ---------- */

export function CashflowArea({ cf }: { cf: Cashflow }) {
  const data = cf.points.map((p) => ({ ...p, label: fmtDay(p.date) }))
  const negative = cf.firstNegative !== null
  const stroke = negative ? CRIT : BLUE
  return (
    <div className="h-52">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="cashfill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.32} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="0" vertical={false} />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" minTickGap={40} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={fmtAxis} width={52} />
          {negative && <ReferenceLine y={0} stroke={MUTE} strokeDasharray="4 4" />}
          <Tooltip
            content={({ active, payload }) =>
              active && payload?.length ? (
                <ChartTip>
                  <div className="text-mute">{fmtDateFull((payload[0].payload as { date: string }).date)}</div>
                  <div className="mt-0.5 font-semibold tabular-nums">{fmt(payload[0].value as number)}</div>
                </ChartTip>
              ) : null
            }
          />
          <Area type="monotone" dataKey="balance" stroke={stroke} strokeWidth={2} fill="url(#cashfill)" dot={false} activeDot={{ r: 4 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ---------- Despesas por categoria (donut) ---------- */

export function CategoryDonut({ items }: { items: CategoryTotal[] }) {
  const total = items.reduce((s, i) => s + i.total, 0)
  if (!total) return <div className="py-10 text-center text-sm text-mute">Nenhuma despesa neste mês ainda.</div>
  const top = items.slice(0, 7)
  const rest = items.slice(7).reduce((s, i) => s + i.total, 0)
  const data = rest > 0 ? [...top, { id: -1, name: 'Outras', color: '#556079', icon: '', total: rest }] : top
  return (
    <div className="flex items-center gap-5">
      <div className="relative h-44 w-44 shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="total" nameKey="name" innerRadius="68%" outerRadius="100%" paddingAngle={2} strokeWidth={0}>
              {data.map((c) => <Cell key={c.id} fill={c.color} />)}
            </Pie>
            <Tooltip
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <ChartTip>
                    <div className="font-medium">{(payload[0].payload as { name: string }).name}</div>
                    <div className="mt-0.5 tabular-nums text-mute">
                      {fmt(payload[0].value as number)} · {Math.round(((payload[0].value as number) / total) * 100)}%
                    </div>
                  </ChartTip>
                ) : null
              }
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] font-bold tracking-widest text-mute uppercase">Total</span>
          <span className="text-sm font-bold tabular-nums">{fmt(total)}</span>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {data.map((c) => (
          <li key={c.id} className="flex items-center gap-2 text-[12.5px]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: c.color }} />
            <span className="min-w-0 flex-1 truncate text-ink-2">{c.name}</span>
            <span className="font-semibold tabular-nums">{fmt(c.total)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------- Receitas × despesas (barras, 6 meses) ---------- */

export function MonthlyBars({ history }: { history: { month: string; receitas: number; despesas: number }[] }) {
  const data = history.map((h) => ({ ...h, label: monthShort(h.month) }))
  return (
    <div className="h-52">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 4 }} barGap={2}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: GRID }} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={fmtAxis} width={52} />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <ChartTip>
                  <div className="mb-1 font-medium capitalize">{label}</div>
                  {payload.map((p) => (
                    <div key={p.dataKey as string} className="flex items-center gap-2 tabular-nums">
                      <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
                      <span className="text-mute">{p.dataKey === 'receitas' ? 'Receitas' : 'Despesas'}</span>
                      <span className="ml-auto pl-3 font-semibold">{fmt(p.value as number)}</span>
                    </div>
                  ))}
                </ChartTip>
              ) : null
            }
          />
          <Legend
            formatter={(v: string) => (
              <span className="text-xs text-ink-2">{v === 'receitas' ? 'Receitas' : 'Despesas'}</span>
            )}
            iconType="circle" iconSize={8}
          />
          <Bar dataKey="receitas" fill={GREEN} radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Bar dataKey="despesas" fill={RED} radius={[4, 4, 0, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ---------- Patrimônio (linha, 12 meses) ---------- */

export function NetworthLine({ points }: { points: NetworthPoint[] }) {
  const data = points.map((p) => ({ ...p, label: monthShort(p.month) }))
  return (
    <div className="h-40">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 4 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={fmtAxis} width={52} />
          <Tooltip
            content={({ active, payload }) =>
              active && payload?.length ? (
                <ChartTip>
                  <div className="capitalize text-mute">{(payload[0].payload as { label: string }).label}</div>
                  <div className="mt-0.5 font-semibold tabular-nums">{fmt(payload[0].value as number)}</div>
                </ChartTip>
              ) : null
            }
          />
          <Line type="monotone" dataKey="total" stroke={BLUE} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
