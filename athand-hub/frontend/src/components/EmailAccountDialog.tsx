import { useEffect, useState } from 'react'
import type { EmailAccount } from '../api/client'
import { createEmailAccount, deleteEmailAccount, testEmailConnection, updateEmailAccount } from '../api/client'

const PRESETS: Record<string, {
  imap_host: string
  imap_port: number
  pop3_host: string
  pop3_port: number
  smtp_host: string
  smtp_port: number
}> = {
  QQ邮箱: { imap_host: 'imap.qq.com', imap_port: 993, pop3_host: 'pop.qq.com', pop3_port: 995, smtp_host: 'smtp.qq.com', smtp_port: 465 },
  '163邮箱': { imap_host: 'imap.163.com', imap_port: 993, pop3_host: 'pop.163.com', pop3_port: 995, smtp_host: 'smtp.163.com', smtp_port: 465 },
  Gmail: { imap_host: 'imap.gmail.com', imap_port: 993, pop3_host: 'pop.gmail.com', pop3_port: 995, smtp_host: 'smtp.gmail.com', smtp_port: 465 },
  Outlook: { imap_host: 'outlook.office365.com', imap_port: 993, pop3_host: 'outlook.office365.com', pop3_port: 995, smtp_host: 'smtp.office365.com', smtp_port: 587 },
  自定义: { imap_host: '', imap_port: 993, pop3_host: '', pop3_port: 995, smtp_host: '', smtp_port: 465 },
}

type AccountProtocol = 'imap' | 'pop3'

type AccountForm = {
  email: string
  display_name: string
  username: string
  password: string
  protocol: AccountProtocol
  imap_host: string
  imap_port: number
  pop3_host: string
  pop3_port: number
  smtp_host: string
  smtp_port: number
  use_ssl: boolean
  sync_interval_minutes: number
}

const EMPTY_FORM: AccountForm = {
  email: '',
  display_name: '',
  username: '',
  password: '',
  protocol: 'imap',
  imap_host: '',
  imap_port: 993,
  pop3_host: '',
  pop3_port: 995,
  smtp_host: '',
  smtp_port: 465,
  use_ssl: true,
  sync_interval_minutes: 5,
}

const modalShellClass = 'w-full max-w-6xl rounded-[1.75rem] border border-bd bg-surface/[0.98] shadow-float backdrop-blur-xl'
const sectionCardClass = 'rounded-[1.3rem] border border-bd bg-page/[0.52]'
const insetCardClass = 'rounded-[1.05rem] border border-bd bg-page/[0.4]'
const fieldClass = 'w-full rounded-[1rem] border border-bd-strong bg-surface-elevated/[0.92] px-3 py-2.5 text-sm text-tx shadow-inset outline-none transition placeholder:text-tx-faint focus:border-accent/40 focus:ring-2 focus:ring-accent/10'
const secondaryButtonClass = 'rounded-[1rem] border border-bd bg-page/[0.55] px-3 py-2 text-xs font-medium text-tx-muted transition hover:border-bd-strong hover:bg-surface-elevated/[0.92] hover:text-tx-sub disabled:opacity-50'
const primaryButtonClass = 'rounded-[1rem] bg-accent px-3 py-2 text-xs font-medium text-white transition hover:bg-accent-strong disabled:opacity-50'

type NoticeTone = 'info' | 'success' | 'error'

interface Props {
  open: boolean
  onClose: () => void
  onSaved: () => void
  account?: EmailAccount | null
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}

function inferPreset(form: AccountForm) {
  const matched = Object.entries(PRESETS).find(([name, preset]) => {
    if (name === '自定义') {
      return false
    }
    return (
      preset.imap_host === form.imap_host
      && preset.imap_port === form.imap_port
      && preset.pop3_host === form.pop3_host
      && preset.pop3_port === form.pop3_port
      && preset.smtp_host === form.smtp_host
      && preset.smtp_port === form.smtp_port
    )
  })

  return matched?.[0] ?? '自定义'
}

