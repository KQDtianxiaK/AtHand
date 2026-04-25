import { useEffect, useState } from 'react'
import { clearAllClockRecords, clockIn, clockOut, ClockPeriod, ClockRecord, deleteClockRecord, getClockRecords, getCurrentClock } from '../api/client'

const PERIODS: { key: ClockPeriod; label: string; icon: string; color: string; activeColor: string }[] = [
  { key: 'morning',   label: '上午', icon: '🌅', color: 'bg-amber-500',  activeColor: 'border-amber-400 bg-amber-500/10' },
  { key: 'afternoon', label: '下午', icon: '☀️',  color: 'bg-blue-500',   activeColor: 'border-blue-400 bg-blue-500/10' },
  { key: 'evening',   label: '晚上', icon: '🌙', color: 'bg-purple-500', activeColor: 'border-purple-400 bg-purple-500/10' },
]

/** 后端返回的时间字符串没有时区标识（UTC 无 Z），直接 new Date() 会被当作本地时间，偏差 +8h。
 *  统一追加 Z 来按 UTC 解析。 */
function parseUTC(s: string): Date {
  return new Date(s.endsWith('Z') || s.includes('+') ? s : s + 'Z')
}

function formatDuration(ms: number) {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${s}s`
}

function formatHours(start: string, end: string) {
  const diff = parseUTC(end).getTime() - parseUTC(start).getTime()
  return `${(diff / 3600000).toFixed(1)}h`
}

/** 将本地 HH:MM 时间字符串和可选日期构造成 UTC ISO 字符串（用于补卡）。 */
function localTimeToISO(timeStr: string, dateStr?: string): string {
  const base = dateStr ?? new Date().toLocaleDateString('en-CA') // YYYY-MM-DD
  return new Date(`${base}T${timeStr}`).toISOString()
}

/** 当前本地时间 HH:MM */
function nowHHMM() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function PeriodCard({
  period, active, done, elapsed, onClockIn, onClockOut,
}: {
  period: typeof PERIODS[0]
  active: ClockRecord | null
  done: ClockRecord | null       // 今日已完成（有 clock_out）
  elapsed: number  // ms
  onClockIn: (clockTime?: string) => void
  onClockOut: (clockTime?: string) => void
}) {
  const [showPatch, setShowPatch] = useState(false)
  const [patchTime, setPatchTime] = useState(nowHHMM)
  const [patchDate, setPatchDate] = useState(() => new Date().toLocaleDateString('en-CA'))
  const [patchTarget, setPatchTarget] = useState<'in' | 'out'>('in')

  const openPatch = (target: 'in' | 'out') => {
    setPatchTarget(target)
    setPatchTime(nowHHMM())
    // 下班补卡默认日期取上班打卡那天，避免跨天计算错误
    if (target === 'out' && active) {
      const clockInLocal = parseUTC(active.clock_in)
      setPatchDate(clockInLocal.toLocaleDateString('en-CA'))
    } else {
      setPatchDate(new Date().toLocaleDateString('en-CA'))
    }
    setShowPatch(true)
  }

  const confirmPatch = () => {
    const iso = localTimeToISO(patchTime, patchDate)
    if (patchTarget === 'in') onClockIn(iso)
    else onClockOut(iso)
    setShowPatch(false)
  }

  // 今日已完成状态的样式
  const doneColor = 'border-green-500/40 bg-green-500/5'

  return (
    <div className={`rounded-xl border-2 p-5 transition-colors ${active ? period.activeColor : done ? doneColor : 'border-bd bg-surface'}`}>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-2xl">{period.icon}</span>
        <span className="text-lg font-semibold">{period.label}</span>
        {active && (
          <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 font-medium">工作中</span>
        )}
        {!active && done && (
          <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 font-medium">✓ 已完成</span>
        )}
      </div>

      {active ? (
        <>
          <p className="text-3xl font-bold font-mono text-tx mb-1">{formatDuration(elapsed)}</p>
          <p className="text-xs text-tx-muted mb-4">
            {parseUTC(active.clock_in).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 开始
          </p>
          <button
            onClick={() => onClockOut()}
            className="w-full py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium transition-colors"
          >
            下班打卡
          </button>
          <button
            onClick={() => openPatch('out')}
            className="mt-2 w-full py-1.5 rounded-lg border border-bd text-xs text-tx-muted hover:bg-raised transition-colors"
          >⏰ 补打下班时间</button>
        </>
      ) : done ? (
        <>
          <p className="text-sm text-tx-muted mb-1">
            {parseUTC(done.clock_in).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            {' — '}
            {parseUTC(done.clock_out!).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </p>
          <p className="text-2xl font-bold text-green-400 mb-4">{formatHours(done.clock_in, done.clock_out!)}</p>
          <button
            onClick={() => openPatch('in')}
            className="mt-2 w-full py-1.5 rounded-lg border border-bd text-xs text-tx-muted hover:bg-raised transition-colors"
          >⏰ 重新补打上班时间</button>
        </>
      ) : (
        <>
          <p className="text-sm text-tx-faint mb-4">未打卡</p>
          <button
            onClick={() => onClockIn()}
            className={`w-full py-2.5 rounded-lg ${period.color} hover:opacity-90 text-white font-medium transition-opacity`}
          >
            上班打卡
          </button>
          <button
            onClick={() => openPatch('in')}
            className="mt-2 w-full py-1.5 rounded-lg border border-bd text-xs text-tx-muted hover:bg-raised transition-colors"
          >⏰ 补打上班时间</button>
        </>
      )}

      {/* 补卡时间选择 */}
      {showPatch && (
        <div className="mt-3 p-3 rounded-lg bg-raised border border-bd">
          <p className="text-xs text-tx-muted mb-2">
            选择{patchTarget === 'in' ? '上班' : '下班'}时间
          </p>
          <div className="flex flex-col gap-1.5 mb-2">
            <input
              type="date"
              value={patchDate}
              onChange={e => setPatchDate(e.target.value)}
              className="w-full px-2 py-1.5 rounded bg-surface border border-bd text-tx text-sm focus:outline-none focus:border-blue-500"
            />
            <input
              type="time"
              value={patchTime}
              onChange={e => setPatchTime(e.target.value)}
              className="w-full px-2 py-1.5 rounded bg-surface border border-bd text-tx text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={confirmPatch}
              className="flex-1 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
            >确认补卡</button>
            <button
              onClick={() => setShowPatch(false)}
              className="flex-1 py-1.5 rounded border border-bd text-xs text-tx-muted hover:bg-surface"
            >取消</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ClockPage() {
  const [actives, setActives] = useState<Record<ClockPeriod, ClockRecord | null>>({
    morning: null, afternoon: null, evening: null,
  })
  const [records, setRecords] = useState<ClockRecord[]>([])
  const [tick, setTick] = useState(0)

  const load = async () => {
    const list = await getCurrentClock()
    const map: Record<ClockPeriod, ClockRecord | null> = { morning: null, afternoon: null, evening: null }
    for (const r of list) map[r.period] = r
    setActives(map)
    const r = await getClockRecords(30)
    setRecords(r)
  }

  useEffect(() => { load() }, [])

  // 每秒更新计时
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const now = Date.now()

  const handleClockIn = async (period: ClockPeriod, clockTime?: string) => {
    await clockIn(period, '', clockTime)
    load()
  }

  const handleClockOut = async (period: ClockPeriod, clockTime?: string) => {
    await clockOut(period, clockTime)
    load()
  }

  const handleDeleteRecord = async (id: number) => {
    await deleteClockRecord(id)
    load()
  }

  const handleClearAll = async () => {
    if (!confirm('确认清除全部打卡记录？')) return
    await clearAllClockRecords()
    load()
  }

  // 本周工时（分段）
  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + (weekStart.getDay() === 0 ? -6 : 1))
  weekStart.setHours(0, 0, 0, 0)

  const weekHours = { morning: 0, afternoon: 0, evening: 0 }
  records
    .filter((r) => r.clock_out && parseUTC(r.clock_in) >= weekStart)
    .forEach((r) => {
      const h = (parseUTC(r.clock_out!).getTime() - parseUTC(r.clock_in).getTime()) / 3600000
      weekHours[r.period] = (weekHours[r.period] ?? 0) + h
    })
  const weekTotal = weekHours.morning + weekHours.afternoon + weekHours.evening

  // 今日工时（分段）
  const todayStr = new Date().toLocaleDateString()
  const todayHours = { morning: 0, afternoon: 0, evening: 0 }
  // 今日各时段已完成的最新记录
  const todayDone: Record<ClockPeriod, ClockRecord | null> = { morning: null, afternoon: null, evening: null }
  records
    .filter((r) => r.clock_out && parseUTC(r.clock_in).toLocaleDateString() === todayStr)
    .forEach((r) => {
      const h = (parseUTC(r.clock_out!).getTime() - parseUTC(r.clock_in).getTime()) / 3600000
      todayHours[r.period] = (todayHours[r.period] ?? 0) + h
      // 取最新的一条（records 已按 clock_in desc 排序）
      if (!todayDone[r.period]) todayDone[r.period] = r
    })
  const todayTotal = todayHours.morning + todayHours.afternoon + todayHours.evening

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold">打卡</h2>

      {/* 三段打卡卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PERIODS.map((p) => (
          <PeriodCard
            key={p.key}
            period={p}
            active={actives[p.key]}
            done={todayDone[p.key]}
            elapsed={actives[p.key] ? now - parseUTC(actives[p.key]!.clock_in).getTime() : 0}
            onClockIn={(clockTime) => handleClockIn(p.key, clockTime)}
            onClockOut={(clockTime) => handleClockOut(p.key, clockTime)}
          />
        ))}
      </div>

      {/* 今日 + 本周统计 */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-surface rounded-xl p-4">
          <p className="text-sm text-tx-muted mb-2">今日工时</p>
          <p className="text-3xl font-bold text-blue-400">{todayTotal.toFixed(1)}h</p>
          <div className="flex gap-3 mt-2 text-xs text-tx-muted">
            <span>🌅 {todayHours.morning.toFixed(1)}h</span>
            <span>☀️ {todayHours.afternoon.toFixed(1)}h</span>
            <span>🌙 {todayHours.evening.toFixed(1)}h</span>
          </div>
        </div>
        <div className="bg-surface rounded-xl p-4">
          <p className="text-sm text-tx-muted mb-2">本周工时</p>
          <p className="text-3xl font-bold text-blue-400">{weekTotal.toFixed(1)}h</p>
          <div className="flex gap-3 mt-2 text-xs text-tx-muted">
            <span>🌅 {weekHours.morning.toFixed(1)}h</span>
            <span>☀️ {weekHours.afternoon.toFixed(1)}h</span>
            <span>🌙 {weekHours.evening.toFixed(1)}h</span>
          </div>
        </div>
      </div>

      {/* 打卡记录 */}
      <div className="bg-surface rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-bd flex items-center justify-between">
          <h3 className="text-sm font-medium text-tx-muted">近期记录</h3>
          {records.length > 0 && (
            <button
              onClick={handleClearAll}
              className="text-xs text-red-400 hover:text-red-300 transition-colors"
            >清除全部</button>
          )}
        </div>
        <div className="divide-y divide-bd">
          {records.map((r) => {
            const p = PERIODS.find((x) => x.key === r.period) ?? PERIODS[0]
            return (
              <div key={r.id} className="px-4 py-3 flex items-center gap-3">
                <span className="text-lg">{p.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-tx">
                    {parseUTC(r.clock_in).toLocaleDateString()} <span className="text-tx-muted text-xs">{p.label}</span>
                  </p>
                  <p className="text-xs text-tx-muted">
                    {parseUTC(r.clock_in).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    {' — '}
                    {r.clock_out
                      ? parseUTC(r.clock_out).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
                      : '进行中'}
                  </p>
                </div>
                <span className="text-sm text-blue-400 font-mono flex-shrink-0">
                  {r.clock_out ? formatHours(r.clock_in, r.clock_out) : '—'}
                </span>
                <button
                  onClick={() => handleDeleteRecord(r.id)}
                  className="ml-2 text-tx-faint hover:text-red-400 transition-colors text-xs px-1"
                  title="删除此记录"
                >✕</button>
              </div>
            )
          })}
          {records.length === 0 && (
            <p className="px-4 py-6 text-center text-tx-faint">暂无记录</p>
          )}
        </div>
      </div>
    </div>
  )
}
