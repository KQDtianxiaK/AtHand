import { useState } from 'react'
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

function ProtectedLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const token = localStorage.getItem('token')

  if (!token) return <Navigate to="/login" replace />

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
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
