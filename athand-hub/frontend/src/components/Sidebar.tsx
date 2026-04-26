import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'
import { getLatestDigest } from '../api/client'

const navItems = [
  { to: '/', label: '仪表盘', icon: '📊' },
  { to: '/agents', label: 'AI 管控', icon: '🤖' },
  { to: '/todos', label: '待办事项', icon: '✅' },
  { to: '/memos', label: '备忘录', icon: '📝' },
  { to: '/clock', label: '打卡', icon: '⏰' },
  { to: '/email', label: '邮箱', icon: '📧' },
  { to: '/news', label: '新闻', icon: '📰' },
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
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={onClose} />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-56 border-r border-bd bg-surface transform transition-all duration-200 lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        } ${collapsed ? 'lg:w-0 lg:min-w-0 lg:overflow-hidden lg:border-r-0' : 'lg:w-56'}`}
      >
        <div className="p-4 border-b border-bd">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-xl font-bold text-blue-400">AtHand Hub</h1>
            <button
              onClick={onToggleCollapsed}
              className="hidden rounded-lg border border-bd px-2 py-1 text-xs text-tx-muted hover:text-tx-sub lg:inline-flex"
            >
              收起
            </button>
          </div>
        </div>
        <nav className="p-2 space-y-1 flex-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-blue-600/20 text-blue-400'
                    : 'text-tx-sub hover:bg-raised'
                }`
              }
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
              {item.to === '/news' && hasUnreadDigest && location.pathname !== '/news' && (
                <span className="ml-auto w-2 h-2 rounded-full bg-red-500" />
              )}
            </NavLink>
          ))}
        </nav>
        <div className="p-2 border-t border-bd">
          <button
            onClick={toggle}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-tx-sub hover:bg-raised transition-colors"
          >
            <span>{theme === 'dark' ? '☀️' : '🌙'}</span>
            <span>{theme === 'dark' ? '浅色模式' : '深色模式'}</span>
          </button>
        </div>
      </aside>
    </>
  )
}
