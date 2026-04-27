import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import AssistantPanel from './components/AssistantPanel'
import Sidebar from './components/Sidebar'
import { ThemeProvider } from './context/ThemeContext'
import AgentsPage from './pages/AgentsPage'
import ClockPage from './pages/ClockPage'
import DashboardPage from './pages/DashboardPage'
import LoginPage from './pages/LoginPage'
import MemosPage from './pages/MemosPage'
import TodosPage from './pages/TodosPage'
import EmailPage from './pages/EmailPage'
import NewsPage from './pages/NewsPage'

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'athand.sidebar.collapsed'

function readStoredFlag(key: string, fallback = false) {
  if (typeof window === 'undefined') return fallback
  try {
    const value = window.localStorage.getItem(key)
    if (value == null) return fallback
    return value === '1'
  } catch {
    return fallback
  }
}

function ProtectedLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readStoredFlag(SIDEBAR_COLLAPSED_STORAGE_KEY))
  const token = localStorage.getItem('token')

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed ? '1' : '0')
    } catch {
      // Ignore storage failures and keep the toggle local to the current render.
    }
  }, [sidebarCollapsed])

  if (!token) return <Navigate to="/login" replace />

  return (
    <div className="flex h-screen overflow-hidden bg-page text-tx">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
      />
      <div className="relative flex min-w-0 flex-1 flex-col bg-page/70">
        {sidebarCollapsed && (
          <button
            onClick={() => setSidebarCollapsed(false)}
            className="fixed left-4 top-4 z-30 hidden items-center gap-2 rounded-2xl border border-bd bg-surface/[0.92] px-3 py-2 text-xs font-medium text-tx-sub shadow-float backdrop-blur-xl hover:border-bd-strong hover:text-tx lg:inline-flex"
          >
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-xl border border-accent/20 bg-accent-soft text-accent">AH</span>
            展开 AtHand Hub 列表
          </button>
        )}
        {/* 顶栏 */}
        <header className="flex h-14 items-center border-b border-bd bg-surface/[0.82] px-4 backdrop-blur-xl lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-bd bg-surface-elevated/80 text-tx-sub hover:border-bd-strong hover:text-tx"
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="ml-3 flex min-w-0 items-center gap-3">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-2xl border border-accent/20 bg-accent-soft text-sm font-semibold tracking-[-0.04em] text-accent">AH</span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold tracking-[-0.03em] text-tx">AtHand Hub</div>
              <div className="truncate text-[11px] text-tx-muted">Minimal AI workspace</div>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-auto bg-page/30">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/todos" element={<TodosPage />} />
            <Route path="/memos" element={<MemosPage />} />
            <Route path="/clock" element={<ClockPage />} />
            <Route path="/email" element={<EmailPage />} />
            <Route path="/news" element={<NewsPage />} />
          </Routes>
        </main>
      </div>
      <AssistantPanel />
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/*" element={<ProtectedLayout />} />
      </Routes>
    </ThemeProvider>
  )
}
