import { useEffect, useState } from 'react'
import {
  clearAllClockRecords,
  clockIn,
  clockOut,
  ClockPeriod,
  ClockRecord,
  deleteClockRecord,
  getClockRecords,
  getCurrentClock,
} from '../api/client'

const shellPanelClass = 'rounded-[1.75rem] border border-bd bg-surface/[0.88] shadow-ambient backdrop-blur-xl'
const sectionCardClass = 'rounded-[1.35rem] border border-bd bg-page/[0.52]'
const insetCardClass = 'rounded-[1.1rem] border border-bd bg-page/[0.4]'
const fieldClass = 'w-full rounded-[1.05rem] border border-bd-strong bg-surface-elevated/[0.9] px-3 py-2.5 text-sm text-tx shadow-inset outline-none transition placeholder:text-tx-faint focus:border-accent/40 focus:ring-2 focus:ring-accent/10'
const secondaryButtonClass = 'rounded-[1rem] border border-bd bg-page/[0.55] px-3 py-2 text-xs font-medium text-tx-muted transition hover:border-bd-strong hover:bg-surface-elevated/[0.92] hover:text-tx-sub disabled:opacity-50'

const PERIODS: {
  key: ClockPeriod
  label: string
  icon: string
  description: string
  badgeClass: string
  activeClass: string
  actionClass: string
  iconClass: string
}[] = [
  {
    key: 'morning',
    label: '上午',
    icon: '🌅',
    description: '开启第一段专注工作。',
    badgeClass: 'border-warning/25 bg-warning/10 text-warning',
    activeClass: 'border-warning/25 bg-warning/10 shadow-float ring-1 ring-warning/10',
    actionClass: 'bg-warning hover:bg-warning/90',
    iconClass: 'border border-warning/25 bg-warning/10 text-warning',
  },
  {
    key: 'afternoon',
    label: '下午',
    icon: '☀️',
    description: '处理中段推进与执行。',
    badgeClass: 'border-accent/25 bg-accent/10 text-accent',
    activeClass: 'border-accent/25 bg-accent-soft/[0.8] shadow-float ring-1 ring-accent/10',
    actionClass: 'bg-accent hover:bg-accent-strong',
    iconClass: 'border border-accent/25 bg-accent-soft/[0.8] text-accent',
  },
  {
    key: 'evening',
    label: '晚上',
    icon: '🌙',
    description: '安排夜间收尾或补充工作。',
    badgeClass: 'border-brand/25 bg-brand/10 text-brand',
    activeClass: 'border-brand/25 bg-brand/10 shadow-float ring-1 ring-brand/10',
    actionClass: 'bg-brand hover:bg-brand/90',
    iconClass: 'border border-brand/25 bg-brand/10 text-brand',
  },
]

function parseUTC(value: string): Date {
  return new Date(value.endsWith('Z') || value.includes('+') ? value : `${value}Z`)
}

