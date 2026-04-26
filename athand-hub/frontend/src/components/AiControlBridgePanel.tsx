import { useDeferredValue, useEffect, useMemo, useState, type MouseEvent } from 'react'

import {
  type AiControlHistoryItem,
  type AiControlMachine,
  type AiControlProvider,
  type AiControlSession,
  type AiControlTimelineItem,
  createAiControlSession,
  getAiControlHistory,
  getAiControlMachines,
  getAiControlProviders,
  getAiControlSession,
  getAiControlTimeline,
  resumeAiControlSession,
  sendAiControlMessage,
} from '../api/client'

const CONTROL_PANEL_COLLAPSED_STORAGE_KEY = 'athand.aiControl.controlPanelCollapsed'
const HIDE_EMPTY_COLUMNS_STORAGE_KEY = 'athand.aiControl.hideEmptyColumns'

const TERMINAL_STATUSES = new Set(['done', 'failed', 'cancelled', 'canceled', 'completed', 'error', 'closed', 'archived'])
const ERROR_STATUSES = new Set(['failed', 'error', 'crashed', 'timed_out', 'timeout'])
const DONE_STATUSES = new Set(['done', 'completed', 'cancelled', 'canceled', 'finished', 'stopped', 'closed', 'archived'])
const ACTIVE_STATUSES = new Set(['running', 'streaming', 'working', 'busy', 'resumed', 'in_progress'])
const INITIALIZING_STATUSES = new Set(['queued', 'initializing', 'created', 'pending', 'starting'])
const IDLE_STATUSES = new Set(['idle', 'ready', 'waiting', 'paused'])
const AWAITING_PERMISSION_STATUSES = new Set(['awaiting_permission', 'permission_required', 'needs_attention', 'attention'])

type BoardColumnId = 'initializing' | 'idle' | 'active' | 'awaiting_permission' | 'done' | 'error'

type BoardSessionCard = AiControlHistoryItem & {
  board_status: BoardColumnId
}

function attentionReasonLabel(value: string | null | undefined) {
  if (value === 'permission') return '等待权限确认'
  if (value === 'error') return '最近一次执行异常'
  if (value === 'finished') return '最近一次执行已结束'
  return '需关注'
}

function fallbackPreview(item: Pick<AiControlHistoryItem, 'attention_reason' | 'status' | 'provider'>) {
  if (item.attention_reason === 'permission') return '当前会话正在等待权限确认。'
  if (item.attention_reason === 'error') return '最近一次执行以异常结束，请打开详情查看 timeline。'
  if (item.attention_reason === 'finished') return '最近一次执行已经结束，可恢复后继续对话。'
  if (normalizeStatus(item.status) === 'closed') return `${item.provider} 会话已关闭，可通过恢复按钮继续。`
  if (normalizeStatus(item.status) === 'idle') return `${item.provider} 会话当前空闲，可直接继续对话。`
  return '还没有可展示的摘要，点击后可查看完整 timeline。'
}

const BOARD_COLUMNS: Array<{ id: BoardColumnId; label: string; description: string }> = [
  { id: 'initializing', label: '准备中', description: 'provider 已接管，但会话尚未稳定' },
  { id: 'idle', label: '待继续', description: '已可继续对话，等待下一条输入' },
  { id: 'active', label: '执行中', description: '当前 turn 正在生成、推理或执行工具' },
  { id: 'awaiting_permission', label: '待处理', description: '需要你确认、恢复或关注的会话' },
  { id: 'done', label: '已完成', description: '本轮完成，可作为历史沉淀' },
  { id: 'error', label: '异常', description: '失败、超时或需要人工介入的会话' },
]

function normalizeStatus(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function isTerminalStatus(status: string) {
  return TERMINAL_STATUSES.has(normalizeStatus(status))
}

function formatTimeLabel(value: string | null | undefined) {
  if (!value) return '未知时间'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function formatRelativeTimeLabel(value: string | null | undefined) {
  if (!value) return '未知时间'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  const diffMs = Date.now() - date.getTime()
  if (diffMs < 60_000) return '刚刚'
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)} 分钟前`
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)} 小时前`
  if (diffMs < 172_800_000) return '昨天'
  return `${Math.floor(diffMs / 86_400_000)} 天前`
}

function trimPreview(value: string | null | undefined, limit = 110) {
  if (!value) return null
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return null
  return compact.length > limit ? `${compact.slice(0, limit - 1)}…` : compact
}

