import { useEffect, useRef, useState } from 'react'
import type { EmailAccount, EmailContact, EmailDetail } from '../api/client'
import { getEmailContacts, sendEmailApi } from '../api/client'

const shellPanelClass = 'rounded-[1.75rem] border border-bd bg-surface/[0.88] shadow-ambient backdrop-blur-xl'
const sectionCardClass = 'rounded-[1.35rem] border border-bd bg-page/[0.52]'
const insetCardClass = 'rounded-[1.1rem] border border-bd bg-page/[0.4]'
const fieldClass = 'w-full rounded-[1.05rem] border border-bd-strong bg-surface-elevated/[0.9] px-3 py-2.5 text-sm text-tx shadow-inset outline-none transition placeholder:text-tx-faint focus:border-accent/40 focus:ring-2 focus:ring-accent/10'
const secondaryButtonClass = 'rounded-[1rem] border border-bd bg-page/[0.55] px-3 py-2 text-xs font-medium text-tx-muted transition hover:border-bd-strong hover:bg-surface-elevated/[0.92] hover:text-tx-sub disabled:opacity-50'
const primaryButtonClass = 'rounded-[1rem] bg-accent px-3 py-2 text-xs font-medium text-white transition hover:bg-accent-strong disabled:opacity-50'

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}

