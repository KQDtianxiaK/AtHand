import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login } from '../api/client'

export default function LoginPage() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(password)
      navigate('/')
    } catch (err: any) {
      setError(err.message || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-page">
      <form onSubmit={handleSubmit} className="w-80 bg-surface rounded-xl p-6 shadow-xl border border-bd">
        <h1 className="text-2xl font-bold text-center text-blue-400 mb-6">AtHand Hub</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="输入密码"
          className="w-full px-4 py-2 rounded-lg bg-raised text-tx border border-bd-strong focus:border-blue-500 focus:outline-none mb-4"
          autoFocus
        />
        {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading ? '登录中...' : '登录'}
        </button>
      </form>
    </div>
  )
}
