import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

/** Painel de vidro com cabeçalho no padrão do produto. */
export function Panel({
  title, icon: Icon, right, children, className = '', delay = 0,
}: {
  title: string
  icon?: LucideIcon
  right?: ReactNode
  children: ReactNode
  className?: string
  delay?: number
}) {
  return (
    <section className={`glass rise p-5 ${className}`} style={{ animationDelay: `${delay}ms` }}>
      <header className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[11px] font-bold tracking-[0.08em] text-mute uppercase">
          {Icon && <Icon size={14} strokeWidth={2.2} className="text-brand-2" />}
          {title}
        </h2>
        {right}
      </header>
      {children}
    </section>
  )
}

/** Indicador da faixa superior. */
export function Kpi({
  label, value, sub, tone = 'neutral', hero = false, delay = 0,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'neutral' | 'good' | 'bad'
  hero?: boolean
  delay?: number
}) {
  const toneCls = tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-chart-red' : 'text-ink'
  return (
    <div className="glass rise px-4 py-3.5" style={{ animationDelay: `${delay}ms` }}>
      <div className="truncate text-[10px] font-bold tracking-[0.09em] text-mute uppercase">{label}</div>
      <div className={`mt-1 truncate text-lg font-bold tracking-tight tabular-nums ${hero ? 'grad-text' : toneCls}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-mute">{sub}</div>}
    </div>
  )
}

/** Tooltip compartilhado dos gráficos (vidro escuro, texto claro). */
export function ChartTip({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      {children}
    </div>
  )
}
