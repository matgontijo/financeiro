import type { ReactNode } from 'react'
import {
  LayoutGrid, List, CheckCircle2, CalendarDays, Landmark, Tag,
  Target, Repeat, Flag, BarChart3, ChevronLeft, ChevronRight, Wallet, ExternalLink,
} from 'lucide-react'
import { monthLabel } from '../lib/format'

/* O painel novo começa pela Visão geral; as demais seções continuam no app
   clássico (link direto) até serem migradas tela a tela. */
const SECTIONS = [
  { id: 'dashboard', label: 'Visão geral', icon: LayoutGrid, ready: true },
  { id: 'transactions', label: 'Lançamentos', icon: List, ready: false },
  { id: 'reconcile', label: 'Conciliação', icon: CheckCircle2, ready: false },
  { id: 'calendar', label: 'Calendário', icon: CalendarDays, ready: false },
  { id: 'accounts', label: 'Contas', icon: Landmark, ready: false },
  { id: 'categories', label: 'Categorias', icon: Tag, ready: false },
  { id: 'budgets', label: 'Orçamento', icon: Target, ready: false },
  { id: 'recurring', label: 'Recorrências', icon: Repeat, ready: false },
  { id: 'goals', label: 'Metas', icon: Flag, ready: false },
  { id: 'reports', label: 'Relatórios', icon: BarChart3, ready: false },
]

interface ShellProps {
  month: string
  onMonth: (delta: number) => void
  onToday: () => void
  children: ReactNode
}

export function Shell({ month, onMonth, onToday, children }: ShellProps) {
  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line/60 bg-page/40 p-4 backdrop-blur-xl md:flex">
        <div className="mb-6 flex items-center gap-3 px-2">
          <span className="grad-bg flex h-9 w-9 items-center justify-center rounded-xl shadow-[0_0_20px_rgba(109,124,250,.4)]">
            <Wallet size={17} strokeWidth={2.1} />
          </span>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight">Financeiro</div>
            <div className="grad-text text-[13px] font-bold">Pessoal</div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5">
          {SECTIONS.map(({ id, label, icon: Icon, ready }) =>
            ready ? (
              <span
                key={id}
                className="flex items-center gap-3 rounded-xl bg-gradient-to-r from-brand/25 to-brand-2/10 px-3 py-2 text-sm font-semibold text-ink ring-1 ring-brand/30"
              >
                <Icon size={16} strokeWidth={2} className="text-brand-2" /> {label}
              </span>
            ) : (
              <a
                key={id}
                href={`/#${id}`}
                title="Abre no app clássico (migração em andamento)"
                className="group flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-mute transition hover:bg-white/5 hover:text-ink-2"
              >
                <Icon size={16} strokeWidth={2} /> {label}
                <ExternalLink size={11} className="ml-auto opacity-0 transition group-hover:opacity-60" />
              </a>
            ),
          )}
        </nav>

        <div className="mt-4 border-t border-line/60 pt-3 text-[11px] leading-relaxed text-mute">
          Front novo — React + TypeScript.
          <br />Demais telas no <a className="underline hover:text-ink-2" href="/">app clássico</a>.
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5 pb-3">
          <h1 className="text-xl font-semibold tracking-tight">Visão geral</h1>
          <div className="glass flex items-center gap-1 rounded-xl px-1.5 py-1">
            <button onClick={() => onMonth(-1)} className="rounded-lg p-1.5 text-mute transition hover:bg-white/5 hover:text-ink" title="Mês anterior">
              <ChevronLeft size={16} />
            </button>
            <span className="min-w-32 text-center text-sm font-semibold capitalize">{monthLabel(month)}</span>
            <button onClick={() => onMonth(1)} className="rounded-lg p-1.5 text-mute transition hover:bg-white/5 hover:text-ink" title="Próximo mês">
              <ChevronRight size={16} />
            </button>
            <button onClick={onToday} className="rounded-lg px-2 py-1 text-xs font-medium text-mute transition hover:bg-white/5 hover:text-ink">
              hoje
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto px-6 pb-10">{children}</div>
      </main>
    </div>
  )
}
