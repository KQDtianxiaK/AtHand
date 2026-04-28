import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type AISettings,
  type AssistantSSEEvent,
  clearAssistantConversation,
  getAISettings,
  sendAssistantMessage,
  sendEmailApi,
  updateAISettings,
} from '../api/client'
import { useSpeech } from '../hooks/useSpeech'

interface EmailArgs {
  account_id: number
  to_addrs: string
  subject: string
  body: string
  in_reply_to?: string
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'email_confirm'
  content: string
  toolName?: string
  toolArgs?: string
  isStreaming?: boolean
  emailArgs?: EmailArgs
  emailStatus?: 'pending' | 'sent' | 'cancelled'
}

type NoticeTone = 'info' | 'success' | 'error'

const TOOL_LABELS: Record<string, string> = {
  create_todo: '创建待办',
  list_todos: '查询待办',
  complete_todo: '完成待办',
  clock_in: '上班打卡',
  clock_out: '下班打卡',
  get_clock_status: '查看打卡状态',
  create_memo: '创建备忘录',
  search_memos: '搜索备忘录',
  delete_memo: '删除备忘录',
  start_kimi_session: '启动 Kimi 会话',
  list_machines: '列出机器',
  fetch_url: '抓取网页',
  get_stats: '查看统计',
  search_emails: '搜索邮件',
  summarize_email: '查看邮件',
  draft_reply: '起草回复',
  send_email_tool: '发送邮件',
  list_email_folders: '查看邮箱文件夹',
  move_email_tool: '移动邮件',
}

