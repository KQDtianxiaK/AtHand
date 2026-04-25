import { useState, useEffect } from 'react'
import type { EmailAccount } from '../api/client'
import { createEmailAccount, updateEmailAccount, deleteEmailAccount, testEmailConnection } from '../api/client'

const PRESETS: Record<string, {
  imap_host: string; imap_port: number
  pop3_host: string; pop3_port: number
  smtp_host: string; smtp_port: number
}> = {
  'QQ邮箱': { imap_host: 'imap.qq.com', imap_port: 993, pop3_host: 'pop.qq.com', pop3_port: 995, smtp_host: 'smtp.qq.com', smtp_port: 465 },
  '163邮箱': { imap_host: 'imap.163.com', imap_port: 993, pop3_host: 'pop.163.com', pop3_port: 995, smtp_host: 'smtp.163.com', smtp_port: 465 },
  'Gmail': { imap_host: 'imap.gmail.com', imap_port: 993, pop3_host: 'pop.gmail.com', pop3_port: 995, smtp_host: 'smtp.gmail.com', smtp_port: 465 },
  'Outlook': { imap_host: 'outlook.office365.com', imap_port: 993, pop3_host: 'outlook.office365.com', pop3_port: 995, smtp_host: 'smtp.office365.com', smtp_port: 587 },
  '自定义': { imap_host: '', imap_port: 993, pop3_host: '', pop3_port: 995, smtp_host: '', smtp_port: 465 },
}

interface Props {
  open: boolean
  onClose: () => void
  onSaved: () => void
  account?: EmailAccount | null
}