function statusTone(status: string) {
  const normalized = normalizeStatus(status)
  if (DONE_STATUSES.has(normalized)) return 'bg-green-900/50 text-green-300 border-green-700/40'
  if (ERROR_STATUSES.has(normalized)) return 'bg-red-900/50 text-red-300 border-red-700/40'
  if (AWAITING_PERMISSION_STATUSES.has(normalized)) return 'bg-amber-900/40 text-amber-300 border-amber-700/40'
  if (INITIALIZING_STATUSES.has(normalized)) return 'bg-yellow-900/50 text-yellow-300 border-yellow-700/40'
  if (ACTIVE_STATUSES.has(normalized)) return 'bg-blue-900/40 text-blue-300 border-blue-700/40'
  return 'bg-raised text-tx-sub border-bd'
}

function columnTone(columnId: BoardColumnId) {
  if (columnId === 'done') return 'border-green-700/30 bg-green-900/10'
  if (columnId === 'error') return 'border-red-700/30 bg-red-900/10'
  if (columnId === 'awaiting_permission') return 'border-amber-700/30 bg-amber-900/10'
  if (columnId === 'active') return 'border-blue-700/30 bg-blue-900/10'
  if (columnId === 'initializing') return 'border-yellow-700/30 bg-yellow-900/10'
  return 'border-bd bg-raised/20'
}

function boardDotTone(columnId: BoardColumnId, attention: boolean) {
  if (attention) return 'bg-amber-400'
  if (columnId === 'done') return 'bg-green-400'
  if (columnId === 'error') return 'bg-red-400'
  if (columnId === 'awaiting_permission') return 'bg-amber-400'
  if (columnId === 'active') return 'bg-blue-400'
  if (columnId === 'initializing') return 'bg-yellow-400'
  return 'bg-slate-400'
}

function timelineTone(item: AiControlTimelineItem) {
  if (item.role === 'user') return 'border-blue-500/30 bg-blue-500/5'
  if (item.role === 'assistant') return 'border-emerald-500/30 bg-emerald-500/5'
  if (item.role === 'tool') return 'border-amber-500/30 bg-amber-500/5'
  return 'border-bd bg-raised/40'
}

function stringifyPayload(value: unknown) {
  if (value == null) return null
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function summarizeTimelinePreview(items: AiControlTimelineItem[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item.text?.trim()) return trimPreview(item.text, 140)
    if (item.tool_name) return `工具调用：${item.tool_name}`
  }
  return null
}

function deriveBoardStatus(status: string, attention: boolean, attentionReason: string | null | undefined): BoardColumnId {
  const normalized = normalizeStatus(status)
  if (attentionReason === 'permission' || AWAITING_PERMISSION_STATUSES.has(normalized)) return 'awaiting_permission'
  if (ERROR_STATUSES.has(normalized)) return 'error'
  if (DONE_STATUSES.has(normalized)) return 'done'
  if (ACTIVE_STATUSES.has(normalized)) return 'active'
  if (INITIALIZING_STATUSES.has(normalized)) return 'initializing'
  if (IDLE_STATUSES.has(normalized)) return 'idle'
  return 'idle'
}

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

function buildBoardCardFromSession(session: AiControlSession, timeline: AiControlTimelineItem[]): AiControlHistoryItem {
  return {
    agent_id: session.agent_id,
    machine_id: session.machine_id,
    provider: session.provider,
    title: session.title,
    cwd: session.cwd,
    status: session.status,
    created_at: session.created_at,
    updated_at: session.updated_at,
    attention: session.attention,
    attention_reason: session.attention_reason,
    persistence_handle: session.persistence_handle,
    last_message_preview: summarizeTimelinePreview(timeline),
  }
}