const PRESETS = [
  { label: 'DeepSeek', api_base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: '通义千问', api_base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { label: 'Moonshot (Kimi)', api_base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { label: '智谱 GLM', api_base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { label: 'OpenAI', api_base: 'https://api.openai.com/v1', model: 'gpt-4o' },
]

const panelShellClass = 'fixed inset-y-3 right-3 z-50 flex w-[min(calc(100vw-1.5rem),32rem)] flex-col overflow-hidden rounded-[1.8rem] border border-bd bg-surface/[0.96] shadow-float backdrop-blur-xl animate-slide-in-right'
const sectionCardClass = 'rounded-[1.3rem] border border-bd bg-page/[0.52]'
const insetCardClass = 'rounded-[1.05rem] border border-bd bg-page/[0.4]'
const fieldClass = 'w-full rounded-[1rem] border border-bd-strong bg-surface-elevated/[0.92] px-3 py-2.5 text-sm text-tx shadow-inset outline-none transition placeholder:text-tx-faint focus:border-accent/40 focus:ring-2 focus:ring-accent/10'
const secondaryButtonClass = 'rounded-[1rem] border border-bd bg-page/[0.55] px-3 py-2 text-xs font-medium text-tx-muted transition hover:border-bd-strong hover:bg-surface-elevated/[0.92] hover:text-tx-sub disabled:opacity-50 disabled:cursor-not-allowed'
const primaryButtonClass = 'rounded-[1rem] bg-accent px-3 py-2 text-xs font-medium text-white transition hover:bg-accent-strong disabled:opacity-50 disabled:cursor-not-allowed'
const iconButtonClass = 'inline-flex h-9 w-9 items-center justify-center rounded-[1rem] border border-bd bg-page/[0.4] text-tx-muted transition hover:border-bd-strong hover:bg-surface-elevated/[0.92] hover:text-tx-sub disabled:opacity-50 disabled:cursor-not-allowed'

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}

function parseAddressList(value: string) {
  return value
    .split(/[;,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function InlineNotice({
  tone,
  message,
  actionLabel,
  onAction,
}: {
  tone: NoticeTone
  message: string
  actionLabel?: string
  onAction?: () => void
}) {
  const toneClass =
    tone === 'success'
      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700'
      : tone === 'info'
        ? 'border-accent/20 bg-accent-soft/[0.82] text-accent'
        : 'border-danger/20 bg-danger/10 text-danger'

  return (
    <div className={`flex items-start justify-between gap-3 rounded-[1rem] border px-3 py-2.5 text-xs leading-6 ${toneClass}`}>
      <span className="min-w-0 flex-1">{message}</span>
      {actionLabel && onAction ? (
        <button onClick={onAction} className="shrink-0 rounded-full border border-current/15 px-2.5 py-1 font-medium transition hover:bg-white/10">
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}

function SectionHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">{eyebrow}</div>
      <h3 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-tx">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-tx-muted">{description}</p>
    </div>
  )
}

function MetricTile({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`${insetCardClass} px-3 py-2.5`}>
      <div className="text-[10px] uppercase tracking-[0.16em] text-tx-faint">{label}</div>
      <div className={`mt-1 truncate text-sm font-medium ${accent ? 'text-accent' : 'text-tx-sub'}`}>{value}</div>
    </div>
  )
}

export default function AssistantPanel() {
  const [open, setOpen] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [convId, setConvId] = useState<string | undefined>()
  const [settings, setSettings] = useState<AISettings | null>(null)
  const [settingsForm, setSettingsForm] = useState({ api_base: '', api_key: '', model: '' })
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [inputHeight, setInputHeight] = useState(112)
  const [modifyInput, setModifyInput] = useState('')
  const [modifyMsgId, setModifyMsgId] = useState<string | null>(null)

  const messagesEnd = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)
  const speech = useSpeech()

  const currentPresetLabel = PRESETS.find(
    (preset) => preset.api_base === settingsForm.api_base && preset.model === settingsForm.model,
  )?.label ?? '自定义'
  const conversationLabel = convId ? convId.slice(0, 8) : '新会话'
  const pendingEmailCount = messages.filter((message) => message.role === 'email_confirm' && message.emailStatus === 'pending').length
  const assistantConfigured = Boolean(
    (settings?.api_key_set || settingsForm.api_key.trim())
    && (settings?.api_base || settingsForm.api_base).trim()
    && (settings?.model || settingsForm.model).trim(),
  )

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true)
    setSettingsError(null)

    try {
      const nextSettings = await getAISettings()
      setSettings(nextSettings)
      setSettingsForm({ api_base: nextSettings.api_base, api_key: '', model: nextSettings.model })
      if (!nextSettings.api_key_set) {
        setShowSettings(true)
      }
    } catch (error) {
      setSettingsError(getErrorMessage(error, '助手配置读取失败'))
    } finally {
      setSettingsLoading(false)
    }
  }, [])

  const handleDragStart = (event: React.MouseEvent) => {
    event.preventDefault()
    dragRef.current = { startY: event.clientY, startH: inputHeight }

    const onMove = (moveEvent: MouseEvent) => {
      if (!dragRef.current) {
        return
      }
      const delta = dragRef.current.startY - moveEvent.clientY
      setInputHeight(Math.min(420, Math.max(88, dragRef.current.startH + delta)))
    }

    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  useEffect(() => {
    if (open) {
      void loadSettings()
      inputRef.current?.focus()
    }
  }, [loadSettings, open])

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

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
        event.preventDefault()
        setOpen((current) => !current)
      }

      if (event.key === 'Escape' && open) {
        setOpen(false)
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open])

  const handleSpeechResult = useCallback((text: string) => {
    setInput((current) => current + text)
    inputRef.current?.focus()
  }, [])

  const doSend = useCallback(async (text: string, opts?: { hideUserMsg?: boolean }) => {
    if (!text || sending) {
      return
    }

    if (!opts?.hideUserMsg) {
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', content: text }])
    }

    setSending(true)

    const assistantId = crypto.randomUUID()
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '', isStreaming: true }])

    let currentConvId = convId

    try {
      await sendAssistantMessage(text, currentConvId, (event: AssistantSSEEvent) => {
        switch (event.type) {
          case 'meta':
            currentConvId = event.conversation_id
            setConvId(event.conversation_id)
            break

          case 'text':
            setMessages((prev) =>
              prev.map((message) =>
                message.id === assistantId
                  ? { ...message, content: message.content + (event.content || '') }
                  : message,
              ),
            )
            break

          case 'tool_call': {
            const toolName = event.name || ''
            if (toolName === 'send_email_tool') {
              break
            }

            const toolMsg: ChatMessage = {
              id: crypto.randomUUID(),
              role: 'tool',
              content: `⏳ ${TOOL_LABELS[toolName] || toolName}...`,
              toolName,
              toolArgs: event.arguments,
            }

            setMessages((prev) => {
              const insertIndex = prev.findIndex((message) => message.id === assistantId)
              if (insertIndex < 0) {
                return [...prev, toolMsg]
              }

              const next = [...prev]
              next.splice(insertIndex, 0, toolMsg)
              return next
            })
            break
          }

          case 'tool_result': {
            const toolName = event.name || ''
            if (toolName === 'send_email_tool') {
              break
            }

            setMessages((prev) =>
              prev.map((message) =>
                message.role === 'tool' && message.toolName === toolName && message.content.startsWith('⏳')
                  ? { ...message, content: `✅ ${TOOL_LABELS[toolName] || toolName}` }
                  : message,
              ),
            )
            window.dispatchEvent(new CustomEvent('athand:data-changed', { detail: { tool: toolName } }))
            break
          }

          case 'email_confirm_required': {
            try {
              const args: EmailArgs = JSON.parse(event.arguments || '{}')
              const confirmMsg: ChatMessage = {
                id: crypto.randomUUID(),
                role: 'email_confirm',
                content: '',
                emailArgs: args,
                emailStatus: 'pending',
              }
              setMessages((prev) => {
                const insertIndex = prev.findIndex((message) => message.id === assistantId)
                const next = [...prev]
                next.splice(insertIndex >= 0 ? insertIndex : next.length, 0, confirmMsg)
                return next
              })
            } catch {
              setMessages((prev) =>
                prev.map((message) =>
                  message.id === assistantId
                    ? { ...message, content: '❌ 邮件草稿解析失败，请重试。', isStreaming: false }
                    : message,
                ),
              )
            }
            break
          }

          case 'done':
            setMessages((prev) => prev.map((message) => (message.id === assistantId ? { ...message, isStreaming: false } : message)))
            break

          case 'error':
            setMessages((prev) =>
              prev.map((message) =>
                message.id === assistantId
                  ? { ...message, content: `❌ ${event.message || '未知错误'}`, isStreaming: false }
                  : message,
              ),
            )
            break
        }
      })
    } catch (error) {
      const message = getErrorMessage(error, '助手请求失败')
      setMessages((prev) =>
        prev.map((entry) =>
          entry.id === assistantId
            ? { ...entry, content: `❌ ${message}`, isStreaming: false }
            : entry,
        ),
      )
    } finally {
      setSending(false)
      setMessages((prev) => prev.map((message) => (message.id === assistantId ? { ...message, isStreaming: false } : message)))
    }
  }, [convId, sending])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || sending || !assistantConfigured) {
      return
    }
    setInput('')
    await doSend(text)
  }

  const handleConfirmSend = async (msgId: string, args: EmailArgs) => {
    setMessages((prev) => prev.map((message) => (message.id === msgId ? { ...message, emailStatus: 'sent' } : message)))

    try {
      await sendEmailApi({
        account_id: args.account_id,
        to_addrs: parseAddressList(args.to_addrs),
        subject: args.subject,
        body_text: args.body,
        in_reply_to: args.in_reply_to,
      })
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', content: `✅ 邮件已成功发送至 ${args.to_addrs}` },
      ])
      window.dispatchEvent(new CustomEvent('athand:data-changed', { detail: { tool: 'send_email_tool' } }))
    } catch (error) {
      const message = getErrorMessage(error, '邮件发送失败')
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', content: `❌ 发送失败：${message}` },
      ])
    }
  }

  const handleCancelEmail = (msgId: string) => {
    setMessages((prev) => prev.map((message) => (message.id === msgId ? { ...message, emailStatus: 'cancelled' } : message)))
    setModifyMsgId(null)
    setModifyInput('')
  }

  const handleModifySubmit = async (msgId: string, args: EmailArgs) => {
    const instruction = modifyInput.trim()
    if (!instruction) {
      return
    }

    setMessages((prev) => prev.map((message) => (message.id === msgId ? { ...message, emailStatus: 'cancelled' } : message)))
    setModifyMsgId(null)
    setModifyInput('')

    const prompt = `修改邮件并立即调用 send_email_tool（不要输出任何文字，直接调用工具）。修改要求：${instruction}\n\n原邮件：account_id=${args.account_id}，收件人=${args.to_addrs}，主题=${args.subject}，正文：\n${args.body}`
    await doSend(prompt, { hideUserMsg: true })
  }

  const handleClear = async () => {
    if (convId) {
      await clearAssistantConversation(convId).catch(() => {})
    }
    setMessages([])
    setConvId(undefined)
    setModifyMsgId(null)
    setModifyInput('')
  }

  const handleSaveSettings = async () => {
    setSettingsSaving(true)
    setSettingsError(null)

    try {
      await updateAISettings({
        api_base: settingsForm.api_base || undefined,
        api_key: settingsForm.api_key || undefined,
        model: settingsForm.model || undefined,
      })
      const nextSettings = await getAISettings()
      setSettings(nextSettings)
      setSettingsForm({ api_base: nextSettings.api_base, api_key: '', model: nextSettings.model })
      setShowSettings(false)
    } catch (error) {
      setSettingsError(getErrorMessage(error, '助手配置保存失败'))
    } finally {
      setSettingsSaving(false)
    }
  }

  const handlePreset = (preset: (typeof PRESETS)[number]) => {
    setSettingsForm((current) => ({ ...current, api_base: preset.api_base, model: preset.model }))
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 inline-flex h-14 w-14 items-center justify-center rounded-[1.35rem] border border-accent/20 bg-surface/[0.94] text-accent shadow-float backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-accent/40 hover:bg-surface-elevated/[0.98]"
          title="AI 助手 (Ctrl+K)"
        >
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
          </svg>
        </button>
      )}

      {open && (
        <>
          <button className="fixed inset-0 z-40 bg-page/30 backdrop-blur-[2px] lg:hidden" onClick={() => setOpen(false)} aria-label="关闭助手遮罩" />

          <div className={panelShellClass}>
            <div className="relative overflow-hidden border-b border-bd bg-surface/[0.94] px-4 pb-4 pt-4">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(circle_at_top_right,rgba(74,111,165,0.14),transparent_58%)]" />
              <div className="relative flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Desk Copilot</div>
                  <div className="mt-2 flex items-center gap-3">
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-[1.05rem] border border-accent/15 bg-accent-soft text-accent">
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                      </svg>
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-semibold tracking-[-0.03em] text-tx">AI 助手</h2>
                      <p className="mt-1 text-sm leading-6 text-tx-muted">在当前工作台里继续对话、调用工具、确认邮件动作。</p>
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => setShowSettings((current) => !current)} className={iconButtonClass} title="模型设置">
                    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                    </svg>
                  </button>
                  <button onClick={handleClear} disabled={!messages.length && !convId} className={iconButtonClass} title="清除对话">
                    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </button>
                  <button onClick={() => setOpen(false)} className={iconButtonClass} title="关闭 (Esc)">
                    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="relative mt-4 grid grid-cols-3 gap-2">
                <MetricTile label="状态" value={assistantConfigured ? 'Ready' : 'Setup'} accent={assistantConfigured} />
                <MetricTile label="模型" value={settings?.model || settingsForm.model || '未配置'} />
                <MetricTile label="会话" value={conversationLabel} />
              </div>
            </div>

            {showSettings && (
              <div className="border-b border-bd bg-page/[0.26] p-4">
                <div className={`${sectionCardClass} space-y-4 p-4`}>
                  <SectionHeader
                    eyebrow="Model Lane"
                    title="助手模型与密钥"
                    description="内嵌助手使用 OpenAI 兼容接口。这里保留供应商预设，同时允许你填自定义地址与模型名。"
                  />

                  {settingsLoading ? <InlineNotice tone="info" message="正在读取当前模型配置..." /> : null}
                  {settingsError ? <InlineNotice tone="error" message={settingsError} actionLabel="重试" onAction={() => void loadSettings()} /> : null}

                  <div className={`${insetCardClass} space-y-3 p-3`}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.16em] text-tx-faint">Current Profile</div>
                        <div className="mt-1 text-sm font-medium text-tx-sub">{currentPresetLabel}</div>
                      </div>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${settings?.api_key_set ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700' : 'border-warning/20 bg-warning/10 text-warning'}`}>
                        {settings?.api_key_set ? settings.api_key_masked : '未配置密钥'}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {PRESETS.map((preset) => (
                        <button
                          key={preset.label}
                          onClick={() => handlePreset(preset)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${currentPresetLabel === preset.label ? 'border-accent/25 bg-accent-soft text-accent' : 'border-bd bg-page/[0.65] text-tx-muted hover:border-bd-strong hover:text-tx-sub'}`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className="mb-1.5 block text-xs text-tx-muted">API 地址</label>
                      <input
                        type="text"
                        value={settingsForm.api_base}
                        onChange={(event) => setSettingsForm((current) => ({ ...current, api_base: event.target.value }))}
                        placeholder="https://api.deepseek.com/v1"
                        className={fieldClass}
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs text-tx-muted">模型名称</label>
                      <input
                        type="text"
                        value={settingsForm.model}
                        onChange={(event) => setSettingsForm((current) => ({ ...current, model: event.target.value }))}
                        placeholder="deepseek-chat"
                        className={fieldClass}
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs text-tx-muted">API Key</label>
                      <input
                        type="password"
                        value={settingsForm.api_key}
                        onChange={(event) => setSettingsForm((current) => ({ ...current, api_key: event.target.value }))}
                        placeholder={settings?.api_key_set ? `留空则保留 ${settings.api_key_masked}` : 'sk-...'}
                        className={fieldClass}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => setShowSettings(false)} className={secondaryButtonClass}>收起设置</button>
                    <button onClick={handleSaveSettings} disabled={settingsSaving} className={primaryButtonClass}>
                      {settingsSaving ? '保存中...' : '保存配置'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {messages.length === 0 ? (
                <div className={`${sectionCardClass} flex min-h-full flex-col justify-between p-5`}>
                  <div>
                    <SectionHeader
                      eyebrow="Conversation"
                      title="工作台内的随身助手"
                      description="它可以继续对话、触发待办/打卡/备忘录/邮件等工具，并把结果同步回当前工作台。"
                    />

                    {!assistantConfigured ? (
                      <div className="mt-4">
                        <InlineNotice tone="info" message="还没有可用模型配置。先补齐 API 地址、密钥和模型名，再开始对话。" actionLabel="打开设置" onAction={() => setShowSettings(true)} />
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-6 space-y-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-tx-faint">Quick prompts</div>
                    <div className="grid gap-2">
                      {['帮我打上午卡', '创建待办：买牛奶', '查看今日工作统计', '总结一下最新新闻重点'].map((prompt) => (
                        <button
                          key={prompt}
                          onClick={() => {
                            setInput(prompt)
                            inputRef.current?.focus()
                          }}
                          className={`${insetCardClass} px-3 py-3 text-left text-sm text-tx-sub transition hover:border-bd-strong hover:bg-surface-elevated/[0.9] hover:text-tx`}
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {messages.map((message) => (
                    <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      {message.role === 'tool' ? (
                        <div className={`${insetCardClass} max-w-[92%] px-3.5 py-2.5 text-xs text-tx-muted`}>
                          <div className="flex items-center gap-2">
                            <span className="rounded-full border border-accent/15 bg-accent-soft px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-accent">Tool</span>
                            <span className="min-w-0 flex-1 truncate">{message.content}</span>
                          </div>
                        </div>
                      ) : message.role === 'email_confirm' && message.emailArgs ? (
                        <div className={`${sectionCardClass} w-full max-w-[96%] overflow-hidden`}>
                          <div className="flex items-center gap-2 border-b border-bd bg-page/[0.56] px-4 py-3">
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-[0.9rem] border border-accent/15 bg-accent-soft text-accent">✉</span>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium text-tx">待发送邮件</div>
                              <div className="text-xs text-tx-muted">请确认后再真正发送。</div>
                            </div>
                            {message.emailStatus === 'sent' ? <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-700">已发送</span> : null}
                            {message.emailStatus === 'cancelled' ? <span className="rounded-full border border-bd bg-page/[0.7] px-2.5 py-1 text-[11px] font-medium text-tx-muted">已取消</span> : null}
                          </div>

                          <div className="space-y-3 p-4">
                            <div className={`${insetCardClass} space-y-3 p-3`}>
                              <div className="flex gap-3 text-sm">
                                <span className="w-12 shrink-0 text-tx-muted">收件人</span>
                                <span className="break-all text-tx">{message.emailArgs.to_addrs}</span>
                              </div>
                              <div className="flex gap-3 text-sm">
                                <span className="w-12 shrink-0 text-tx-muted">主题</span>
                                <span className="text-tx font-medium">{message.emailArgs.subject}</span>
                              </div>
                            </div>

                            <div className={`${insetCardClass} p-3`}>
                              <div className="text-[11px] uppercase tracking-[0.16em] text-tx-faint">Body</div>
                              <div className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-tx">{message.emailArgs.body}</div>
                            </div>

                            {message.emailStatus === 'pending' ? (
                              <div className="space-y-3">
                                {modifyMsgId === message.id ? (
                                  <div className={`${insetCardClass} space-y-3 p-3`}>
                                    <input
                                      value={modifyInput}
                                      onChange={(event) => setModifyInput(event.target.value)}
                                      onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                          event.preventDefault()
                                          void handleModifySubmit(message.id, message.emailArgs!)
                                        }
                                      }}
                                      placeholder="描述修改要求，例如：语气更正式一些"
                                      className={fieldClass}
                                      autoFocus
                                    />
                                    <div className="flex items-center justify-end gap-2">
                                      <button onClick={() => { setModifyMsgId(null); setModifyInput('') }} className={secondaryButtonClass}>取消修改</button>
                                      <button onClick={() => void handleModifySubmit(message.id, message.emailArgs!)} disabled={!modifyInput.trim() || sending} className={primaryButtonClass}>提交修改</button>
                                    </div>
                                  </div>
                                ) : null}

                                <div className="flex flex-wrap items-center gap-2">
                                  <button onClick={() => void handleConfirmSend(message.id, message.emailArgs!)} disabled={sending} className={primaryButtonClass}>确认发送</button>
                                  <button onClick={() => { setModifyMsgId(message.id); setModifyInput('') }} disabled={sending} className={secondaryButtonClass}>修改草稿</button>
                                  <button onClick={() => handleCancelEmail(message.id)} className="rounded-[1rem] border border-danger/20 bg-danger/10 px-3 py-2 text-xs font-medium text-danger transition hover:bg-danger/15">取消动作</button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ) : (message.content || message.isStreaming) ? (
                        <div
                          className={message.role === 'user'
                            ? 'max-w-[88%] rounded-[1.2rem] rounded-br-md border border-accent/10 bg-accent px-4 py-3 text-sm text-white shadow-[0_18px_45px_-32px_rgba(54,83,127,0.85)]'
                            : `${sectionCardClass} max-w-[92%] rounded-[1.2rem] rounded-bl-md px-4 py-3`}
                        >
                          <div className={`flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] ${message.role === 'user' ? 'text-white/75' : 'text-tx-faint'}`}>
                            <span>{message.role === 'user' ? 'You' : 'Assistant'}</span>
                            {message.isStreaming ? <span className={`rounded-full border px-2 py-0.5 ${message.role === 'user' ? 'border-white/20 bg-white/10 text-white/80' : 'border-accent/15 bg-accent-soft text-accent'}`}>Streaming</span> : null}
                          </div>
                          <div className={`mt-2 whitespace-pre-wrap break-words text-sm leading-6 ${message.role === 'user' ? 'text-white' : 'text-tx'}`}>
                            {message.content || '...'}
                            {message.isStreaming && message.content ? (
                              <span className={`ml-1 inline-block h-4 w-1.5 animate-pulse rounded-sm align-[-2px] ${message.role === 'user' ? 'bg-white/70' : 'bg-accent'}`} />
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}

                  <div ref={messagesEnd} />
                </div>
              )}
            </div>

            <div className="border-t border-bd bg-surface/[0.94] px-4 pb-4 pt-2">
              <div onMouseDown={handleDragStart} className="group flex h-4 cursor-ns-resize items-center justify-center" title="拖拽调整输入框高度">
                <div className="h-1 w-14 rounded-full bg-bd-strong transition group-hover:bg-accent" />
              </div>

              <div className={`${sectionCardClass} space-y-3 p-3`}>
                {speech.isListening && speech.transcript ? <InlineNotice tone="info" message={`语音识别中：${speech.transcript}`} /> : null}
                {pendingEmailCount > 0 ? <InlineNotice tone="info" message={`当前有 ${pendingEmailCount} 封待确认邮件，确认后才会真正发送。`} /> : null}

                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      void handleSend()
                    }
                  }}
                  placeholder={assistantConfigured ? '输入消息... (Enter 发送，Shift+Enter 换行)' : '先完成模型设置，再开始对话'}
                  className={`${fieldClass} resize-none overflow-y-auto`}
                  style={{ height: `${inputHeight}px` }}
                />

                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0 flex-1 text-[11px] leading-5 text-tx-faint">
                    <div>当前会话：{conversationLabel}</div>
                    <div>工具消息：{messages.filter((message) => message.role === 'tool').length} 条</div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {speech.supported ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (speech.isListening) {
                            speech.stopListening()
                            if (speech.transcript) {
                              handleSpeechResult(speech.transcript)
                            }
                          } else {
                            speech.startListening()
                          }
                        }}
                        className={speech.isListening ? 'inline-flex h-10 w-10 items-center justify-center rounded-[1rem] border border-danger/20 bg-danger text-white transition hover:bg-danger/90' : iconButtonClass}
                        title={speech.isListening ? '停止录音' : '语音输入'}
                      >
                        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                        </svg>
                      </button>
                    ) : null}

                    <button onClick={() => void handleSend()} disabled={!assistantConfigured || !input.trim() || sending} className={`${primaryButtonClass} inline-flex items-center gap-2 px-4 py-2.5 text-sm`}>
                      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                      </svg>
                      {sending ? '发送中...' : '发送'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
