import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'
import { getLatestDigest } from '../api/client'

type IconProps = {
  className?: string
}

function DashboardIcon({ className }: IconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4.5 5.5h6v6h-6zm9 0h6v10h-6zm-9 9h6v4h-6zm9 5h6v-2h-6z" />
    </svg>
  )
}

function AgentsIcon({ className }: IconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 3.75h6m-7.5 4.5h9A2.25 2.25 0 0 1 18.75 10.5v5.25A2.25 2.25 0 0 1 16.5 18h-9a2.25 2.25 0 0 1-2.25-2.25V10.5A2.25 2.25 0 0 1 7.5 8.25Zm1.5 4.5h.008v.008H9v-.008Zm6 0h.008v.008H15v-.008Zm-6 3h6" />
    </svg>
  )
}

function TodosIcon({ className }: IconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="m5.25 12 3 3 10.5-10.5M5.25 6.75h13.5M5.25 17.25h8.25" />
    </svg>
  )
}

function MemosIcon({ className }: IconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7.5 4.5h9A1.5 1.5 0 0 1 18 6v12.75l-3.75-2.25-3.75 2.25-3.75-2.25L3 18.75V6a1.5 1.5 0 0 1 1.5-1.5h3Zm1.5 4.5h6m-6 3h6m-6 3h3" />
    </svg>
  )
}

function ClockIcon({ className }: IconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6.75v5.25l3.75 2.25M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  )
}

function EmailIcon({ className }: IconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3.75 6.75h16.5v10.5H3.75zm0 0L12 13.5l8.25-6.75" />
    </svg>
  )
}

function NewsIcon({ className }: IconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5.25 6h11.25A1.5 1.5 0 0 1 18 7.5v9a1.5 1.5 0 0 1-1.5 1.5H7.5A2.25 2.25 0 0 1 5.25 15.75V6Zm0 0v9.75A2.25 2.25 0 0 0 7.5 18h10.5M8.25 9.75h6m-6 3h6m-6 3h3" />
    </svg>
  )
}

const navItems = [
  { to: '/', label: '仪表盘', icon: DashboardIcon },
  { to: '/agents', label: 'AI 管控', icon: AgentsIcon },
  { to: '/todos', label: '待办事项', icon: TodosIcon },
  { to: '/memos', label: '备忘录', icon: MemosIcon },
  { to: '/clock', label: '打卡', icon: ClockIcon },
  { to: '/email', label: '邮箱', icon: EmailIcon },
  { to: '/news', label: '新闻', icon: NewsIcon },
]

interface Props {
  open: boolean
  onClose: () => void
  collapsed: boolean
  onToggleCollapsed: () => void
}

export default function Sidebar({ open, onClose, collapsed, onToggleCollapsed }: Props) {
  const { theme, toggle } = useTheme()
  const location = useLocation()
  const [hasUnreadDigest, setHasUnreadDigest] = useState(false)

  useEffect(() => {
    const check = () => {
      getLatestDigest()
        .then((d) => setHasUnreadDigest(!!d && !d.is_read && d.status === 'ready'))
        .catch(() => {})
    }
    check()
    const timer = setInterval(check, 15000)
    return () => clearInterval(timer)
  }, [])

  return (
    <>
      {/* 手机遮罩 */}
      {open && (
        <div className="fixed inset-0 z-40 bg-brand/40 backdrop-blur-sm lg:hidden" onClick={onClose} />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-bd bg-surface/[0.88] backdrop-blur-2xl transition-all duration-200 lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        } ${collapsed ? 'lg:w-0 lg:min-w-0 lg:overflow-hidden lg:border-r-0' : 'lg:w-72'}`}
      >
        <div className="border-b border-bd px-4 py-4">
          <div className="rounded-[1.6rem] border border-bd bg-surface-elevated/[0.92] p-3 shadow-ambient">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[1.2rem] border border-accent/25 bg-accent-soft text-sm font-semibold tracking-[-0.06em] text-accent">
                  AH
                </div>
                <div className="min-w-0">
                  <h1 className="truncate text-sm font-semibold tracking-[-0.03em] text-tx">AtHand Hub</h1>
                  <p className="truncate text-[11px] text-tx-muted">Minimal AI workspace</p>
                </div>
              </div>
              <span className="hidden rounded-full border border-bd bg-page-soft px-2 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-tx-faint lg:inline-flex">
                Desk
              </span>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-tx-faint">Workspace</div>
                <div className="mt-1 text-sm text-tx-sub">聚合你的 AI、任务、时间和输入流。</div>
              </div>
              <button
                onClick={onToggleCollapsed}
                className="hidden rounded-2xl border border-bd bg-page/70 px-3 py-2 text-xs font-medium text-tx-muted hover:border-bd-strong hover:text-tx-sub lg:inline-flex"
              >
                收起
              </button>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <div className="mb-3 px-3 text-[11px] font-medium uppercase tracking-[0.2em] text-tx-faint">Navigation</div>
          <nav className="space-y-1.5">
            {navItems.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={onClose}
                  className={({ isActive }) =>
                    `group flex items-center gap-3 rounded-2xl border px-3 py-3 transition-all ${
                      isActive
                        ? 'border-accent/20 bg-accent-soft/90 text-brand shadow-float'
                        : 'border-transparent text-tx-sub hover:border-bd hover:bg-surface-elevated/85 hover:text-tx'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[1rem] border transition-all ${
                          isActive
                            ? 'border-accent/20 bg-surface-elevated/95 text-accent'
                            : 'border-transparent bg-page/50 text-tx-muted group-hover:border-bd group-hover:bg-surface-elevated/90 group-hover:text-tx-sub'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{item.label}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-tx-faint">
                          {item.to === '/' && '总览数据与摘要'}
                          {item.to === '/agents' && '看板与会话控制'}
                          {item.to === '/todos' && '执行清单'}
                          {item.to === '/memos' && '知识与记录'}
                          {item.to === '/clock' && '时间节奏'}
                          {item.to === '/email' && '邮件工作流'}
                          {item.to === '/news' && '订阅与总结'}
                        </span>
                      </span>
                      {item.to === '/news' && hasUnreadDigest && location.pathname !== '/news' && (
                        <span className="ml-auto h-2.5 w-2.5 rounded-full bg-accent" />
                      )}
                    </>
                  )}
                </NavLink>
              )
            })}
          </nav>
        </div>
        <div className="border-t border-bd px-3 py-3">
          <button
            onClick={toggle}
            className="flex w-full items-center gap-3 rounded-2xl border border-bd bg-surface-elevated/[0.82] px-3 py-3 text-tx-sub shadow-float transition-colors hover:border-bd-strong hover:text-tx"
          >
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-[1rem] border border-bd bg-page/60 text-sm">
              {theme === 'dark' ? '☀' : '◐'}
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-sm font-medium">{theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}</span>
              <span className="mt-0.5 block text-[11px] text-tx-faint">当前主题：{theme === 'dark' ? 'Dark Desk' : 'Light Desk'}</span>
            </span>
          </button>
        </div>
      </aside>
    </>
  )
}
