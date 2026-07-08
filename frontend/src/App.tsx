import { useEffect, useState } from 'react'
import { api, AuthError } from './lib/api'
import type { Meta } from './lib/api'
import { shiftMonth } from './lib/format'
import { PinGate } from './components/PinGate'
import { Shell } from './components/Shell'
import { Dashboard } from './pages/Dashboard'

type Gate = 'checking' | 'locked' | 'open'

export default function App() {
  const [gate, setGate] = useState<Gate>('checking')
  const [month, setMonth] = useState('')
  const [currentMonth, setCurrentMonth] = useState('')

  async function boot() {
    try {
      const meta = await api<Meta>('/api/meta')
      setMonth(meta.month)
      setCurrentMonth(meta.month)
      setGate('open')
    } catch (e) {
      if (e instanceof AuthError) setGate('locked')
      else setGate('open') // erro de rede aparece dentro do painel
    }
  }

  useEffect(() => { void boot() }, [])

  if (gate === 'checking') {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="grad-bg h-10 w-10 animate-pulse rounded-2xl" />
      </div>
    )
  }

  if (gate === 'locked') return <PinGate onUnlocked={() => void boot()} />

  return (
    <Shell
      month={month || currentMonth}
      onMonth={(delta) => setMonth((m) => shiftMonth(m || currentMonth, delta))}
      onToday={() => setMonth(currentMonth)}
    >
      {month && <Dashboard month={month} />}
    </Shell>
  )
}
