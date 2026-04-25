import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AISettings,
  AssistantSSEEvent,
  clearAssistantConversation,
  getAISettings,
  sendAssistantMessage,
  sendEmailApi,
  updateAISettings,
} from '../api/client'
import { useSpeech } from '../hooks/useSpeech'

// ---- 消息类型 ----
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

// ---- 工具名称映射 ----
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
  send_kimi_task: '派发 Kimi 任务',
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

// ---- 预设模型 ----
const PRESETS = [
  { label: 'DeepSeek', api_base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: '通义千问', api_base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { label: 'Moonshot (Kimi)', api_base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { label: '智谱 GLM', api_base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { label: 'OpenAI', api_base: 'https://api.openai.com/v1', model: 'gpt-4o' },
]

export default function AssistantPanel() {
  const [open, setOpen] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [convId, setConvId] = useState<string | undefined>()
  const [settings, setSettings] = useState<AISettings | null>(null)
  const [settingsForm, setSettingsForm] = useState({ api_base: '', api_key: '', model: '' })
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [inputHeight, setInputHeight] = useState(80)
  // email confirm state
  const [modifyInput, setModifyInput] = useState('')
  const [modifyMsgId, setModifyMsgId] = useState<string | null>(null)

  const messagesEnd = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)
  const speech = useSpeech()

  // 拖拽调整输入框高度
  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startY: e.clientY, startH: inputHeight }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const delta = dragRef.current.startY - ev.clientY
      const next = Math.min(400, Math.max(60, dragRef.current.startH + delta))
      setInputHeight(next)
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // 加载设置
  useEffect(() => {
    if (open) {
      getAISettings().then((s) => {
        setSettings(s)
        setSettingsForm({ api_base: s.api_base, api_key: '', model: s.model })
        if (!s.api_key_set) setShowSettings(true)
      }).catch(() => {})
    }
  }, [open])

  // 自动滚动
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 快捷键
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
      if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open])

  // 语音输入：结果填入输入框
  const handleSpeechResult = useCallback((text: string) => {
    setInput((prev) => prev + text)
    inputRef.current?.focus()
  }, [])

  // 发送消息（可传入覆盖文本，用于修改邮件流程）
  const doSend = async (text: string, opts?: { hideUserMsg?: boolean }) => {
    if (!text || sending) return

    if (!opts?.hideUserMsg) {
      const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: text }
      setMessages((prev) => [...prev, userMsg])
    }
    setSending(true)

    // 占位 assistant 消息（流式填充）
    const assistantId = crypto.randomUUID()
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: 'assistant', content: '', isStreaming: true },
    ])

    let currentConvId = convId

    await sendAssistantMessage(text, currentConvId, (event: AssistantSSEEvent) => {
      switch (event.type) {
        case 'meta':
          currentConvId = event.conversation_id
          setConvId(event.conversation_id)
          break

        case 'text':
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content + (event.content || '') }
                : m
            )
          )
          break

        case 'tool_call': {
          const toolName = event.name || ''
          // send_email_tool 的加载指示由 email_confirm_required 事件接管
          if (toolName === 'send_email_tool') break
          const toolMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'tool',
            content: `⏳ ${TOOL_LABELS[toolName] || toolName}...`,
            toolName,
            toolArgs: event.arguments,
          }
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === assistantId)
            if (idx >= 0) {
              const arr = [...prev]
              arr.splice(idx, 0, toolMsg)
              return arr
            }
            return [...prev, toolMsg]
          })
          break
        }

        case 'tool_result': {
          const toolName = event.name || ''
          if (toolName === 'send_email_tool') break
          setMessages((prev) =>
            prev.map((m) =>
              m.role === 'tool' && m.toolName === toolName && m.content.startsWith('⏳')
                ? { ...m, content: `✅ ${TOOL_LABELS[toolName] || toolName}` }
                : m
            )
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
              const idx = prev.findIndex((m) => m.id === assistantId)
              const arr = [...prev]
              arr.splice(idx >= 0 ? idx : arr.length, 0, confirmMsg)
              return arr
            })
          } catch {}
          break
        }

        case 'done':
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, isStreaming: false } : m))
          )
          break

        case 'error':
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: `❌ ${event.message || '未知错误'}`, isStreaming: false }
                : m
            )
          )
          break
      }
    })

    setSending(false)
  }

  // 发送按钮
  const handleSend = async () => {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    await doSend(text)
  }

  // 确认发送邮件
  const handleConfirmSend = async (msgId: string, args: EmailArgs) => {
    setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, emailStatus: 'sent' } : m))
    try {
      const toList = args.to_addrs.split(',').map((s) => s.trim()).filter(Boolean)
      await sendEmailApi({
        account_id: args.account_id,
        to_addrs: toList,
        subject: args.subject,
        body_text: args.body,
        in_reply_to: args.in_reply_to,
      })
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', content: `✅ 邮件已成功发送至 ${args.to_addrs}` },
      ])
      window.dispatchEvent(new CustomEvent('athand:data-changed', { detail: { tool: 'send_email_tool' } }))
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', content: `❌ 发送失败：${msg}` },
      ])
    }
  }

  // 取消发送
  const handleCancelEmail = (msgId: string) => {
    setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, emailStatus: 'cancelled' } : m))
    setModifyMsgId(null)
  }

  // 提交修改请求
  const handleModifySubmit = async (msgId: string, args: EmailArgs) => {
    const instruction = modifyInput.trim()
    if (!instruction) return
    setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, emailStatus: 'cancelled' } : m))
    setModifyMsgId(null)
    setModifyInput('')
    // 不在对话框中显示修改请求，直接让 AI 重新生成草稿并调用 send_email_tool
    const prompt = `修改邮件并立即调用 send_email_tool（不要输出任何文字，直接调用工具）。修改要求：${instruction}\n\n原邮件：account_id=${args.account_id}，收件人=${args.to_addrs}，主题=${args.subject}，正文：\n${args.body}`
    await doSend(prompt, { hideUserMsg: true })
  }

  // 清除对话
  const handleClear = async () => {
    if (convId) {
      await clearAssistantConversation(convId).catch(() => {})
    }
    setMessages([])
    setConvId(undefined)
  }

  // 保存设置
  const handleSaveSettings = async () => {
    setSettingsSaving(true)
    try {
      await updateAISettings({
        api_base: settingsForm.api_base || undefined,
        api_key: settingsForm.api_key || undefined,
        model: settingsForm.model || undefined,
      })
      const s = await getAISettings()
      setSettings(s)
      setShowSettings(false)
    } catch (e: any) {
      alert(e.message || '保存失败')
    } finally {
      setSettingsSaving(false)
    }
  }

  // 选择预设
  const handlePreset = (preset: typeof PRESETS[0]) => {
    setSettingsForm((f) => ({ ...f, api_base: preset.api_base, model: preset.model }))
  }

  return (
    <>
      {/* 浮动按钮 */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-700
                     text-white shadow-lg shadow-blue-600/30 flex items-center justify-center
                     transition-all hover:scale-105 active:scale-95"
          title="AI 助手 (Ctrl+K)"
        >
          <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
            />
          </svg>
        </button>
      )}

      {/* 面板 */}
      {open && (
        <>
          {/* 遮罩（移动端） */}
          <div
            className="fixed inset-0 z-40 bg-black/20 lg:hidden"
            onClick={() => setOpen(false)}
          />

          <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-base border-l border-bd
                          flex flex-col shadow-2xl animate-slide-in-right">
            {/* 标题栏 */}
            <div className="h-12 flex items-center px-4 border-b border-bd flex-shrink-0">
              <svg className="w-5 h-5 text-blue-400 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
              <span className="font-semibold text-tx flex-1">AI 助手</span>
              <button
                onClick={() => setShowSettings((v) => !v)}
                className="p-1.5 rounded-lg hover:bg-raised text-tx-sub hover:text-tx transition-colors mr-1"
                title="模型设置"
              >
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                </svg>
              </button>
              <button
                onClick={handleClear}
                className="p-1.5 rounded-lg hover:bg-raised text-tx-sub hover:text-tx transition-colors mr-1"
                title="清除对话"
              >
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg hover:bg-raised text-tx-sub hover:text-tx transition-colors"
                title="关闭 (Esc)"
              >
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            {/* 设置面板 */}
            {showSettings && (
              <div className="p-4 border-b border-bd bg-raised/50 flex-shrink-0 space-y-3">
                <p className="text-xs text-tx-muted">支持 OpenAI 兼容 API（DeepSeek、通义千问、Kimi、GLM 等）</p>

                {/* 预设按钮 */}
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      onClick={() => handlePreset(p)}
                      className="text-xs px-2.5 py-1 rounded-full border border-bd hover:border-blue-400
                                 hover:text-blue-400 text-tx-sub transition-colors"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                <div>
                  <label className="text-xs text-tx-muted block mb-1">API 地址</label>
                  <input
                    type="text"
                    placeholder="https://api.deepseek.com/v1"
                    value={settingsForm.api_base}
                    onChange={(e) => setSettingsForm((f) => ({ ...f, api_base: e.target.value }))}
                    className="w-full px-3 py-1.5 rounded-lg bg-surface border border-bd text-sm text-tx
                               placeholder:text-tx-faint focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-tx-muted block mb-1">
                    API Key {settings?.api_key_set && <span className="text-green-400">(已设置: {settings.api_key_masked})</span>}
                  </label>
                  <input
                    type="password"
                    placeholder="sk-..."
                    value={settingsForm.api_key}
                    onChange={(e) => setSettingsForm((f) => ({ ...f, api_key: e.target.value }))}
                    className="w-full px-3 py-1.5 rounded-lg bg-surface border border-bd text-sm text-tx
                               placeholder:text-tx-faint focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-tx-muted block mb-1">模型名称</label>
                  <input
                    type="text"
                    placeholder="deepseek-chat"
                    value={settingsForm.model}
                    onChange={(e) => setSettingsForm((f) => ({ ...f, model: e.target.value }))}
                    className="w-full px-3 py-1.5 rounded-lg bg-surface border border-bd text-sm text-tx
                               placeholder:text-tx-faint focus:outline-none focus:border-blue-500"
                  />
                </div>
                <button
                  onClick={handleSaveSettings}
                  disabled={settingsSaving}
                  className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm
                             font-medium transition-colors disabled:opacity-50"
                >
                  {settingsSaving ? '保存中...' : '保存设置'}
                </button>
              </div>
            )}

            {/* 消息列表 */}
            <div className="flex-1 overflow-auto p-4 space-y-3">
              {messages.length === 0 && !showSettings && (
                <div className="flex flex-col items-center justify-center h-full text-tx-faint text-sm space-y-3">
                  <svg className="w-12 h-12 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                  <p>有什么我可以帮你的？</p>
                  <div className="flex flex-wrap gap-2 justify-center max-w-xs">
                    {['帮我打上午卡', '创建待办：买牛奶', '查看今日工作统计'].map((q) => (
                      <button
                        key={q}
                        onClick={() => { setInput(q); inputRef.current?.focus() }}
                        className="text-xs px-3 py-1.5 rounded-full border border-bd text-tx-sub
                                   hover:border-blue-400 hover:text-blue-400 transition-colors"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m) => (
                <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {m.role === 'tool' ? (
                    <div className="text-xs text-tx-muted bg-raised/50 px-3 py-1.5 rounded-lg">
                      {m.content}
                    </div>
                  ) : m.role === 'email_confirm' && m.emailArgs ? (
                    /* 邮件确认卡片 */
                    <div className="w-full max-w-[92%] border border-bd rounded-xl overflow-hidden bg-raised/40">
                      {/* 卡片标题 */}
                      <div className="px-4 py-2.5 border-b border-bd bg-raised/60 flex items-center gap-2">
                        <span className="text-sm">✉️</span>
                        <span className="text-sm font-medium text-tx">待发送邮件</span>
                        {m.emailStatus === 'sent' && <span className="ml-auto text-xs text-green-400">✅ 已发送</span>}
                        {m.emailStatus === 'cancelled' && <span className="ml-auto text-xs text-tx-muted">已取消</span>}
                      </div>
                      {/* 邮件信息 */}
                      <div className="px-4 py-3 space-y-2 text-sm">
                        <div className="flex gap-2">
                          <span className="text-tx-muted shrink-0 w-12">收件人</span>
                          <span className="text-tx break-all">{m.emailArgs.to_addrs}</span>
                        </div>
                        <div className="flex gap-2">
                          <span className="text-tx-muted shrink-0 w-12">主题</span>
                          <span className="text-tx font-medium">{m.emailArgs.subject}</span>
                        </div>
                        <div className="pt-2 border-t border-bd/60">
                          <p className="text-tx-muted text-xs mb-1.5">正文</p>
                          <p className="text-tx text-sm whitespace-pre-wrap max-h-44 overflow-auto leading-relaxed">
                            {m.emailArgs.body}
                          </p>
                        </div>
                      </div>
                      {/* 操作区（仅 pending 时显示）*/}
                      {m.emailStatus === 'pending' && (
                        <div className="px-4 pb-4 space-y-2">
                          {/* 修改输入框 */}
                          {modifyMsgId === m.id && (
                            <div className="flex gap-2">
                              <input
                                value={modifyInput}
                                onChange={(e) => setModifyInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleModifySubmit(m.id, m.emailArgs!) }}
                                placeholder="描述修改要求，例如：语气更正式一些"
                                className="flex-1 text-sm px-3 py-1.5 rounded-lg bg-surface border border-bd text-tx
                                           placeholder:text-tx-faint focus:outline-none focus:border-blue-500"
                                autoFocus
                              />
                              <button
                                onClick={() => handleModifySubmit(m.id, m.emailArgs!)}
                                disabled={!modifyInput.trim() || sending}
                                className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700
                                           disabled:opacity-40 shrink-0"
                              >提交</button>
                              <button
                                onClick={() => { setModifyMsgId(null); setModifyInput('') }}
                                className="px-2 py-1.5 rounded-lg border border-bd text-tx-muted text-sm hover:bg-raised"
                              >✕</button>
                            </div>
                          )}
                          {/* 三按钮 */}
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleConfirmSend(m.id, m.emailArgs!)}
                              disabled={sending}
                              className="flex-1 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium
                                         hover:bg-blue-700 disabled:opacity-40 transition-colors"
                            >确认发送</button>
                            <button
                              onClick={() => { setModifyMsgId(m.id); setModifyInput('') }}
                              disabled={sending}
                              className="flex-1 py-1.5 rounded-lg border border-bd text-tx-sub text-sm
                                         hover:bg-raised disabled:opacity-40 transition-colors"
                            >修改</button>
                            <button
                              onClick={() => handleCancelEmail(m.id)}
                              className="px-3 py-1.5 rounded-lg border border-bd text-red-400 text-sm
                                         hover:bg-red-600/10 transition-colors"
                            >取消</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (m.content || m.isStreaming) ? (
                    <div
                      className={`max-w-[85%] px-3.5 py-2.5 rounded-xl text-sm whitespace-pre-wrap leading-relaxed ${
                        m.role === 'user'
                          ? 'bg-blue-600 text-white rounded-br-md'
                          : 'bg-raised text-tx rounded-bl-md'
                      }`}
                    >
                      {m.content || (m.isStreaming ? '...' : '')}
                      {m.isStreaming && m.content && (
                        <span className="inline-block w-1.5 h-4 bg-blue-400 animate-pulse ml-0.5 -mb-0.5 rounded-sm" />
                      )}
                    </div>
                  ) : null}
                </div>
              ))}
              <div ref={messagesEnd} />
            </div>

            {/* 输入区域 */}
            <div className="border-t border-bd flex-shrink-0">
              {/* 拖拽手柄 */}
              <div
                onMouseDown={handleDragStart}
                className="h-2 flex items-center justify-center cursor-ns-resize hover:bg-raised/60 transition-colors group"
                title="拖拽调整输入框高度"
              >
                <div className="w-8 h-0.5 rounded-full bg-bd-strong group-hover:bg-blue-400 transition-colors" />
              </div>
              <div className="px-3 pb-3 flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    }
                  }}
                  placeholder="输入消息... (Enter 发送，Shift+Enter 换行)"
                  className="flex-1 px-3 py-2 rounded-xl bg-surface border border-bd text-sm text-tx
                             placeholder:text-tx-faint resize-none focus:outline-none focus:border-blue-500
                             overflow-auto"
                  style={{ height: `${inputHeight}px` }}
                />

                {/* 语音按钮 */}
                {speech.supported && (
                  <button
                    type="button"
                    onClick={() => {
                      if (speech.isListening) {
                        speech.stopListening()
                        if (speech.transcript) handleSpeechResult(speech.transcript)
                      } else {
                        speech.startListening()
                      }
                    }}
                    className={`p-2 rounded-xl transition-colors flex-shrink-0 ${
                      speech.isListening
                        ? 'bg-red-500 text-white animate-pulse'
                        : 'bg-raised text-tx-sub hover:bg-raised/80'
                    }`}
                    title={speech.isListening ? '停止录音' : '语音输入'}
                  >
                    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                    </svg>
                  </button>
                )}

                {/* 发送按钮 */}
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || sending}
                  className="p-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors
                             disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
                  title="发送"
                >
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                  </svg>
                </button>
              </div>
              {speech.isListening && speech.transcript && (
                <p className="mt-1.5 text-xs text-tx-muted px-1 truncate">🎙️ {speech.transcript}</p>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