function formatDuration(ms: number) {
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m ${seconds}s`
}

function formatHours(start: string, end: string) {
  const diff = parseUTC(end).getTime() - parseUTC(start).getTime()
  return `${(diff / 3600000).toFixed(1)}h`
}

function localTimeToISO(timeStr: string, dateStr?: string): string {
  const base = dateStr ?? new Date().toLocaleDateString('en-CA')
  return new Date(`${base}T${timeStr}`).toISOString()
}

function nowHHMM() {
  const date = new Date()
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function formatTimeLabel(value: string) {
  return parseUTC(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function formatDateLabel(value: string) {
  return parseUTC(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' })
}

function PeriodCard({
  period,
  active,
  done,
  elapsed,
  onClockIn,
  onClockOut,
}: {
  period: (typeof PERIODS)[0]
  active: ClockRecord | null
  done: ClockRecord | null
  elapsed: number
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

  const toneClass = active
    ? period.activeClass
    : done
      ? 'border-success/20 bg-success/10'
      : 'border-bd bg-surface-elevated/[0.88]'

  return (
    <div className={`rounded-[1.35rem] border p-5 transition-all ${toneClass}`}>
      <div className="flex items-start gap-3">
        <div className={`flex h-11 w-11 items-center justify-center rounded-2xl text-xl ${period.iconClass}`}>
          {period.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold tracking-[-0.02em] text-tx-sub">{period.label}</h3>
            {active && (
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${period.badgeClass}`}>
                工作中
              </span>
            )}
            {!active && done && (
              <span className="rounded-full border border-success/25 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                已完成
              </span>
            )}
          </div>
          <p className="mt-1 text-sm leading-6 text-tx-muted">{period.description}</p>
        </div>
      </div>

      <div className="mt-6">
        {active ? (
          <>
            <div className="text-3xl font-semibold tracking-[-0.04em] text-tx">{formatDuration(elapsed)}</div>
            <p className="mt-2 text-xs text-tx-muted">{formatTimeLabel(active.clock_in)} 开始，当前正在计时。</p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                onClick={() => onClockOut()}
                className="w-full rounded-[1rem] bg-danger px-4 py-2.5 text-sm font-medium text-white transition hover:bg-danger/90"
              >
                下班打卡
              </button>
              <button onClick={() => openPatch('out')} className={secondaryButtonClass}>
                补打下班时间
              </button>
            </div>
          </>
        ) : done ? (
          <>
            <div className="text-3xl font-semibold tracking-[-0.04em] text-success">{formatHours(done.clock_in, done.clock_out!)}</div>
            <p className="mt-2 text-xs text-tx-muted">
              {formatTimeLabel(done.clock_in)} - {formatTimeLabel(done.clock_out!)}
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button onClick={() => openPatch('in')} className={secondaryButtonClass}>
                重新补打上班时间
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="text-3xl font-semibold tracking-[-0.04em] text-tx-sub">待开始</div>
            <p className="mt-2 text-xs text-tx-faint">尚未登记这一时段的上班时间。</p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                onClick={() => onClockIn()}
                className={`w-full rounded-[1rem] px-4 py-2.5 text-sm font-medium text-white transition ${period.actionClass}`}
              >
                上班打卡
              </button>
              <button onClick={() => openPatch('in')} className={secondaryButtonClass}>
                补打上班时间
              </button>
            </div>
          </>
        )}
      </div>

      {showPatch && (
        <div className={`${insetCardClass} mt-4 p-3`}>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">
            {patchTarget === 'in' ? '补打上班时间' : '补打下班时间'}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input
              type="date"
              value={patchDate}
              onChange={(event) => setPatchDate(event.target.value)}
              className={fieldClass}
            />
            <input
              type="time"
              value={patchTime}
              onChange={(event) => setPatchTime(event.target.value)}
              className={fieldClass}
            />
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={confirmPatch}
              className={`flex-1 rounded-[1rem] px-3 py-2 text-xs font-medium text-white transition ${period.actionClass}`}
            >
              确认补卡
            </button>
            <button onClick={() => setShowPatch(false)} className={`${secondaryButtonClass} flex-1`}>
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <div className={`${insetCardClass} px-4 py-3`}>
      <div className="text-[11px] text-tx-faint">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-tx-sub">{value}</div>
      <div className="mt-1 text-xs leading-5 text-tx-muted">{detail}</div>
    </div>
  )
}

