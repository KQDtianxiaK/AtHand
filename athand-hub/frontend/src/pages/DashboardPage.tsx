import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DailyWorkHours, getStats, StatsOverview, getNewsStats, type NewsStats } from '../api/client'

const panelClassName = 'rounded-[1.75rem] border border-bd bg-surface/[0.88] shadow-ambient backdrop-blur-xl'

// ---- 分段堆叠柱状图 ----
function SegmentedBarChart({ data }: { data: DailyWorkHours[] }) {
  const maxH = Math.max(...data.map((d) => d.total), 1)
  return (
    <div className="flex h-40 items-end gap-2">
      {data.map((d) => {
        const totalPct = (d.total / maxH) * 100
        const mPct = d.total > 0 ? (d.morning / d.total) * 100 : 0
        const aPct = d.total > 0 ? (d.afternoon / d.total) * 100 : 0
        const ePct = d.total > 0 ? (d.evening / d.total) * 100 : 100  // fill rest
        return (
          <div key={d.day} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            {d.total > 0 && (
              <span className="text-[10px] tabular-nums text-tx-muted">{d.total.toFixed(1)}</span>
            )}
            <div
              className="flex w-full flex-col-reverse overflow-hidden rounded-t-[1rem] border border-bd/70 bg-page/60"
              style={{ height: `${Math.max(totalPct, d.total > 0 ? 4 : 0)}%`, minHeight: d.total > 0 ? 4 : 0 }}
              title={`上午${d.morning.toFixed(1)}h 下午${d.afternoon.toFixed(1)}h 晚上${d.evening.toFixed(1)}h`}
            >
              {d.evening > 0 && (
                <div className="w-full bg-success/90" style={{ height: `${ePct}%` }} />
              )}
              {d.afternoon > 0 && (
                <div className="w-full bg-accent" style={{ height: `${aPct}%` }} />
              )}
              {d.morning > 0 && (
                <div className="w-full bg-brand/90" style={{ height: `${mPct}%` }} />
              )}
              {d.total === 0 && <div className="h-1 w-full rounded-t bg-bd" />}
            </div>
            <span className="w-full truncate text-center text-[10px] text-tx-faint">
              {d.day.slice(5)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ---- 折线趋势图（SVG） ----
function LineChart({ data }: { data: DailyWorkHours[] }) {
  const W = 560, H = 100, PAD = { t: 10, b: 24, l: 28, r: 8 }
  const iW = W - PAD.l - PAD.r
  const iH = H - PAD.t - PAD.b
  const maxV = Math.max(...data.map((d) => d.total), 1)
  const n = data.length

  const x = (i: number) => PAD.l + (i / (n - 1)) * iW
  const y = (v: number) => PAD.t + iH - (v / maxV) * iH

  const pts = data.map((d, i) => `${x(i).toFixed(1)},${y(d.total).toFixed(1)}`).join(' ')
  const area = [
    `M ${x(0).toFixed(1)},${(PAD.t + iH).toFixed(1)}`,
    ...data.map((d, i) => `L ${x(i).toFixed(1)},${y(d.total).toFixed(1)}`),
    `L ${x(n - 1).toFixed(1)},${(PAD.t + iH).toFixed(1)} Z`,
  ].join(' ')

  const yTicks = [0, maxV / 2, maxV].map((v) => ({ v, y: y(v) }))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
      {/* grid lines */}
      {yTicks.map(({ v, y: ty }) => (
        <g key={v}>
          <line x1={PAD.l} y1={ty} x2={W - PAD.r} y2={ty} stroke="currentColor" strokeOpacity={0.1} strokeWidth={1} />
          <text x={PAD.l - 4} y={ty + 4} textAnchor="end" fontSize={9} fill="currentColor" fillOpacity={0.4}>
            {v.toFixed(1)}
          </text>
        </g>
      ))}
      {/* area fill */}
      <path d={area} fill="rgb(var(--c-accent))" fillOpacity={0.12} />
      {/* line */}
      <polyline points={pts} fill="none" stroke="rgb(var(--c-accent-strong))" strokeWidth={2} strokeLinejoin="round" />
      {/* dots */}
      {data.map((d, i) => (
        <circle key={d.day} cx={x(i)} cy={y(d.total)} r={3} fill="rgb(var(--c-accent))" />
      ))}
      {/* x labels */}
      {data.map((d, i) => (
        <text key={d.day} x={x(i)} y={H - 4} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.5}>
          {d.day.slice(5)}
        </text>
      ))}
    </svg>
  )
}

export default function DashboardPage() {
  const [stats, setStats] = useState<StatsOverview | null>(null)
  const [newsStats, setNewsStats] = useState<NewsStats | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    getStats(7).then(setStats).catch(console.error)
    getNewsStats().then(setNewsStats).catch(console.error)
  }, [])

  if (!stats) return <div className="p-6 text-tx-muted">加载中...</div>

  return (
    <div className="space-y-6 p-6 lg:p-8">
      <section className={`${panelClassName} overflow-hidden`}>
        <div className="flex flex-col gap-6 px-6 py-6 lg:flex-row lg:items-end lg:justify-between lg:px-8 lg:py-8">
          <div className="max-w-2xl">
            <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-tx-faint">Desk Overview</div>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-tx lg:text-[2.5rem]">把 AI 会话、时间投入和日常输入流收在同一个面板里。</h2>
            <p className="mt-3 max-w-xl text-sm leading-7 text-tx-muted">AtHand 的首页不应该只是统计罗列，而应该像一块安静、克制、可靠的工作台。这里保留高密度信息，但降低后台式噪音。</p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm text-tx-sub sm:grid-cols-4 lg:min-w-[420px]">
            <div className="rounded-[1.35rem] border border-bd bg-page/[0.55] px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-tx-faint">Sessions</div>
              <div className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-tx">{stats.total_sessions}</div>
            </div>
            <div className="rounded-[1.35rem] border border-bd bg-page/[0.55] px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-tx-faint">Success</div>
              <div className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-success">{stats.done_sessions}</div>
            </div>
            <div className="rounded-[1.35rem] border border-bd bg-page/[0.55] px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-tx-faint">Focus Hours</div>
              <div className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-accent">{stats.total_work_hours}h</div>
            </div>
            <div className="rounded-[1.35rem] border border-bd bg-page/[0.55] px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-tx-faint">News</div>
              <div className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-tx">{newsStats?.today_count ?? 0}</div>
            </div>
          </div>
        </div>
      </section>

      {/* 概览卡片 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="总会话" value={stats.total_sessions} tone="default" />
        <StatCard label="成功" value={stats.done_sessions} tone="success" />
        <StatCard label="失败" value={stats.failed_sessions} tone="danger" />
        <StatCard label="成功率" value={`${stats.success_rate}%`} tone="accent" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 每日会话趋势 */}
        <div className={`${panelClassName} p-5 lg:p-6`}>
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-tx-faint">Session Activity</div>
              <h3 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-tx">近 7 天会话数</h3>
            </div>
            <div className="rounded-full border border-accent/20 bg-accent-soft px-3 py-1 text-xs text-accent">{stats.total_sessions} sessions</div>
          </div>
          <div className="flex h-36 items-end gap-2">
            {stats.daily_sessions.map((d) => {
              const max = Math.max(...stats.daily_sessions.map((x) => x.count), 1)
              const h = (d.count / max) * 100
              return (
                <div key={d.day} className="flex flex-1 flex-col items-center gap-1.5">
                  <span className="text-[11px] text-tx-muted">{d.count}</span>
                  <div
                    className="w-full rounded-t-[1rem] border border-accent/[0.15] bg-accent"
                    style={{ height: `${h}%`, minHeight: d.count > 0 ? 4 : 0 }}
                  />
                  <span className="text-[11px] text-tx-faint">{d.day.slice(5)}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* 工时总览 */}
        <div className={`${panelClassName} p-5 lg:p-6`}>
          <div className="text-[11px] uppercase tracking-[0.18em] text-tx-faint">Time Allocation</div>
          <h3 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-tx">近 7 天工时</h3>
          <p className="mt-5 text-5xl font-semibold tracking-[-0.05em] text-accent">{stats.total_work_hours}h</p>
          <p className="mt-2 text-sm text-tx-muted">日均 {(stats.total_work_hours / 7).toFixed(1)}h</p>
          {/* 图例 */}
          <div className="mt-5 flex flex-wrap gap-4 text-xs text-tx-muted">
            <span className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-brand/90" />上午</span>
            <span className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-accent" />下午</span>
            <span className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-success/90" />晚上</span>
          </div>
        </div>
      </div>

      {/* 每日分段工时柱状图 */}
      <div className={`${panelClassName} p-5 lg:p-6`}>
        <div className="mb-4 text-[11px] uppercase tracking-[0.18em] text-tx-faint">Rhythm</div>
        <h3 className="mb-4 text-lg font-semibold tracking-[-0.03em] text-tx">每日工时（分段堆叠）</h3>
        <SegmentedBarChart data={stats.daily_work_hours} />
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-tx-muted">
          <span className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-brand/90" />上午</span>
          <span className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-accent" />下午</span>
          <span className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-success/90" />晚上</span>
        </div>
      </div>

      {/* 工时折线趋势图 */}
      <div className={`${panelClassName} p-5 lg:p-6`}>
        <div className="mb-4 text-[11px] uppercase tracking-[0.18em] text-tx-faint">Trend</div>
        <h3 className="mb-4 text-lg font-semibold tracking-[-0.03em] text-tx">工时趋势</h3>
        <LineChart data={stats.daily_work_hours} />
      </div>

      {/* 各机器使用量 */}
      {stats.machine_sessions.length > 0 && (
        <div className={`${panelClassName} p-5 lg:p-6`}>
          <div className="mb-4 text-[11px] uppercase tracking-[0.18em] text-tx-faint">Machine Distribution</div>
          <h3 className="mb-4 text-lg font-semibold tracking-[-0.03em] text-tx">各机器会话分布</h3>
          <div className="space-y-2">
            {stats.machine_sessions.map((m) => {
              const max = Math.max(...stats.machine_sessions.map((x) => x.count), 1)
              return (
                <div key={m.machine_id} className="flex items-center gap-3 rounded-[1.1rem] border border-bd bg-page/[0.45] px-3 py-3">
                  <span className="w-24 text-sm text-tx-sub truncate">{m.machine_id}</span>
                  <div className="h-4 flex-1 rounded-full bg-raised">
                    <div
                      className="h-4 rounded-full bg-accent"
                      style={{ width: `${(m.count / max) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm text-tx-muted w-8 text-right">{m.count}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 新闻动态 */}
      {newsStats && (
        <div className={`${panelClassName} p-5 lg:p-6`}>
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-tx-faint">News Digest</div>
              <h3 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-tx">新闻动态</h3>
            </div>
            <button onClick={() => navigate('/news')} className="rounded-full border border-bd bg-page/[0.45] px-3 py-2 text-sm text-accent transition hover:border-bd-strong hover:text-accent-strong">查看全部</button>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-[1.2rem] border border-bd bg-page/[0.45] px-4 py-4">
              <p className="text-sm text-tx-muted">今日新闻</p>
              <p className="text-2xl font-bold text-tx">{newsStats.today_count}</p>
            </div>
            <div className="rounded-[1.2rem] border border-bd bg-page/[0.45] px-4 py-4">
              <p className="text-sm text-tx-muted">信息源</p>
              <p className="text-2xl font-bold text-tx">{newsStats.source_count}</p>
            </div>
            <div className="rounded-[1.2rem] border border-bd bg-page/[0.45] px-4 py-4">
              <p className="text-sm text-tx-muted">今日总结</p>
              <p className="text-2xl font-bold text-tx">
                {newsStats.latest_digest ? (newsStats.latest_digest.status === 'ready' ? '✅' : '⏳') : '—'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, tone }: { label: string; value: string | number; tone: 'default' | 'accent' | 'success' | 'danger' }) {
  const valueTone =
    tone === 'accent'
      ? 'text-accent'
      : tone === 'success'
        ? 'text-success'
        : tone === 'danger'
          ? 'text-danger'
          : 'text-tx'

  return (
    <div className={`${panelClassName} px-5 py-5`}>
      <div className="text-[11px] uppercase tracking-[0.18em] text-tx-faint">{label}</div>
      <p className={`mt-3 text-3xl font-semibold tracking-[-0.04em] ${valueTone}`}>{value}</p>
    </div>
  )
}
