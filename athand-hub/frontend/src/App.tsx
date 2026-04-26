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
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
      />
      <div className="relative flex min-w-0 flex-1 flex-col">
        {sidebarCollapsed && (
          <button
            onClick={() => setSidebarCollapsed(false)}
            className="fixed left-3 top-3 z-30 hidden rounded-lg border border-bd bg-surface/95 px-3 py-2 text-xs text-tx-sub shadow-lg backdrop-blur hover:text-tx lg:inline-flex"
          >
            展开 AtHand Hub 列表
          </button>
        )}
        {/* 顶栏 */}
        <header className="h-12 flex items-center px-4 border-b border-bd lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-tx-sub hover:text-tx"
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="ml-3 text-blue-400 font-bold">AtHand Hub</span>
        </header>
        <main className="flex-1 overflow-auto">
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