export default function AiControlBridgePanel() {
  const [machines, setMachines] = useState<AiControlMachine[]>([])
  const [providers, setProviders] = useState<AiControlProvider[]>([])
  const [history, setHistory] = useState<AiControlHistoryItem[]>([])
  const [historyCursor, setHistoryCursor] = useState<string | null>(null)
  const [selectedMachine, setSelectedMachine] = useState('')
  const [selectedProvider, setSelectedProvider] = useState('')
  const [selectedModeId, setSelectedModeId] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [cwd, setCwd] = useState('')
  const [composer, setComposer] = useState('')
  const [activeSession, setActiveSession] = useState<AiControlSession | null>(null)
  const [timeline, setTimeline] = useState<AiControlTimelineItem[]>([])
  const [bootstrapping, setBootstrapping] = useState(true)
  const [providerLoading, setProviderLoading] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [boardQuery, setBoardQuery] = useState('')
  const [controlPanelCollapsed, setControlPanelCollapsed] = useState(() => readStoredFlag(CONTROL_PANEL_COLLAPSED_STORAGE_KEY))
  const [hideEmptyColumns, setHideEmptyColumns] = useState(() => readStoredFlag(HIDE_EMPTY_COLUMNS_STORAGE_KEY))

  const deferredBoardQuery = useDeferredValue(boardQuery)

  const selectedMachineInfo = useMemo(
    () => machines.find((machine) => machine.id === selectedMachine) ?? null,
    [machines, selectedMachine],
  )
  const machineNameById = useMemo(
    () => new Map(machines.map((machine) => [machine.id, machine.name])),
    [machines],
  )
  const selectedProviderInfo = useMemo(
    () => providers.find((provider) => provider.id === selectedProvider) ?? null,
    [providers, selectedProvider],
  )
  const selectedCardId = activeSession?.agent_id || selectedAgentId

  const boardCards = useMemo<BoardSessionCard[]>(() => {
    const merged = new Map<string, AiControlHistoryItem>()

    history.forEach((item) => {
      merged.set(item.agent_id, item)
    })

    if (activeSession) {
      const currentCard = buildBoardCardFromSession(activeSession, timeline)
      const previous = merged.get(currentCard.agent_id)
      merged.set(currentCard.agent_id, {
        ...previous,
        ...currentCard,
        last_message_preview: currentCard.last_message_preview ?? previous?.last_message_preview ?? null,
      })
    }

    const query = deferredBoardQuery.trim().toLowerCase()

    return Array.from(merged.values())
      .filter((item) => {
        if (!query) return true
        const haystack = [item.title, item.agent_id, item.provider, item.cwd, item.last_message_preview]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return haystack.includes(query)
      })
      .sort((left, right) => {
        const rightTime = new Date(right.updated_at || right.created_at).getTime() || 0
        const leftTime = new Date(left.updated_at || left.created_at).getTime() || 0
        return rightTime - leftTime
      })
      .map((item) => ({
        ...item,
        board_status: deriveBoardStatus(item.status, item.attention, item.attention_reason),
      }))
  }, [activeSession, deferredBoardQuery, history, timeline])

  const boardColumns = useMemo(
    () => BOARD_COLUMNS.map((column) => ({ ...column, items: boardCards.filter((item) => item.board_status === column.id) })),
    [boardCards],
  )
  const visibleBoardColumns = useMemo(
    () => (hideEmptyColumns ? boardColumns.filter((column) => column.items.length > 0) : boardColumns),
    [boardColumns, hideEmptyColumns],
  )
  const hiddenEmptyColumnCount = boardColumns.length - visibleBoardColumns.length

  const selectedCardSummary = useMemo(
    () => boardCards.find((item) => item.agent_id === selectedCardId) ?? null,
    [boardCards, selectedCardId],
  )

  const boardHasItems = boardCards.length > 0

  useEffect(() => {
    try {
      window.localStorage.setItem(CONTROL_PANEL_COLLAPSED_STORAGE_KEY, controlPanelCollapsed ? '1' : '0')
    } catch {
      // Ignore storage failures and keep the toggle local to the current render.
    }
  }, [controlPanelCollapsed])

  useEffect(() => {
    try {
      window.localStorage.setItem(HIDE_EMPTY_COLUMNS_STORAGE_KEY, hideEmptyColumns ? '1' : '0')
    } catch {
      // Ignore storage failures and keep the toggle local to the current render.
    }
  }, [hideEmptyColumns])

  const refreshProviders = async (machineId = selectedMachine, nextCwd = cwd) => {
    if (!machineId) return
    setProviderLoading(true)
    setErrorMessage(null)
    try {
      const response = await getAiControlProviders(machineId, nextCwd.trim() || undefined)
      setProviders(response.providers)
      setSelectedProvider((current) => {
        if (current && response.providers.some((provider) => provider.id === current)) return current
        return response.providers.find((provider) => provider.status === 'ready')?.id ?? response.providers[0]?.id ?? ''
      })
    } catch (error: any) {
      setProviders([])
      setSelectedProvider('')
      setErrorMessage(error.message ?? '加载 provider 失败')
    } finally {
      setProviderLoading(false)
    }
  }

  const refreshHistory = async (machineId = selectedMachine, cursor?: string, append = false) => {
    if (!machineId) return
    setHistoryLoading(true)
    setErrorMessage(null)
    try {
      const response = await getAiControlHistory({ machine_id: machineId, cursor, limit: 30 })
      setHistory((current) => (append ? [...current, ...response.items] : response.items))
      setHistoryCursor(response.next_cursor)
    } catch (error: any) {
      if (!append) setHistory([])
      setErrorMessage(error.message ?? '加载历史失败')
    } finally {
      setHistoryLoading(false)
    }
  }

  const refreshSession = async (agentId: string, machineId?: string, silent = false) => {
    if (!silent) {
      setSessionLoading(true)
      setErrorMessage(null)
    }

    try {
      const [session, timelineResponse] = await Promise.all([
        getAiControlSession(agentId, machineId),
        getAiControlTimeline(agentId, { limit: 100, projection: 'full', machine_id: machineId }),
      ])
      setActiveSession(session)
      setSelectedAgentId(session.agent_id)
      setTimeline(timelineResponse.page.items)
      setSelectedMachine(session.machine_id)
      setSelectedProvider(session.provider)
      setCwd((current) => current || session.cwd)
      return session
    } catch (error: any) {
      if (!silent) setErrorMessage(error.message ?? '加载会话失败')
      throw error
    } finally {
      if (!silent) setSessionLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      setBootstrapping(true)
      setErrorMessage(null)
      try {
        const response = await getAiControlMachines()
        if (cancelled) return
        setMachines(response)
        const defaultMachine = response.find((machine) => machine.daemon_reachable) ?? response[0] ?? null
        if (defaultMachine) {
          setSelectedMachine(defaultMachine.id)
        }
      } catch (error: any) {
        if (!cancelled) setErrorMessage(error.message ?? '加载机器失败')
      } finally {
        if (!cancelled) setBootstrapping(false)
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedMachine) return
    void refreshProviders(selectedMachine, cwd)
    void refreshHistory(selectedMachine)
  }, [selectedMachine])

  useEffect(() => {
    if (!selectedProviderInfo) {
      setSelectedModeId('')
      setSelectedModel('')
      return
    }

    setSelectedModeId((current) => {
      if (current && selectedProviderInfo.modes.some((mode) => mode.id === current)) return current
      return selectedProviderInfo.default_mode_id ?? selectedProviderInfo.modes[0]?.id ?? ''
    })
    setSelectedModel((current) => {
      if (current && selectedProviderInfo.models.some((model) => model.id === current)) return current
      return selectedProviderInfo.models.find((model) => model.is_default)?.id ?? selectedProviderInfo.models[0]?.id ?? ''
    })
  }, [selectedProviderInfo])

  useEffect(() => {
    if (!activeSession || !selectedMachine) return
    if (activeSession.machine_id !== selectedMachine) {
      setActiveSession(null)
      setTimeline([])
      setSelectedAgentId('')
    }
  }, [activeSession, selectedMachine])

  useEffect(() => {
    if (!activeSession || isTerminalStatus(activeSession.status)) return

    const timer = window.setInterval(() => {
      void refreshSession(activeSession.agent_id, activeSession.machine_id, true)
      void refreshHistory(activeSession.machine_id)
    }, 2500)

    return () => window.clearInterval(timer)
  }, [activeSession])

  const handleOpenHistory = async (item: AiControlHistoryItem) => {
    setNotice(null)
    setSelectedAgentId(item.agent_id)
    try {
      await refreshSession(item.agent_id, item.machine_id)
    } catch {
      if (!item.persistence_handle) return
      try {
        setSessionLoading(true)
        const session = await resumeAiControlSession(item.agent_id, {
          machine_id: item.machine_id,
          handle: item.persistence_handle,
        })
        setNotice('已根据持久化句柄恢复会话')
        await refreshSession(session.agent_id, session.machine_id, true)
        await refreshHistory(item.machine_id)
      } catch (resumeError: any) {
        setErrorMessage(resumeError.message ?? '恢复会话失败')
      } finally {
        setSessionLoading(false)
      }
    }
  }

  const handleResume = async (item: AiControlHistoryItem, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (!item.persistence_handle) return
    setNotice(null)
    setSelectedAgentId(item.agent_id)
    setSessionLoading(true)
    setErrorMessage(null)
    try {
      const session = await resumeAiControlSession(item.agent_id, {
        machine_id: item.machine_id,
        handle: item.persistence_handle,
      })
      setNotice('会话已恢复到当前面板')
      await refreshSession(session.agent_id, session.machine_id, true)
      await refreshHistory(item.machine_id)
    } catch (error: any) {
      setErrorMessage(error.message ?? '恢复会话失败')
    } finally {
      setSessionLoading(false)
    }
  }

  const handleRefreshBoard = async () => {
    await refreshHistory()
    if (activeSession) {
      await refreshSession(activeSession.agent_id, activeSession.machine_id, true)
    }
  }

  const handleSubmit = async () => {
    const text = composer.trim()
    if (!text) return

    setSubmitting(true)
    setErrorMessage(null)
    setNotice(null)

    try {
      if (activeSession) {
        await sendAiControlMessage(
          activeSession.agent_id,
          {
            text,
            client_message_id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined,
          },
          activeSession.machine_id,
        )
        setComposer('')
        setNotice('消息已提交，面板会继续轮询最新 timeline')
        await refreshSession(activeSession.agent_id, activeSession.machine_id, true)
        await refreshHistory(activeSession.machine_id)
        return
      }

      if (!selectedMachine) throw new Error('请先选择机器')
      if (!selectedProvider) throw new Error('请先选择 provider')
      if (!cwd.trim()) throw new Error('请先填写工作目录')

      const session = await createAiControlSession({
        machine_id: selectedMachine,
        provider: selectedProvider,
        cwd: cwd.trim(),
        initial_prompt: text,
        mode_id: selectedModeId || undefined,
        model: selectedModel || undefined,
      })

      setComposer('')
      setNotice('新会话已创建')
      await refreshSession(session.agent_id, session.machine_id, true)
      await refreshHistory(session.machine_id)
    } catch (error: any) {
      setErrorMessage(error.message ?? '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="h-full min-h-0">
      <div className="flex h-full min-h-0 flex-col xl:flex-row">
        <aside className={`flex w-full flex-col border-b border-bd transition-all duration-200 xl:border-b-0 xl:border-r ${controlPanelCollapsed ? 'xl:w-[80px]' : 'xl:w-[360px]'}`}>
          {controlPanelCollapsed ? (
            <div className="flex w-full items-center justify-between gap-3 px-4 py-3 xl:h-full xl:flex-col xl:items-stretch xl:justify-start xl:px-3 xl:py-4">
              <div className="min-w-0 xl:text-center">
                <h2 className="text-sm font-bold text-tx-sub">AI 管控</h2>
                <p className="mt-1 text-xs text-tx-faint xl:hidden">已收起，展开后可切换机器和创建会话。</p>
              </div>

              <button
                onClick={() => setControlPanelCollapsed(false)}
                className="rounded-lg border border-bd px-3 py-2 text-xs text-tx-muted hover:text-tx-sub"
              >
                展开
              </button>

              <div className="hidden xl:flex xl:flex-col xl:gap-3 xl:pt-4">
                <div className="rounded-2xl border border-bd bg-raised/30 px-2 py-3 text-center">
                  <div className="text-[11px] text-tx-faint">机器</div>
                  <div className="mt-1 truncate text-sm text-tx-sub" title={selectedMachineInfo?.name ?? ''}>
                    {selectedMachineInfo?.name ?? '未选'}
                  </div>
                </div>
                <div className="rounded-2xl border border-bd bg-raised/30 px-2 py-3 text-center">
                  <div className="text-[11px] text-tx-faint">会话</div>
                  <div className="mt-1 text-lg font-semibold text-tx-sub">{boardCards.length}</div>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-4 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold">AI 管控</h2>
                    <p className="mt-1 text-xs text-tx-faint">会话看板版 bridge 面板，当前仍通过 REST 轮询接 paseo sidecar</p>
                  </div>
                  <button
                    onClick={() => setControlPanelCollapsed(true)}
                    className="rounded-lg border border-bd px-3 py-2 text-xs text-tx-muted hover:text-tx-sub"
                  >
                    收起
                  </button>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs text-tx-muted">机器</label>
                    {selectedMachineInfo && (
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] ${selectedMachineInfo.daemon_reachable ? 'border-green-700/40 bg-green-900/40 text-green-300' : 'border-red-700/40 bg-red-900/40 text-red-300'}`}>
                        {selectedMachineInfo.daemon_reachable ? 'daemon 已连通' : 'daemon 未连通'}
                      </span>
                    )}
                  </div>
                  <select
                    value={selectedMachine}
                    onChange={(event) => setSelectedMachine(event.target.value)}
                    className="w-full rounded-lg border border-bd-strong bg-raised px-3 py-2 text-tx"
                    disabled={bootstrapping || machines.length === 0}
                  >
                    {machines.map((machine) => (
                      <option key={machine.id} value={machine.id}>
                        {machine.daemon_reachable ? '🟢' : '🔴'} {machine.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-tx-muted">工作目录</label>
                  <div className="flex gap-2">
                    <input
                      value={cwd}
                      onChange={(event) => setCwd(event.target.value)}
                      placeholder="~/projects/myapp"
                      className="flex-1 rounded-lg border border-bd-strong bg-raised px-3 py-2 text-sm text-tx"
                    />
                    <button
                      onClick={() => void refreshProviders()}
                      disabled={!selectedMachine || providerLoading}
                      className="rounded-lg border border-bd px-3 py-2 text-xs text-tx-muted hover:text-tx-sub disabled:opacity-50"
                    >
                      刷新
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 md:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                  <div className="space-y-1">
                    <label className="text-xs text-tx-muted">Provider</label>
                    <select
                      value={selectedProvider}
                      onChange={(event) => setSelectedProvider(event.target.value)}
                      className="w-full rounded-lg border border-bd-strong bg-raised px-3 py-2 text-sm text-tx"
                      disabled={providerLoading || providers.length === 0}
                    >
                      {providers.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-tx-muted">Mode</label>
                    <select
                      value={selectedModeId}
                      onChange={(event) => setSelectedModeId(event.target.value)}
                      className="w-full rounded-lg border border-bd-strong bg-raised px-3 py-2 text-sm text-tx"
                      disabled={!selectedProviderInfo || selectedProviderInfo.modes.length === 0}
                    >
                      {selectedProviderInfo?.modes.map((mode) => (
                        <option key={mode.id} value={mode.id}>
                          {mode.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-tx-muted">Model</label>
                    <select
                      value={selectedModel}
                      onChange={(event) => setSelectedModel(event.target.value)}
                      className="w-full rounded-lg border border-bd-strong bg-raised px-3 py-2 text-sm text-tx"
                      disabled={!selectedProviderInfo || selectedProviderInfo.models.length === 0}
                    >
                      {selectedProviderInfo?.models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {selectedProviderInfo && (
                  <div className="space-y-1 rounded-lg border border-bd bg-raised/30 px-3 py-2 text-xs text-tx-faint">
                    <div className="flex items-center justify-between gap-2">
                      <span>{selectedProviderInfo.label}</span>
                      <span className={`rounded-full border px-2 py-0.5 ${selectedProviderInfo.status === 'ready' ? 'border-green-700/40 bg-green-900/40 text-green-300' : 'border-yellow-700/40 bg-yellow-900/40 text-yellow-300'}`}>
                        {selectedProviderInfo.status}
                      </span>
                    </div>
                    {selectedProviderInfo.fetched_at && <div>刷新时间：{formatTimeLabel(selectedProviderInfo.fetched_at)}</div>}
                    {selectedProviderInfo.error && <div className="text-red-300">{selectedProviderInfo.error}</div>}
                    {selectedProviderInfo.features.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {selectedProviderInfo.features.slice(0, 6).map((feature) => (
                          <span key={feature.id} className="rounded border border-bd/60 bg-page px-1.5 py-0.5 text-tx-faint">
                            {feature.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs text-tx-muted">
                    <span>{activeSession ? '继续当前会话' : '创建新会话'}</span>
                    {activeSession && (
                      <button
                        onClick={() => {
                          setActiveSession(null)
                          setTimeline([])
                          setSelectedAgentId('')
                          setNotice('已切换到新会话模式')
                        }}
                        className="rounded-lg border border-bd px-2 py-1 text-xs text-tx-muted hover:border-bd-strong hover:text-tx-sub"
                      >
                        新会话
                      </button>
                    )}
                  </div>
                  <textarea
                    value={composer}
                    onChange={(event) => setComposer(event.target.value)}
                    rows={4}
                    placeholder={activeSession ? '继续发送消息...' : '输入首条消息，创建新的 agent 会话...'}
                    className="w-full resize-none rounded-lg border border-bd-strong bg-raised px-3 py-2 text-tx"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault()
                        void handleSubmit()
                      }
                    }}
                  />
                  <button
                    onClick={() => void handleSubmit()}
                    disabled={submitting || !composer.trim()}
                    className="w-full rounded-lg bg-blue-600 px-3 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {submitting ? '提交中...' : activeSession ? '发送消息' : '创建会话'}
                  </button>
                </div>

                {(errorMessage || notice) && (
                  <div className={`rounded-lg border px-3 py-2 text-xs ${errorMessage ? 'border-red-700/40 bg-red-900/20 text-red-300' : 'border-blue-700/40 bg-blue-900/20 text-blue-300'}`}>
                    {errorMessage ?? notice}
                  </div>
                )}
              </div>

              <div className="border-t border-bd px-4 py-4">
                <div>
                  <h3 className="text-sm font-medium text-tx-sub">看板快照</h3>
                  <p className="mt-1 text-xs text-tx-faint">当前机器的会话卡片来自 bridge history，选中后在右侧查看完整 timeline。</p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {visibleBoardColumns.map((column) => (
                    <div key={column.id} className={`rounded-xl border px-3 py-2 ${columnTone(column.id)}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-tx-sub">{column.label}</span>
                        <span className="text-xs text-tx-faint">{column.items.length}</span>
                      </div>
                      <div className="mt-1 text-[11px] leading-5 text-tx-faint">{column.description}</div>
                    </div>
                  ))}
                </div>
                {hideEmptyColumns && hiddenEmptyColumnCount > 0 && (
                  <div className="mt-2 text-[11px] text-tx-faint">已隐藏 {hiddenEmptyColumnCount} 个空列。</div>
                )}
                <div className="mt-3 rounded-xl border border-bd bg-raised/20 px-3 py-2 text-xs text-tx-faint">
                  {historyLoading ? '正在刷新当前机器的看板历史...' : `当前筛出 ${boardCards.length} 张会话卡片`}
                </div>
              </div>
            </>
          )}
        </aside>

        <section className="flex min-h-0 flex-1 flex-col border-b border-bd xl:border-b-0 xl:border-r">
          <div className="border-b border-bd px-4 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-sm font-medium text-tx-sub">会话看板</h3>
                <p className="mt-1 text-xs text-tx-faint">按状态分列浏览当前机器会话，点击卡片即可在右侧打开完整详情。</p>
              </div>
              <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end lg:w-auto">
                <div className="relative flex-1 sm:min-w-[240px] lg:w-[280px] lg:flex-none">
                  <input
                    value={boardQuery}
                    onChange={(event) => setBoardQuery(event.target.value)}
                    placeholder="搜索标题、provider、路径或摘要"
                    className="w-full rounded-lg border border-bd-strong bg-raised px-3 py-2 pr-12 text-sm text-tx"
                  />
                  {boardQuery && (
                    <button
                      onClick={() => setBoardQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 py-1 text-xs text-tx-muted hover:text-tx-sub"
                    >
                      清空
                    </button>
                  )}
                </div>
                <button
                  onClick={() => void handleRefreshBoard()}
                  disabled={!selectedMachine || historyLoading}
                  className="rounded-lg border border-bd px-3 py-2 text-xs text-tx-muted hover:text-tx-sub disabled:opacity-50"
                >
                  {historyLoading ? '刷新中...' : '刷新看板'}
                </button>
                <button
                  onClick={() => setHideEmptyColumns((current) => !current)}
                  className={`rounded-lg border px-3 py-2 text-xs ${hideEmptyColumns ? 'border-blue-500/40 bg-blue-500/10 text-blue-300' : 'border-bd text-tx-muted hover:text-tx-sub'}`}
                >
                  {hideEmptyColumns ? '显示空列' : '隐藏空列'}
                </button>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden bg-page/30">
            {bootstrapping && (
              <div className="flex h-full items-center justify-center px-6 text-sm text-tx-faint">加载 bridge 机器中...</div>
            )}

            {!bootstrapping && !boardHasItems && (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-tx-faint">
                {deferredBoardQuery ? '当前过滤条件下没有匹配的会话卡片。' : '当前机器还没有 bridge 历史，会话创建后会直接进入看板。'}
              </div>
            )}

            {!bootstrapping && boardHasItems && (
              <div className="flex h-full min-w-max gap-4 p-4">
                {visibleBoardColumns.map((column) => (
                  <section key={column.id} className="flex h-full w-[320px] shrink-0 flex-col overflow-hidden rounded-2xl border border-bd bg-raised/20">
                    <div className={`border-b px-4 py-3 ${columnTone(column.id)}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <h4 className="text-sm font-medium text-tx-sub">{column.label}</h4>
                          <p className="mt-1 text-[11px] leading-5 text-tx-faint">{column.description}</p>
                        </div>
                        <span className="rounded-full border border-bd/70 bg-page px-2 py-0.5 text-xs text-tx-sub">{column.items.length}</span>
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 space-y-3">
                      {column.items.length === 0 && (
                        <div className="rounded-xl border border-dashed border-bd px-4 py-6 text-center text-xs leading-6 text-tx-faint">
                          这一列暂时没有会话。
                        </div>
                      )}

                      {column.items.map((item) => {
                        const isSelected = selectedCardId === item.agent_id
                        return (
                          <div
                            key={item.agent_id}
                            role="button"
                            tabIndex={0}
                            onClick={() => void handleOpenHistory(item)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                void handleOpenHistory(item)
                              }
                            }}
                            className={`group cursor-pointer rounded-xl border px-4 py-3 transition ${isSelected ? 'border-blue-500/50 bg-blue-500/10 shadow-[0_0_0_1px_rgba(59,130,246,0.15)]' : 'border-bd bg-page/70 hover:border-bd-strong hover:bg-raised/60'}`}
                          >
                            <div className="flex items-start gap-3">
                              <div className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${boardDotTone(item.board_status, item.attention)}`} />
                              <div className="min-w-0 flex-1 space-y-2">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-medium text-tx-sub">{item.title || item.agent_id}</div>
                                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-tx-faint">
                                      <span className="rounded-full border border-bd/70 bg-page px-1.5 py-0.5">{item.provider}</span>
                                      <span>{machineNameById.get(item.machine_id) ?? item.machine_id}</span>
                                    </div>
                                  </div>
                                  <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[11px] ${statusTone(item.status)}`}>
                                    {item.status}
                                  </span>
                                </div>

                                <p className="text-xs leading-6 text-tx-faint">
                                  {trimPreview(item.last_message_preview) ?? fallbackPreview(item)}
                                </p>

                                <div className="flex items-center justify-between gap-2 text-[11px] text-tx-faint">
                                  <span className="truncate" title={item.cwd}>{item.cwd}</span>
                                  <span className="shrink-0">{formatRelativeTimeLabel(item.updated_at)}</span>
                                </div>

                                <div className="flex flex-wrap gap-1">
                                  {item.attention && (
                                    <span className="rounded-full border border-amber-700/40 bg-amber-900/20 px-1.5 py-0.5 text-[11px] text-amber-300">
                                      {attentionReasonLabel(item.attention_reason)}
                                    </span>
                                  )}
                                  {item.persistence_handle && (
                                    <button
                                      onClick={(event) => void handleResume(item, event)}
                                      className="rounded-full border border-bd px-1.5 py-0.5 text-[11px] text-tx-muted hover:text-tx-sub"
                                    >
                                      恢复
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>

          {historyCursor && (
            <div className="border-t border-bd/50 px-4 py-3">
              <button
                onClick={() => void refreshHistory(selectedMachine, historyCursor, true)}
                disabled={historyLoading}
                className="w-full rounded-lg border border-bd px-3 py-2 text-xs text-tx-muted hover:text-tx-sub disabled:opacity-50"
              >
                {historyLoading ? '加载中...' : '加载更多会话卡片'}
              </button>
            </div>
          )}
        </section>

        <section className="flex min-h-0 flex-1 flex-col xl:max-w-[480px] xl:min-w-[420px]">
          <div className="flex items-center justify-between gap-3 border-b border-bd px-4 py-3">
            <div className="min-w-0">
              {activeSession ? (
                <>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate text-sm text-tx-sub">{activeSession.title || activeSession.agent_id}</span>
                    <span className={`rounded-full border px-1.5 py-0.5 text-[11px] ${statusTone(activeSession.status)}`}>
                      {activeSession.status}
                    </span>
                    {!isTerminalStatus(activeSession.status) && (
                      <span className="rounded-full border border-blue-700/40 bg-blue-900/20 px-1.5 py-0.5 text-[11px] text-blue-300">
                        轮询刷新中
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 overflow-hidden text-xs text-tx-faint">
                    <span>{activeSession.provider}</span>
                    <span>·</span>
                    <span>{machineNameById.get(activeSession.machine_id) ?? activeSession.machine_id}</span>
                    <span>·</span>
                    <span className="truncate" title={activeSession.cwd}>{activeSession.cwd}</span>
                  </div>
                </>
              ) : selectedCardSummary && sessionLoading ? (
                <div>
                  <h3 className="truncate text-sm text-tx-sub">正在打开 {selectedCardSummary.title || selectedCardSummary.agent_id}</h3>
                  <p className="mt-1 text-xs text-tx-faint">正在同步 session snapshot 与完整 timeline。</p>
                </div>
              ) : (
                <div>
                  <h3 className="text-sm text-tx-sub">等待会话</h3>
                  <p className="mt-1 text-xs text-tx-faint">从中间看板选择会话，右侧查看完整 timeline 并继续发消息。</p>
                </div>
              )}
            </div>

            {activeSession && (
              <button
                onClick={() => void refreshSession(activeSession.agent_id, activeSession.machine_id)}
                disabled={sessionLoading}
                className="rounded-lg border border-bd px-2.5 py-1.5 text-xs text-tx-muted hover:text-tx-sub disabled:opacity-50"
              >
                刷新 timeline
              </button>
            )}
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto overflow-x-hidden p-4 text-sm">
            {!activeSession && !sessionLoading && (
              <p className="mt-8 text-center text-tx-faint">中间看板负责切换会话，右侧继续承担完整 timeline 与续聊操作。</p>
            )}

            {activeSession && timeline.length === 0 && !sessionLoading && (
              <p className="mt-8 text-center text-tx-faint">timeline 还没有内容，面板会继续轮询。</p>
            )}

            {sessionLoading && (
              <div className="rounded-xl border border-bd bg-raised/40 px-4 py-3 text-sm text-tx-faint">
                正在同步 session snapshot 与 timeline...
              </div>
            )}

            {timeline.map((item) => {
              const argumentsText = stringifyPayload(item.arguments)
              const resultText = stringifyPayload(item.result)

              return (
                <div key={item.id} className={`space-y-3 rounded-xl border p-4 ${timelineTone(item)}`}>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-tx-faint">
                    <span className="rounded-full border border-bd bg-page px-2 py-0.5 text-tx-sub">{item.role}</span>
                    <span>{item.kind}</span>
                    {item.tool_name && <span>· {item.tool_name}</span>}
                    {item.seq != null && <span>· seq {item.seq}</span>}
                    <span>· {formatTimeLabel(item.created_at)}</span>
                  </div>

                  {item.text && <div className="whitespace-pre-wrap leading-relaxed text-tx">{item.text}</div>}

                  {argumentsText && (
                    <div className="space-y-1">
                      <div className="text-xs text-tx-muted">arguments</div>
                      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-bd/70 bg-page/70 p-3 text-xs text-tx-faint">{argumentsText}</pre>
                    </div>
                  )}

                  {resultText && (
                    <div className="space-y-1">
                      <div className="text-xs text-tx-muted">result</div>
                      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-bd/70 bg-page/70 p-3 text-xs text-tx-faint">{resultText}</pre>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}