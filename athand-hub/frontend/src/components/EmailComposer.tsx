import { useState, useEffect, useRef } from 'react'
import type { EmailAccount, EmailDetail, EmailContact } from '../api/client'
import { sendEmailApi, getEmailContacts } from '../api/client'

// ---- 收件人输入框（带联系人自动补全）----
function AddrInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [suggestions, setSuggestions] = useState<EmailContact[]>([])
  const [showSug, setShowSug] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const inputCls = 'w-full px-3 py-2 bg-raised border border-bd text-tx text-sm focus:outline-none focus:border-blue-500'

  // 取最后一个未完成的地址作为搜索词
  const getActiveToken = (v: string) => {
    const parts = v.split(/[,;，；\s]+/)
    return parts[parts.length - 1].trim()
  }

  const handleChange = async (v: string) => {
    onChange(v)
    const token = getActiveToken(v)
    if (token.length >= 1) {
      try {
        const res = await getEmailContacts(token)
        setSuggestions(res.slice(0, 8))
        setShowSug(res.length > 0)
      } catch { setShowSug(false) }
    } else {
      setShowSug(false)
    }
  }

  const pick = (c: EmailContact) => {
    const parts = value.split(/[,;，；]+/)
    parts[parts.length - 1] = (c.name ? `${c.name} <${c.email}>` : c.email)
    onChange(parts.join(', ') + ', ')
    setShowSug(false)
  }

  // 点外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setShowSug(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={wrapRef} className="relative flex-1">
      <input
        className={inputCls + ' rounded-lg w-full'}
        value={value}
        onChange={e => handleChange(e.target.value)}
        onFocus={() => { if (suggestions.length) setShowSug(true) }}
        placeholder={placeholder}
      />
      {showSug && (
        <ul className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-surface border border-bd rounded-lg shadow-lg overflow-hidden">
          {suggestions.map(c => (
            <li
              key={c.id}
              onMouseDown={() => pick(c)}
              className="px-3 py-2 text-sm cursor-pointer hover:bg-raised flex items-center gap-2"
            >
              <span className="w-6 h-6 rounded-full bg-blue-600/20 text-blue-400 text-xs flex items-center justify-center shrink-0">
                {(c.name || c.email)[0].toUpperCase()}
              </span>
              <span className="flex-1 min-w-0">
                {c.name && <span className="text-tx font-medium">{c.name} </span>}
                <span className="text-tx-muted">{c.email}</span>
              </span>
              {c.send_count > 0 && <span className="text-xs text-tx-muted shrink-0">{c.send_count}次</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface Props {
  account: EmailAccount
  replyTo?: EmailDetail | null
  onSent: () => void
  onClose: () => void
}

export default function EmailComposer({ account, replyTo, onSent, onClose }: Props) {
  const [toAddrs, setToAddrs] = useState(replyTo ? replyTo.from_addr : '')
  const [ccAddrs, setCcAddrs] = useState('')
  const [subject, setSubject] = useState(replyTo ? `Re: ${replyTo.subject.replace(/^Re:\s*/i, '')}` : '')
  const [bodyText, setBodyText] = useState(replyTo ? `\n\n---\n${replyTo.from_name} <${replyTo.from_addr}> 写道:\n\n${replyTo.body_text}` : '')
  const [showCc, setShowCc] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const handleSend = async () => {
    const to = toAddrs.split(/[,;，；\s]+/).filter(Boolean)
    if (!to.length) { setError('请填写收件人'); return }
    if (!subject.trim()) { setError('请填写主题'); return }

    setSending(true)
    setError('')
    try {
      const cc = ccAddrs ? ccAddrs.split(/[,;，；\s]+/).filter(Boolean) : undefined
      await sendEmailApi({
        account_id: account.id,
        to_addrs: to,
        subject,
        body_text: bodyText,
        cc_addrs: cc,
        in_reply_to: replyTo?.message_id || undefined,
        references: replyTo?.references_header || undefined,
      })
      onSent()
    } catch (e: any) {
      setError(e.message)
    }
    setSending(false)
  }

  const inputCls = 'w-full px-3 py-2 bg-raised border border-bd text-tx text-sm focus:outline-none focus:border-blue-500'

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-bd">
        <h3 className="text-tx font-semibold">{replyTo ? '回复邮件' : '写邮件'}</h3>
        <div className="flex gap-2">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm text-tx-sub hover:bg-raised border border-bd">取消</button>
          <button onClick={handleSend} disabled={sending} className="px-4 py-1.5 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {sending ? '发送中...' : '发送'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-3">
        <div className="text-xs text-tx-sub">发件人：{account.display_name} &lt;{account.email}&gt;</div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-tx-sub w-14 shrink-0">收件人</label>
          <AddrInput value={toAddrs} onChange={setToAddrs} placeholder="多个地址用逗号分隔" />
          {!showCc && <button onClick={() => setShowCc(true)} className="text-xs text-blue-400 shrink-0">抄送</button>}
        </div>

        {showCc && (
          <div className="flex items-center gap-2">
            <label className="text-sm text-tx-sub w-14 shrink-0">抄送</label>
            <AddrInput value={ccAddrs} onChange={setCcAddrs} placeholder="多个地址用逗号分隔" />
          </div>
        )}

        <div className="flex items-center gap-2">
          <label className="text-sm text-tx-sub w-14 shrink-0">主题</label>
          <input className={inputCls + ' rounded-lg'} value={subject} onChange={e => setSubject(e.target.value)} />
        </div>

        <textarea
          className={inputCls + ' rounded-lg flex-1 min-h-[300px] resize-none font-mono'}
          value={bodyText}
          onChange={e => setBodyText(e.target.value)}
          placeholder="输入邮件内容..."
        />

        {error && <div className="text-sm text-red-400">{error}</div>}
      </div>
    </div>
  )
}