export default function EmailAccountDialog({ open, onClose, onSaved, account }: Props) {
  const [preset, setPreset] = useState('自定义')
  const [form, setForm] = useState({
    email: '', display_name: '', username: '', password: '',
    protocol: 'imap' as 'imap' | 'pop3',
    imap_host: '', imap_port: 993,
    pop3_host: '', pop3_port: 995,
    smtp_host: '', smtp_port: 465,
    use_ssl: true, sync_interval_minutes: 5,
  })
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<Record<string, string> | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (account) {
      setForm({
        email: account.email,
        display_name: account.display_name,
        username: account.username,
        password: '',
        protocol: (account.protocol || 'imap') as 'imap' | 'pop3',
        imap_host: account.imap_host,
        imap_port: account.imap_port,
        pop3_host: account.pop3_host || '',
        pop3_port: account.pop3_port || 995,
        smtp_host: account.smtp_host,
        smtp_port: account.smtp_port,
        use_ssl: account.use_ssl,
        sync_interval_minutes: account.sync_interval_minutes,
      })
    } else {
      setForm({ email: '', display_name: '', username: '', password: '', protocol: 'imap', imap_host: '', imap_port: 993, pop3_host: '', pop3_port: 995, smtp_host: '', smtp_port: 465, use_ssl: true, sync_interval_minutes: 5 })
    }
    setTestResult(null)
    setError('')
  }, [account, open])

  const applyPreset = (name: string) => {
    setPreset(name)
    const p = PRESETS[name]
    if (p) setForm(f => ({ ...f, ...p }))
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await testEmailConnection({
        protocol: form.protocol,
        imap_host: form.imap_host, imap_port: form.imap_port,
        pop3_host: form.pop3_host, pop3_port: form.pop3_port,
        smtp_host: form.smtp_host, smtp_port: form.smtp_port,
        username: form.username, password: form.password,
        use_ssl: form.use_ssl,
      })
      setTestResult(res)
    } catch (e: any) {
      setTestResult({ [form.protocol]: 'error', smtp: e.message })
    }
    setTesting(false)
  }

  const handleSave = async () => {
    if (!form.email || !form.username || (!form.password && !account)) {
      setError('请填写完整信息')
      return
    }
    setSaving(true)
    setError('')
    try {
      if (account) {
        const body: Record<string, unknown> = { ...form }
        if (!form.password) delete body.password
        await updateEmailAccount(account.id, body)
      } else {
        await createEmailAccount(form)
      }
      onSaved()
      onClose()
    } catch (e: any) {
      setError(e.message)
    }
    setSaving(false)
  }

  const handleDelete = async () => {
    if (!account) return
    if (!confirm('确定删除此邮箱账号？所有同步的邮件数据将被删除。')) return
    try {
      await deleteEmailAccount(account.id)
      onSaved()
      onClose()
    } catch (e: any) {
      setError(e.message)
    }
  }

  if (!open) return null

  const inputCls = 'w-full px-3 py-2 rounded-lg bg-raised border border-bd text-tx text-sm focus:outline-none focus:border-blue-500'
  const labelCls = 'block text-sm text-tx-sub mb-1'

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-bd w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-tx mb-4">{account ? '编辑邮箱账号' : '添加邮箱账号'}</h2>

        {/* 预设 */}
        {!account && (
          <div className="mb-4">
            <label className={labelCls}>邮箱类型</label>
            <div className="flex flex-wrap gap-2">
              {Object.keys(PRESETS).map(name => (
                <button key={name} onClick={() => applyPreset(name)}
                  className={`px-3 py-1 rounded-lg text-sm border transition-colors ${preset === name ? 'bg-blue-600 text-white border-blue-600' : 'border-bd text-tx-sub hover:bg-raised'}`}
                >{name}</button>
              ))}
            </div>
          </div>
        )}

        {/* 协议切换 */}
        <div className="mb-4">
          <label className={labelCls}>收信协议</label>
          <div className="flex gap-2">
            {(['imap', 'pop3'] as const).map(p => (
              <button key={p} onClick={() => setForm(f => ({ ...f, protocol: p }))}
                className={`px-4 py-1.5 rounded-lg text-sm border transition-colors ${
                  form.protocol === p ? 'bg-blue-600 text-white border-blue-600' : 'border-bd text-tx-sub hover:bg-raised'
                }`}
              >{p.toUpperCase()}</button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className={labelCls}>邮箱地址</label>
            <input className={inputCls} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="you@example.com" />
          </div>
          <div>
            <label className={labelCls}>显示名称</label>
            <input className={inputCls} value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} placeholder="可选" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>用户名</label>
              <input className={inputCls} value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="通常为邮箱地址" />
            </div>
            <div>
              <label className={labelCls}>密码 / 授权码</label>
              <input className={inputCls} type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder={account ? '留空不修改' : '输入密码'} />
            </div>
          </div>
          {form.protocol === 'imap' ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>IMAP 服务器</label>
                <input className={inputCls} value={form.imap_host} onChange={e => setForm(f => ({ ...f, imap_host: e.target.value }))} />
              </div>
              <div>
                <label className={labelCls}>IMAP 端口</label>
                <input className={inputCls} type="number" value={form.imap_port} onChange={e => setForm(f => ({ ...f, imap_port: Number(e.target.value) }))} />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>POP3 服务器</label>
                <input className={inputCls} value={form.pop3_host} onChange={e => setForm(f => ({ ...f, pop3_host: e.target.value }))} />
              </div>
              <div>
                <label className={labelCls}>POP3 端口</label>
                <input className={inputCls} type="number" value={form.pop3_port} onChange={e => setForm(f => ({ ...f, pop3_port: Number(e.target.value) }))} />
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>SMTP 服务器</label>
              <input className={inputCls} value={form.smtp_host} onChange={e => setForm(f => ({ ...f, smtp_host: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>SMTP 端口</label>
              <input className={inputCls} type="number" value={form.smtp_port} onChange={e => setForm(f => ({ ...f, smtp_port: Number(e.target.value) }))} />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-tx-sub">
              <input type="checkbox" checked={form.use_ssl} onChange={e => setForm(f => ({ ...f, use_ssl: e.target.checked }))} className="rounded" />
              使用 SSL
            </label>
            <div className="flex items-center gap-2">
              <label className="text-sm text-tx-sub">同步间隔(分钟)</label>
              <input className="w-16 px-2 py-1 rounded bg-raised border border-bd text-tx text-sm" type="number" min={1} value={form.sync_interval_minutes} onChange={e => setForm(f => ({ ...f, sync_interval_minutes: Number(e.target.value) }))} />
            </div>
          </div>
        </div>

        {/* 测试结果 */}
        {testResult && (
          <div className="mt-3 p-3 rounded-lg bg-raised text-sm space-y-1">
            {Object.entries(testResult).map(([k, v]) => (
              <div key={k}>{k.toUpperCase()}: <span className={v === 'ok' ? 'text-green-400' : 'text-red-400'}>{v}</span></div>
            ))}
          </div>
        )}

        {error && <div className="mt-3 text-sm text-red-400">{error}</div>}

        <div className="mt-5 flex gap-3">
          <button onClick={handleTest} disabled={testing} className="px-4 py-2 rounded-lg bg-raised border border-bd text-tx-sub hover:bg-blue-600/20 text-sm disabled:opacity-50">
            {testing ? '测试中...' : '测试连接'}
          </button>
          <div className="flex-1" />
          {account && (
            <button onClick={handleDelete} className="px-4 py-2 rounded-lg text-red-400 hover:bg-red-600/20 text-sm">删除</button>
          )}
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-raised border border-bd text-tx-sub text-sm">取消</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50">
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
