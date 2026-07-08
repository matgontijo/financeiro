/* Formatação brasileira — valores em centavos em todo o sistema. */

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export const fmt = (cents: number) => BRL.format((cents || 0) / 100)

/** R$ compacto para eixos: 1.2k, 35k, 1,2M */
export function fmtAxis(cents: number): string {
  const v = cents / 100
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}M`
  if (abs >= 1_000) return `${(v / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
}

export const fmtDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
export const fmtDateFull = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

export function monthShort(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short' })
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function greeting(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}
