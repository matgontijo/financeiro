import { useState, type FormEvent } from 'react'
import { Lock } from 'lucide-react'
import { setToken } from '../lib/api'

/** Tela de PIN — mesma sessão do app clássico (token compartilhado). */
export function PinGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string }).error ?? 'PIN incorreto.')
      setToken((data as { token: string }).token)
      onUnlocked()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no login.')
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <form onSubmit={submit} className="glass rise w-full max-w-sm p-8 text-center">
        <div className="grad-bg mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl shadow-[0_0_24px_rgba(109,124,250,.45)]">
          <Lock size={22} strokeWidth={2} />
        </div>
        <h1 className="text-lg font-semibold tracking-tight">Financeiro Pessoal</h1>
        <p className="mt-1 mb-6 text-sm text-mute">Digite seu PIN para entrar</p>
        <input
          autoFocus
          type="password"
          inputMode="numeric"
          maxLength={8}
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="••••"
          className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-center text-2xl tracking-[0.5em] outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
        <div className="mt-2 min-h-5 text-sm text-crit">{error}</div>
        <button
          disabled={busy || !pin}
          className="grad-bg mt-2 w-full rounded-xl py-3 text-sm font-semibold text-white shadow-lg shadow-brand/25 transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