function parseAddressList(value: string) {
  return value
    .split(/[;,，；\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function formatReplyDate(value: string | null) {
  if (!value) {
    return '时间未知'
  }

  return new Date(value).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function InlineNotice({ message }: { message: string }) {
  return (
    <div className="rounded-[1rem] border border-danger/20 bg-danger/10 px-3 py-2.5 text-xs leading-6 text-danger">
      {message}
    </div>
  )
}

function AddrInput({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  const [suggestions, setSuggestions] = useState<EmailContact[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const getActiveToken = (nextValue: string) => {
    const parts = nextValue.split(/[;,，；\n]+/)
    return parts[parts.length - 1]?.trim() ?? ''
  }

  const handleChange = async (nextValue: string) => {
    onChange(nextValue)
    const token = getActiveToken(nextValue)

    if (!token) {
      setShowSuggestions(false)
      return
    }

    try {
      const result = await getEmailContacts(token)
      setSuggestions(result.slice(0, 8))
      setShowSuggestions(result.length > 0)
    } catch {
      setShowSuggestions(false)
    }
  }

  const handlePick = (contact: EmailContact) => {
    const parts = value.split(/[;,，；\n]+/)
    parts[parts.length - 1] = contact.name ? `${contact.name} <${contact.email}>` : contact.email
    onChange(parts.map((item) => item.trim()).filter(Boolean).join(', ') + ', ')
    setShowSuggestions(false)
  }

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setShowSuggestions(false)
      }
    }

    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={wrapRef} className="relative min-w-0 flex-1">
      <input
        className={fieldClass}
        value={value}
        onChange={(event) => void handleChange(event.target.value)}
        onFocus={() => {
          if (suggestions.length > 0) {
            setShowSuggestions(true)
          }
        }}
        placeholder={placeholder}
      />

      {showSuggestions && (
        <ul className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-[1rem] border border-bd bg-surface/[0.98] shadow-float backdrop-blur-xl">
          {suggestions.map((contact) => (
            <li
              key={contact.id}
              onMouseDown={() => handlePick(contact)}
              className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm transition hover:bg-page/[0.72]"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-accent/15 bg-accent-soft text-xs font-medium text-accent">
                {(contact.name || contact.email).slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                {contact.name ? <span className="font-medium text-tx-sub">{contact.name} </span> : null}
                <span className="text-tx-muted">{contact.email}</span>
              </span>
              {contact.send_count > 0 ? <span className="text-[11px] text-tx-faint">{contact.send_count} 次</span> : null}
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
  const [toAddrs, setToAddrs] = useState('')
  const [ccAddrs, setCcAddrs] = useState('')
  const [subject, setSubject] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [showCc, setShowCc] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setToAddrs(replyTo ? replyTo.from_addr : '')
    setCcAddrs('')
    setSubject(replyTo ? `Re: ${replyTo.subject.replace(/^Re:\s*/i, '')}` : '')
    setBodyText(
      replyTo
        ? `\n\n---\n${replyTo.from_name || '原发件人'} <${replyTo.from_addr}> 写道：\n\n${replyTo.body_text}`
        : ''
    )
    setShowCc(false)
    setError(null)
  }, [account.id, replyTo])

  const toCount = parseAddressList(toAddrs).length
  const ccCount = parseAddressList(ccAddrs).length
  const excerpt = replyTo?.body_text.trim().slice(0, 260) || '原邮件正文为空。'

  const handleSend = async () => {
    const to = parseAddressList(toAddrs)
    if (to.length === 0) {
      setError('请至少填写一个收件人。')
      return
    }
    if (!subject.trim()) {
      setError('请填写主题。')
      return
    }

    setSending(true)
    setError(null)

    try {
      const cc = ccAddrs.trim() ? parseAddressList(ccAddrs) : undefined
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
    } catch (nextError) {
      setError(getErrorMessage(nextError, '发送邮件失败。'))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6 xl:grid xl:grid-cols-[minmax(0,1.12fr)_360px]">
      <section className={`flex min-h-[420px] min-w-0 flex-col overflow-hidden ${shellPanelClass}`}>
        <div className="border-b border-bd/70 px-5 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Mail Draft</div>
              <h2 className="mt-2 text-[1.8rem] font-semibold tracking-[-0.04em] text-tx">
                {replyTo ? '回复邮件' : '写新邮件'}
              </h2>
              <p className="mt-2 text-sm leading-7 text-tx-muted">
                把收件人、正文和发送动作收进同一条编辑主线里，保持和邮箱工作区一致的工作台节奏。
              </p>
            </div>

            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-full border border-accent/20 bg-accent-soft px-3 py-1.5 text-accent">
                {replyTo ? '回复模式' : '新建模式'}
              </span>
              <span className="rounded-full border border-bd bg-page/[0.55] px-3 py-1.5 text-tx-faint">
                {account.display_name || account.email}
              </span>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="space-y-5">
            {error ? <InlineNotice message={error} /> : null}

            <section className={`${sectionCardClass} p-4`}>
              <div className="grid gap-4">
                <div className="grid gap-2 lg:grid-cols-[92px_minmax(0,1fr)_auto] lg:items-center">
                  <label className="text-sm font-medium text-tx-sub">收件人</label>
                  <AddrInput value={toAddrs} onChange={setToAddrs} placeholder="多个地址请用逗号或分号分隔" />
                  <button onClick={() => setShowCc((value) => !value)} className={`${secondaryButtonClass} px-3 py-2.5`}>
                    {showCc ? '收起抄送' : '添加抄送'}
                  </button>
                </div>

                {showCc && (
                  <div className="grid gap-2 lg:grid-cols-[92px_minmax(0,1fr)] lg:items-center">
                    <label className="text-sm font-medium text-tx-sub">抄送</label>
                    <AddrInput value={ccAddrs} onChange={setCcAddrs} placeholder="可选，支持联系人补全" />
                  </div>
                )}

                <div className="grid gap-2 lg:grid-cols-[92px_minmax(0,1fr)] lg:items-center">
                  <label className="text-sm font-medium text-tx-sub">主题</label>
                  <input className={fieldClass} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="为这封邮件写一个清晰主题" />
                </div>

                <div className={`${insetCardClass} grid gap-3 px-4 py-3 text-xs text-tx-faint sm:grid-cols-3`}>
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.16em] text-tx-faintest">发件人</div>
                    <div className="mt-1 text-sm text-tx-sub">{account.display_name || account.email}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.16em] text-tx-faintest">收件人数</div>
                    <div className="mt-1 text-sm text-tx-sub">{toCount}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.16em] text-tx-faintest">抄送人数</div>
                    <div className="mt-1 text-sm text-tx-sub">{ccCount}</div>
                  </div>
                </div>
              </div>
            </section>

            <section className={`${sectionCardClass} flex min-h-[420px] flex-col p-4`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-tx-faint">Body</div>
                  <div className="mt-1 text-sm font-medium text-tx-sub">正文编辑区</div>
                </div>
                <div className="text-[11px] text-tx-faint">快捷键：Ctrl/Cmd + Enter</div>
              </div>

              <textarea
                className={`${fieldClass} mt-4 min-h-[320px] flex-1 resize-none leading-7`}
                value={bodyText}
                onChange={(event) => setBodyText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault()
                    void handleSend()
                  }
                }}
                placeholder="输入邮件正文。可以直接整理成简洁段落，也可以保留回复引用。"
              />
            </section>
          </div>
        </div>

        <div className="border-t border-bd/70 px-5 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs leading-6 text-tx-faint">
              发送成功后会返回邮箱工作区，并刷新当前文件夹邮件列表。
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button onClick={onClose} className={`${secondaryButtonClass} px-4 py-2.5 text-sm`}>
                取消
              </button>
              <button onClick={() => void handleSend()} disabled={sending} className={`${primaryButtonClass} px-4 py-2.5 text-sm`}>
                {sending ? '发送中...' : '发送邮件'}
              </button>
            </div>
          </div>
        </div>
      </section>

      <aside className={`flex min-h-[420px] flex-col overflow-hidden ${shellPanelClass}`}>
        <div className="border-b border-bd/70 px-5 py-5">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Dispatch Lane</div>
          <h3 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-tx">发送侧栏</h3>
          <p className="mt-2 text-sm leading-6 text-tx-muted">这里集中显示账号身份、回复上下文和发送前检查项。</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="space-y-4">
            <section className={`${sectionCardClass} p-4`}>
              <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-tx-faint">From Account</div>
              <div className="mt-2 text-base font-medium text-tx-sub">{account.display_name || account.email}</div>
              <div className="mt-1 text-sm text-tx-muted">{account.email}</div>
              <div className="mt-4 grid gap-3">
                <div className={`${insetCardClass} px-4 py-3`}>
                  <div className="text-[11px] uppercase tracking-[0.16em] text-tx-faint">SMTP</div>
                  <div className="mt-1 text-sm text-tx-sub">{account.smtp_host}:{account.smtp_port}</div>
                </div>
                <div className={`${insetCardClass} px-4 py-3`}>
                  <div className="text-[11px] uppercase tracking-[0.16em] text-tx-faint">同步节奏</div>
                  <div className="mt-1 text-sm text-tx-sub">每 {account.sync_interval_minutes} 分钟</div>
                </div>
              </div>
            </section>

            <section className={`${sectionCardClass} p-4`}>
              <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-tx-faint">Checklist</div>
              <div className="mt-3 space-y-3 text-sm">
                <div className={`${insetCardClass} px-4 py-3`}>
                  <div className="font-medium text-tx-sub">收件人</div>
                  <div className="mt-1 text-tx-muted">已填写 {toCount} 个主收件人{showCc ? `，${ccCount} 个抄送` : ''}。</div>
                </div>
                <div className={`${insetCardClass} px-4 py-3`}>
                  <div className="font-medium text-tx-sub">主题</div>
                  <div className="mt-1 text-tx-muted">{subject.trim() ? '主题已就绪，可以直接发送。' : '建议补一个清晰主题，方便后续搜索和归档。'}</div>
                </div>
                <div className={`${insetCardClass} px-4 py-3 text-xs leading-6 text-tx-faint`}>
                  联系人补全支持输入关键字后直接选取，发送快捷键为 Ctrl/Cmd + Enter。
                </div>
              </div>
            </section>

            <section className={`${sectionCardClass} p-4`}>
              <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-tx-faint">Reply Context</div>
              {replyTo ? (
                <div className="mt-3 space-y-3">
                  <div className={`${insetCardClass} px-4 py-3`}>
                    <div className="text-xs text-tx-faint">原始主题</div>
                    <div className="mt-1 text-sm font-medium text-tx-sub">{replyTo.subject || '无主题'}</div>
                  </div>
                  <div className={`${insetCardClass} px-4 py-3`}>
                    <div className="text-xs text-tx-faint">来信人</div>
                    <div className="mt-1 text-sm text-tx-sub">{replyTo.from_name || replyTo.from_addr}</div>
                    <div className="mt-1 text-xs text-tx-faint">{replyTo.from_addr} · {formatReplyDate(replyTo.date)}</div>
                  </div>
                  <div className={`${insetCardClass} px-4 py-3`}>
                    <div className="text-xs text-tx-faint">引用预览</div>
                    <p className="mt-2 text-sm leading-6 text-tx-muted">{excerpt}</p>
                  </div>
                </div>
              ) : (
                <div className={`${insetCardClass} mt-3 px-4 py-3 text-sm leading-6 text-tx-muted`}>
                  当前是新邮件模式。你可以先写正文，再随时返回邮箱工作区查看上下文或切换账号。
                </div>
              )}
            </section>
          </div>
        </div>
      </aside>
    </div>
  )
}