function InlineNotice({ tone, message }: { tone: NoticeTone; message: string }) {
  const toneClass =
    tone === 'success'
      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700'
      : tone === 'info'
        ? 'border-accent/20 bg-accent-soft/[0.82] text-accent'
        : 'border-danger/20 bg-danger/10 text-danger'

  return <div className={`rounded-[1rem] border px-3 py-2.5 text-xs leading-6 ${toneClass}`}>{message}</div>
}

function SectionHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">{eyebrow}</div>
      <h3 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-tx">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-tx-muted">{description}</p>
    </div>
  )
}

function TestResultRow({ label, value }: { label: string; value: string }) {
  const isOk = value === 'ok'
  return (
    <div className={`${insetCardClass} flex items-center justify-between gap-3 px-4 py-3`}>
      <div>
        <div className="text-[11px] uppercase tracking-[0.16em] text-tx-faint">{label}</div>
        <div className="mt-1 text-sm text-tx-sub">{isOk ? '连接正常' : value}</div>
      </div>
      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${isOk ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700' : 'border-danger/20 bg-danger/10 text-danger'}`}>
        {isOk ? 'OK' : '异常'}
      </span>
    </div>
  )
}

export default function EmailAccountDialog({ open, onClose, onSaved, account }: Props) {
  const [preset, setPreset] = useState('自定义')
  const [form, setForm] = useState<AccountForm>(EMPTY_FORM)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<Record<string, string> | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEditing = Boolean(account)
  const protocolLabel = form.protocol === 'imap' ? 'IMAP' : 'POP3'
  const canTest = Boolean(
    form.username.trim()
    && form.password.trim()
    && form.smtp_host.trim()
    && (form.protocol === 'imap' ? form.imap_host.trim() : form.pop3_host.trim())
  )

  useEffect(() => {
    if (!open) {
      return
    }

    if (account) {
      const nextForm: AccountForm = {
        email: account.email,
        display_name: account.display_name,
        username: account.username,
        password: '',
        protocol: (account.protocol || 'imap') as AccountProtocol,
        imap_host: account.imap_host,
        imap_port: account.imap_port,
        pop3_host: account.pop3_host || '',
        pop3_port: account.pop3_port || 995,
        smtp_host: account.smtp_host,
        smtp_port: account.smtp_port,
        use_ssl: account.use_ssl,
        sync_interval_minutes: account.sync_interval_minutes,
      }
      setForm(nextForm)
      setPreset(inferPreset(nextForm))
    } else {
      setForm(EMPTY_FORM)
      setPreset('自定义')
    }

    setTestResult(null)
    setError(null)
  }, [account, open])

  useEffect(() => {
    if (!open) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  const updateForm = <K extends keyof AccountForm>(key: K, value: AccountForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const applyPreset = (name: string) => {
    const selectedPreset = PRESETS[name]
    setPreset(name)
    if (!selectedPreset) {
      return
    }
    setForm((current) => ({ ...current, ...selectedPreset }))
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    setError(null)

    try {
      const result = await testEmailConnection({
        protocol: form.protocol,
        imap_host: form.imap_host,
        imap_port: form.imap_port,
        pop3_host: form.pop3_host,
        pop3_port: form.pop3_port,
        smtp_host: form.smtp_host,
        smtp_port: form.smtp_port,
        username: form.username,
        password: form.password,
        use_ssl: form.use_ssl,
      })
      setTestResult(result)
    } catch (nextError) {
      setError(getErrorMessage(nextError, '测试连接失败。'))
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    if (!form.email.trim() || !form.username.trim() || (!form.password.trim() && !account)) {
      setError('请填写邮箱地址、用户名，以及密码或授权码。')
      return
    }

    setSaving(true)
    setError(null)

    try {
      if (account) {
        const body: Record<string, unknown> = { ...form }
        if (!form.password.trim()) {
          delete body.password
        }
        await updateEmailAccount(account.id, body)
      } else {
        await createEmailAccount(form)
      }
      onSaved()
      onClose()
    } catch (nextError) {
      setError(getErrorMessage(nextError, '保存邮箱账号失败。'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!account) {
      return
    }
    if (!confirm('确定删除此邮箱账号？所有同步的邮件数据将被删除。')) {
      return
    }

    setError(null)

    try {
      await deleteEmailAccount(account.id)
      onSaved()
      onClose()
    } catch (nextError) {
      setError(getErrorMessage(nextError, '删除邮箱账号失败。'))
    }
  }

  if (!open) {
    return null
  }

  const connectionSummary = [
    {
      label: '发件身份',
      value: form.email.trim() || '未填写邮箱地址',
      detail: form.display_name.trim() || '将作为收件人看到的显示名称',
    },
    {
      label: '收信协议',
      value: protocolLabel,
      detail: form.protocol === 'imap' ? '适合多端同步和文件夹管理' : '适合轻量拉取收件箱',
    },
    {
      label: 'SMTP 出站',
      value: form.smtp_host.trim() ? `${form.smtp_host}:${form.smtp_port}` : '未配置',
      detail: '所有写信、回复和转发都依赖这里发送',
    },
    {
      label: '同步节奏',
      value: `${form.sync_interval_minutes} 分钟`,
      detail: form.use_ssl ? '使用 SSL 安全连接' : '使用非 SSL 连接',
    },
  ]

  return (
    <div className="fixed inset-0 z-50 bg-ink/45 px-4 py-6 backdrop-blur-sm" onClick={onClose}>
      <div className="mx-auto flex h-full max-w-6xl items-center justify-center">
        <div className={`${modalShellClass} flex max-h-full flex-col overflow-hidden`} onClick={(event) => event.stopPropagation()}>
          <div className="border-b border-bd/70 px-6 py-5 lg:px-7">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Account Setup</div>
                <h2 className="mt-2 text-[1.9rem] font-semibold tracking-[-0.04em] text-tx">
                  {isEditing ? '编辑邮箱账号' : '添加邮箱账号'}
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-tx-muted">
                  把收信协议、发信通道和同步节奏统一在同一张配置卡里。保存后，邮箱工作区会继续沿用这里的账号设置。
                </p>
              </div>

              <div className="flex flex-wrap gap-2 text-[11px]">
                <span className="rounded-full border border-accent/20 bg-accent-soft px-3 py-1.5 text-accent">
                  {isEditing ? '已有账号' : '新账号'}
                </span>
                <span className="rounded-full border border-bd bg-page/[0.55] px-3 py-1.5 text-tx-faint">
                  {form.protocol.toUpperCase()}
                </span>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-6 lg:px-7">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.12fr)_minmax(320px,0.88fr)]">
              <div className="space-y-6">
                {!isEditing && (
                  <section className={`${sectionCardClass} p-4 md:p-5`}>
                    <SectionHeader
                      eyebrow="Presets"
                      title="常见邮箱预设"
                      description="先选一个常见服务商，后面仍然可以手动微调端口和服务器地址。"
                    />
                    <div className="mt-4 flex flex-wrap gap-2.5">
                      {Object.keys(PRESETS).map((name) => {
                        const active = preset === name
                        return (
                          <button
                            key={name}
                            onClick={() => applyPreset(name)}
                            className={`rounded-full border px-3.5 py-2 text-xs font-medium transition ${active ? 'border-accent/20 bg-accent-soft text-accent' : 'border-bd bg-page/[0.6] text-tx-muted hover:border-bd-strong hover:bg-surface-elevated/[0.92] hover:text-tx-sub'}`}
                          >
                            {name}
                          </button>
                        )
                      })}
                    </div>
                  </section>
                )}

                <section className={`${sectionCardClass} p-4 md:p-5`}>
                  <SectionHeader
                    eyebrow="Identity"
                    title="账号身份与收信协议"
                    description="这里决定邮箱在工作流中的身份，以及读取邮件时采用的协议。"
                  />

                  <div className="mt-5 space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-xs text-tx-muted">邮箱地址</label>
                        <input className={fieldClass} value={form.email} onChange={(event) => updateForm('email', event.target.value)} placeholder="you@example.com" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs text-tx-muted">显示名称</label>
                        <input className={fieldClass} value={form.display_name} onChange={(event) => updateForm('display_name', event.target.value)} placeholder="收件人看到的名字" />
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-xs text-tx-muted">用户名</label>
                        <input className={fieldClass} value={form.username} onChange={(event) => updateForm('username', event.target.value)} placeholder="通常与邮箱地址一致" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs text-tx-muted">密码 / 授权码</label>
                        <input
                          className={fieldClass}
                          type="password"
                          value={form.password}
                          onChange={(event) => updateForm('password', event.target.value)}
                          placeholder={isEditing ? '留空表示不修改' : '用于收发件的密码或授权码'}
                        />
                      </div>
                    </div>

                    <div className={`${insetCardClass} px-4 py-4`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-tx-muted">收信协议</span>
                        {(['imap', 'pop3'] as const).map((protocol) => {
                          const active = form.protocol === protocol
                          return (
                            <button
                              key={protocol}
                              onClick={() => updateForm('protocol', protocol)}
                              className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${active ? 'border-accent/20 bg-accent-soft text-accent' : 'border-bd bg-page/[0.7] text-tx-muted hover:border-bd-strong hover:bg-surface-elevated/[0.92] hover:text-tx-sub'}`}
                            >
                              {protocol.toUpperCase()}
                            </button>
                          )
                        })}
                      </div>
                      <p className="mt-3 text-xs leading-6 text-tx-faint">
                        {form.protocol === 'imap'
                          ? 'IMAP 适合在多端保持同一份文件夹状态和已读状态。'
                          : 'POP3 更偏向拉取收件箱内容，适合简单归档场景。'}
                      </p>
                    </div>
                  </div>
                </section>

                <section className={`${sectionCardClass} p-4 md:p-5`}>
                  <SectionHeader
                    eyebrow="Transport"
                    title="服务器与同步设置"
                    description="收信入口和 SMTP 出站保持在同一屏，避免保存前来回切换。"
                  />

                  <div className="mt-5 space-y-4">
                    {form.protocol === 'imap' ? (
                      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_150px]">
                        <div className="space-y-2">
                          <label className="text-xs text-tx-muted">IMAP 服务器</label>
                          <input className={fieldClass} value={form.imap_host} onChange={(event) => updateForm('imap_host', event.target.value)} placeholder="imap.example.com" />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs text-tx-muted">IMAP 端口</label>
                          <input className={fieldClass} type="number" value={form.imap_port} onChange={(event) => updateForm('imap_port', Number(event.target.value))} />
                        </div>
                      </div>
                    ) : (
                      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_150px]">
                        <div className="space-y-2">
                          <label className="text-xs text-tx-muted">POP3 服务器</label>
                          <input className={fieldClass} value={form.pop3_host} onChange={(event) => updateForm('pop3_host', event.target.value)} placeholder="pop.example.com" />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs text-tx-muted">POP3 端口</label>
                          <input className={fieldClass} type="number" value={form.pop3_port} onChange={(event) => updateForm('pop3_port', Number(event.target.value))} />
                        </div>
                      </div>
                    )}

                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_150px]">
                      <div className="space-y-2">
                        <label className="text-xs text-tx-muted">SMTP 服务器</label>
                        <input className={fieldClass} value={form.smtp_host} onChange={(event) => updateForm('smtp_host', event.target.value)} placeholder="smtp.example.com" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs text-tx-muted">SMTP 端口</label>
                        <input className={fieldClass} type="number" value={form.smtp_port} onChange={(event) => updateForm('smtp_port', Number(event.target.value))} />
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className={`${insetCardClass} flex items-center justify-between gap-3 px-4 py-3`}>
                        <div>
                          <div className="text-xs text-tx-sub">安全连接</div>
                          <div className="mt-1 text-xs leading-6 text-tx-faint">推荐保持 SSL 打开，避免明文传输。</div>
                        </div>
                        <button
                          onClick={() => updateForm('use_ssl', !form.use_ssl)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${form.use_ssl ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700' : 'border-bd bg-page/[0.7] text-tx-muted hover:border-bd-strong hover:text-tx-sub'}`}
                        >
                          {form.use_ssl ? 'SSL 已开启' : 'SSL 已关闭'}
                        </button>
                      </div>

                      <div className={`${insetCardClass} px-4 py-3`}>
                        <label className="text-xs text-tx-muted">自动同步间隔（分钟）</label>
                        <input
                          className={`${fieldClass} mt-2`}
                          type="number"
                          min={1}
                          value={form.sync_interval_minutes}
                          onChange={(event) => updateForm('sync_interval_minutes', Number(event.target.value))}
                        />
                      </div>
                    </div>
                  </div>
                </section>
              </div>

              <div className="space-y-6">
                <section className={`${sectionCardClass} p-4 md:p-5`}>
                  <SectionHeader
                    eyebrow="Summary"
                    title="当前配置摘要"
                    description="保存前快速核对发件身份、协议和 SMTP 出站信息。"
                  />
                  <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                    {connectionSummary.map((item) => (
                      <div key={item.label} className={`${insetCardClass} px-4 py-3`}>
                        <div className="text-[11px] uppercase tracking-[0.16em] text-tx-faint">{item.label}</div>
                        <div className="mt-1 text-base font-medium text-tx-sub">{item.value}</div>
                        <div className="mt-1 text-xs leading-6 text-tx-faint">{item.detail}</div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className={`${sectionCardClass} p-4 md:p-5`}>
                  <SectionHeader
                    eyebrow="Validation"
                    title="连接测试"
                    description="先校验收信协议和 SMTP 出站，再决定是否保存。编辑已有账号时，若要重新测试，请补填授权码。"
                  />
                  <div className="mt-5 space-y-4">
                    <div className={`${insetCardClass} px-4 py-3 text-xs leading-6 text-tx-faint`}>
                      {canTest ? '字段已满足测试条件，可以直接执行连接校验。' : '测试前请先填写用户名、密码或授权码，以及当前协议对应的服务器地址。'}
                    </div>
                    <button onClick={() => void handleTest()} disabled={testing || !canTest} className={`${secondaryButtonClass} w-full px-4 py-3 text-sm`}>
                      {testing ? '测试中...' : '测试连接'}
                    </button>

                    {testResult ? (
                      <div className="space-y-3">
                        {Object.entries(testResult).map(([key, value]) => (
                          <TestResultRow key={key} label={key.toUpperCase()} value={value} />
                        ))}
                      </div>
                    ) : (
                      <InlineNotice tone="info" message="测试结果会在这里显示，方便你确认收发件链路是否全部可用。" />
                    )}
                  </div>
                </section>

                {isEditing && (
                  <section className={`${sectionCardClass} border-danger/15 p-4 md:p-5`}>
                    <SectionHeader
                      eyebrow="Danger Zone"
                      title="删除当前账号"
                      description="删除后会移除该账号下的同步邮件数据、文件夹索引和后续自动同步。"
                    />
                    <button onClick={() => void handleDelete()} className="mt-5 rounded-[1rem] border border-danger/20 bg-danger/10 px-4 py-3 text-sm font-medium text-danger transition hover:bg-danger/15">
                      删除邮箱账号
                    </button>
                  </section>
                )}

                {error ? <InlineNotice tone="error" message={error} /> : null}
              </div>
            </div>
          </div>

          <div className="border-t border-bd/70 px-6 py-4 lg:px-7">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs leading-6 text-tx-faint">
                保存后会立刻回到邮箱工作区，并按当前账号刷新文件夹与邮件列表。
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button onClick={onClose} className={`${secondaryButtonClass} px-4 py-2.5 text-sm`}>
                  取消
                </button>
                <button onClick={() => void handleSave()} disabled={saving} className={`${primaryButtonClass} px-4 py-2.5 text-sm`}>
                  {saving ? '保存中...' : '保存账号'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}