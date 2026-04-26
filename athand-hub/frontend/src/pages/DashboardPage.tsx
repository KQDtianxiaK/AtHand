import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DailyWorkHours, getStats, StatsOverview, getNewsStats, type NewsStats } from '../api/client'

// ---- 分段堆叠柱状图 ----
function SegmentedBarChart({ data }: { data: DailyWorkHours[] }) {
  const maxH = Math.max(...data.map((d) => d.total), 1)
  return (
    <div className="flex items-end gap-1.5 h-36">
      {data.map((d) => {
        const totalPct = (d.total / maxH) * 100
        const mPct = d.total > 0 ? (d.morning / d.total) * 100 : 0
        const aPct = d.total > 0 ? (d.afternoon / d.total) * 100 : 0
        const ePct = d.total > 0 ? (d.evening / d.total) * 100 : 100  // fill rest
        return (
          <div key={d.day} className="flex-1 flex flex-col items-center gap-1 min-w-0">
            {d.total > 0 && (
              <span className="text-[10px] text-tx-muted tabular-nums">{d.total.toFixed(1)}</span>
            )}
            <div
              className="w-full rounded-t overflow-hidden flex flex-col-reverse"
              style={{ height: `${Math.max(totalPct, d.total > 0 ? 4 : 0)}%`, minHeight: d.total > 0 ? 4 : 0 }}
              title={`上午${d.morning.toFixed(1)}h 下午${d.afternoon.toFixed(1)}h 晚上${d.evening.toFixed(1)}h`}
            >
              {d.evening > 0 && (
                <div className="w-full bg-purple-500" style={{ height: `${ePct}%` }} />
              )}
              {d.afternoon > 0 && (
                <div className="w-full bg-blue-500" style={{ height: `${aPct}%` }} />
              )}
              {d.morning > 0 && (
                <div className="w-full bg-amber-500" style={{ height: `${mPct}%` }} />
              )}
              {d.total === 0 && <div className="w-full h-1 bg-bd rounded-t" />}
            </div>
            <span className="text-[10px] text-tx-faint truncate w-full text-center">
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
      <path d={area} fill="#3b82f6" fillOpacity={0.12} />
      {/* line */}
      <polyline points={pts} fill="none" stroke="#3b82f6" strokeWidth={2} strokeLinejoin="round" />
      {/* dots */}
      {data.map((d, i) => (
        <circle key={d.day} cx={x(i)} cy={y(d.total)} r={3} fill="#3b82f6" />
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
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-bold text-tx">仪表盘</h2>

      {/* 概览卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="总会话" value={stats.total_tasks} />
        <StatCard label="成功" value={stats.done_tasks} color="text-green-400" />
        <StatCard label="失败" value={stats.failed_tasks} color="text-red-400" />
        <StatCard label="成功率" value={`${stats.success_rate}%`} color="text-blue-400" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 每日任务趋势 */}
        <div className="bg-surface rounded-xl p-4">
          <h3 className="text-base font-semibold text-tx mb-3">近 7 天会话数</h3>
          <div className="flex items-end gap-2 h-32">
            {stats.daily_tasks.map((d) => {
              const max = Math.max(...stats.daily_tasks.map((x) => x.count), 1)
              const h = (d.count / max) * 100
              return (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs text-tx-muted">{d.count}</span>
                  <div
                    className="w-full bg-blue-500 rounded-t"
                    style={{ height: `${h}%`, minHeight: d.count > 0 ? 4 : 0 }}
                  />
                  <span className="text-xs text-tx-faint">{d.day.slice(5)}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* 工时总览 */}
        <div className="bg-surface rounded-xl p-4">
          <h3 className="text-base font-semibold text-tx mb-1">近 7 天工时</h3>
          <p className="text-4xl font-bold text-blue-400">{stats.total_work_hours}h</p>
          <p className="text-sm text-tx-muted mt-1 mb-3">日均 {(stats.total_work_hours / 7).toFixed(1)}h</p>
          {/* 图例 */}
          <div className="flex gap-4 text-xs text-tx-muted">
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-500" />上午</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-500" />下午</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-purple-500" />晚上</span>
          </div>
        </div>
      </div>

      {/* 每日分段工时柱状图 */}
      <div className="bg-surface rounded-xl p-4">
        <h3 className="text-base font-semibold text-tx mb-3">每日工时（分段堆叠）</h3>
        <SegmentedBarChart data={stats.daily_work_hours} />
        <div className="flex gap-4 text-xs text-tx-muted mt-2">
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-500" />上午</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-500" />下午</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-purple-500" />晚上</span>
        </div>
      </div>

      {/* 工时折线趋势图 */}
      <div className="bg-surface rounded-xl p-4">
        <h3 className="text-base font-semibold text-tx mb-3">工时趋势</h3>
        <LineChart data={stats.daily_work_hours} />
      </div>

      {/* 各机器使用量 */}
      {stats.machine_tasks.length > 0 && (
        <div className="bg-surface rounded-xl p-4">
          <h3 className="text-base font-semibold text-tx mb-3">各机器会话分布</h3>
          <div className="space-y-2">
            {stats.machine_tasks.map((m) => {
              const max = Math.max(...stats.machine_tasks.map((x) => x.count), 1)
              return (
                <div key={m.machine_id} className="flex items-center gap-3">
                  <span className="w-24 text-sm text-tx-sub truncate">{m.machine_id}</span>
                  <div className="flex-1 bg-raised rounded h-4">
                    <div
                      className="bg-blue-500 rounded h-4"
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
        <div className="bg-surface rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold text-tx">📰 新闻动态</h3>
            <button onClick={() => navigate('/news')} className="text-sm text-blue-400 hover:underline">查看全部</button>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-tx-muted">今日新闻</p>
              <p className="text-2xl font-bold text-tx">{newsStats.today_count}</p>
            </div>
            <div>
              <p className="text-sm text-tx-muted">信息源</p>
              <p className="text-2xl font-bold text-tx">{newsStats.source_count}</p>
            </div>
            <div>
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

function StatCard({ label, value, color = 'text-tx' }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-surface rounded-xl p-4">
      <p className="text-sm text-tx-muted">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  )
}