export default function ClockPage() {
  const [actives, setActives] = useState<Record<ClockPeriod, ClockRecord | null>>({
    morning: null,
    afternoon: null,
    evening: null,
  })
  const [records, setRecords] = useState<ClockRecord[]>([])
  const [now, setNow] = useState(() => Date.now())

  const load = async () => {
    const list = await getCurrentClock()
    const map: Record<ClockPeriod, ClockRecord | null> = { morning: null, afternoon: null, evening: null }
    for (const record of list) map[record.period] = record
    setActives(map)
    const recentRecords = await getClockRecords(30)
    setRecords(recentRecords)
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const handleClockIn = async (period: ClockPeriod, clockTime?: string) => {
    await clockIn(period, '', clockTime)
    void load()
  }

  const handleClockOut = async (period: ClockPeriod, clockTime?: string) => {
    await clockOut(period, clockTime)
    void load()
  }

  const handleDeleteRecord = async (id: number) => {
    await deleteClockRecord(id)
    void load()
  }

  const handleClearAll = async () => {
    if (!confirm('确认清除全部打卡记录？')) return
    await clearAllClockRecords()
    void load()
  }

  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + (weekStart.getDay() === 0 ? -6 : 1))
  weekStart.setHours(0, 0, 0, 0)

  const weekHours = { morning: 0, afternoon: 0, evening: 0 }
  records
    .filter((record) => record.clock_out && parseUTC(record.clock_in) >= weekStart)
    .forEach((record) => {
      const hours = (parseUTC(record.clock_out!).getTime() - parseUTC(record.clock_in).getTime()) / 3600000
      weekHours[record.period] = (weekHours[record.period] ?? 0) + hours
    })
  const weekTotal = weekHours.morning + weekHours.afternoon + weekHours.evening

  const todayStr = new Date().toLocaleDateString()
  const todayHours = { morning: 0, afternoon: 0, evening: 0 }
  const todayDone: Record<ClockPeriod, ClockRecord | null> = { morning: null, afternoon: null, evening: null }
  records
    .filter((record) => record.clock_out && parseUTC(record.clock_in).toLocaleDateString() === todayStr)
    .forEach((record) => {
      const hours = (parseUTC(record.clock_out!).getTime() - parseUTC(record.clock_in).getTime()) / 3600000
      todayHours[record.period] = (todayHours[record.period] ?? 0) + hours
      if (!todayDone[record.period]) todayDone[record.period] = record
    })
  const todayTotal = todayHours.morning + todayHours.afternoon + todayHours.evening

  const activeCount = PERIODS.filter((period) => Boolean(actives[period.key])).length
  const completedTodayCount = PERIODS.filter((period) => Boolean(todayDone[period.key])).length
  const localNow = new Date(now).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6 xl:grid xl:grid-cols-[minmax(300px,340px)_minmax(0,1fr)]">
      <section className={`flex min-h-[360px] flex-col overflow-hidden ${shellPanelClass}`}>
        <div className="border-b border-bd/70 px-5 py-5">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Time Rhythm</div>
          <h2 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-tx">打卡工作台</h2>
          <p className="mt-2 text-sm leading-6 text-tx-muted">把上午、下午、晚上的打卡、补卡和节奏统计收进一个稳定的时间控制台。</p>
          <div className="mt-4 inline-flex rounded-full border border-bd bg-page/[0.55] px-3 py-1 text-[11px] text-tx-faint">
            当前时间 {localNow}
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="今日工时" value={`${todayTotal.toFixed(1)}h`} detail="实时汇总今日完成的所有时段。" />
            <StatCard label="本周工时" value={`${weekTotal.toFixed(1)}h`} detail="按本周一开始累计当前周数据。" />
            <StatCard label="进行中时段" value={`${activeCount}`} detail="当前仍在计时的工作块数量。" />
            <StatCard label="今日已完成" value={`${completedTodayCount}/3`} detail="三个时段中已经打卡完成的数量。" />
          </div>

          <div className={`${sectionCardClass} p-4`}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Today Overview</div>
                <div className="mt-1 text-sm font-medium text-tx-sub">今日三段状态</div>
              </div>
              <div className="text-[11px] text-tx-faint">共 {records.length} 条记录</div>
            </div>
            <div className="mt-4 space-y-3">
              {PERIODS.map((period) => {
                const active = actives[period.key]
                const done = todayDone[period.key]
                const stateLabel = active ? '进行中' : done ? '已完成' : '未开始'
                const stateClass = active
                  ? period.badgeClass
                  : done
                    ? 'border-success/25 bg-success/10 text-success'
                    : 'border-bd bg-page/[0.65] text-tx-faint'

                return (
                  <div key={period.key} className={`${insetCardClass} flex items-center gap-3 px-3 py-3`}>
                    <div className={`flex h-10 w-10 items-center justify-center rounded-2xl text-lg ${period.iconClass}`}>
                      {period.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-tx-sub">{period.label}</div>
                      <div className="text-xs text-tx-muted">
                        {active
                          ? `${formatTimeLabel(active.clock_in)} 开始`
                          : done?.clock_out
                            ? `${formatTimeLabel(done.clock_in)} - ${formatTimeLabel(done.clock_out)}`
                            : '尚未开始'}
                      </div>
                    </div>
                    <span className={`rounded-full border px-2 py-1 text-[11px] ${stateClass}`}>{stateLabel}</span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className={`${sectionCardClass} p-4`}>
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Patch Tips</div>
            <p className="mt-2 text-sm leading-6 text-tx-muted">补卡支持选择日期和时间。下班补卡默认继承当前上班记录的日期，避免跨天时长偏差。</p>
          </div>
        </div>
      </section>

      <section className={`flex min-h-[420px] min-w-0 flex-col overflow-hidden ${shellPanelClass}`}>
        <div className="border-b border-bd/70 px-5 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Shift Control</div>
              <h2 className="mt-2 text-[1.75rem] font-semibold tracking-[-0.04em] text-tx">三段打卡与近期记录</h2>
              <p className="mt-2 text-sm leading-6 text-tx-muted">上方负责每个时段的开始、结束和补卡，下方保留最近 30 条记录，方便直接回看和清理。</p>
            </div>
            {records.length > 0 && (
              <button
                onClick={handleClearAll}
                className="rounded-[1rem] border border-danger/25 bg-danger/10 px-3 py-2 text-xs font-medium text-danger transition hover:bg-danger/15"
              >
                清除全部记录
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4 lg:p-5">
          <div className="space-y-4">
            <div className={`${sectionCardClass} p-4`}>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Clock Blocks</div>
                  <div className="mt-1 text-sm font-medium text-tx-sub">今日的三个工作时段</div>
                </div>
                <div className="text-[11px] text-tx-faint">实时计时会每秒刷新</div>
              </div>
              <div className="grid gap-4 xl:grid-cols-3">
                {PERIODS.map((period) => (
                  <PeriodCard
                    key={period.key}
                    period={period}
                    active={actives[period.key]}
                    done={todayDone[period.key]}
                    elapsed={actives[period.key] ? now - parseUTC(actives[period.key]!.clock_in).getTime() : 0}
                    onClockIn={(clockTime) => handleClockIn(period.key, clockTime)}
                    onClockOut={(clockTime) => handleClockOut(period.key, clockTime)}
                  />
                ))}
              </div>
            </div>

            <div className={`${sectionCardClass} overflow-hidden`}>
              <div className="border-b border-bd/60 px-4 py-4">
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Recent Records</div>
                <div className="mt-1 text-sm font-medium text-tx-sub">近期打卡记录</div>
              </div>

              <div className="divide-y divide-bd/50">
                {records.map((record) => {
                  const period = PERIODS.find((item) => item.key === record.period) ?? PERIODS[0]
                  return (
                    <div key={record.id} className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-center">
                      <div className={`flex h-11 w-11 items-center justify-center rounded-2xl text-xl ${period.iconClass}`}>
                        {period.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-medium text-tx-sub">{formatDateLabel(record.clock_in)}</div>
                          <span className="text-xs text-tx-muted">{period.label}</span>
                          {!record.clock_out && (
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${period.badgeClass}`}>
                              进行中
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-xs leading-6 text-tx-muted">
                          {formatTimeLabel(record.clock_in)} - {record.clock_out ? formatTimeLabel(record.clock_out) : '进行中'}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 lg:ml-4">
                        <div className="rounded-full border border-bd bg-page/[0.55] px-3 py-1 text-sm font-medium text-tx-sub">
                          {record.clock_out ? formatHours(record.clock_in, record.clock_out) : '—'}
                        </div>
                        <button
                          onClick={() => handleDeleteRecord(record.id)}
                          className="rounded-full border border-transparent px-2 py-1 text-xs text-tx-faint transition hover:border-danger/20 hover:bg-danger/10 hover:text-danger"
                          title="删除此记录"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  )
                })}

                {records.length === 0 && (
                  <div className="px-4 py-10 text-center text-sm text-tx-faint">暂无记录，先完成一次打卡以建立节奏数据。</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
