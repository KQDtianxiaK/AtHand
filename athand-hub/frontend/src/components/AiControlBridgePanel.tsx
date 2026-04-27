import { useDeferredValue, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'

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
const HIDDEN_BOARD_COLUMNS_STORAGE_KEY = 'athand.aiControl.hiddenBoardColumns'

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
const BOARD_COLUMN_IDS = new Set(BOARD_COLUMNS.map((column) => column.id))

const shellPanelClass = 'rounded-[1.75rem] border border-bd bg-surface/[0.88] shadow-ambient backdrop-blur-xl'
const sectionCardClass = 'rounded-[1.35rem] border border-bd bg-page/[0.52]'
const insetCardClass = 'rounded-[1.1rem] border border-bd bg-page/[0.4]'
const fieldClass = 'w-full rounded-[1.05rem] border border-bd-strong bg-surface-elevated/[0.9] px-3 py-2.5 text-sm text-tx shadow-inset outline-none transition placeholder:text-tx-faint focus:border-accent/40 focus:ring-2 focus:ring-accent/10'
const secondaryButtonClass = 'rounded-[1rem] border border-bd bg-page/[0.55] px-3 py-2 text-xs font-medium text-tx-muted transition hover:border-bd-strong hover:bg-surface-elevated/[0.92] hover:text-tx-sub disabled:opacity-50'
const primaryButtonClass = 'w-full rounded-[1.1rem] bg-accent px-3 py-2.5 text-sm font-medium text-white transition hover:bg-accent-strong disabled:opacity-50'

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
  if (DONE_STATUSES.has(normalized)) return 'border-success/25 bg-success/10 text-success'
  if (ERROR_STATUSES.has(normalized)) return 'border-danger/25 bg-danger/10 text-danger'
  if (AWAITING_PERMISSION_STATUSES.has(normalized)) return 'border-warning/25 bg-warning/10 text-warning'
  if (INITIALIZING_STATUSES.has(normalized)) return 'border-brand/20 bg-brand-soft/[0.75] text-brand'
  if (ACTIVE_STATUSES.has(normalized)) return 'border-accent/25 bg-accent-soft text-accent'
  return 'border-bd bg-page/[0.72] text-tx-sub'
}

function columnTone(columnId: BoardColumnId) {
  if (columnId === 'done') return 'border-success/20 bg-success/10'
  if (columnId === 'error') return 'border-danger/20 bg-danger/10'
  if (columnId === 'awaiting_permission') return 'border-warning/20 bg-warning/10'
  if (columnId === 'active') return 'border-accent/20 bg-accent-soft/[0.72]'
  if (columnId === 'initializing') return 'border-brand/20 bg-brand-soft/[0.68]'
  return 'border-bd bg-page/[0.45]'
}

function boardDotTone(columnId: BoardColumnId, attention: boolean) {
  if (attention) return 'bg-warning'
  if (columnId === 'done') return 'bg-success'
  if (columnId === 'error') return 'bg-danger'
  if (columnId === 'awaiting_permission') return 'bg-warning'
  if (columnId === 'active') return 'bg-accent'
  if (columnId === 'initializing') return 'bg-brand'
  return 'bg-tx-faint'
}

function timelineTone(item: AiControlTimelineItem) {
  if (item.role === 'user') return 'border-accent/20 bg-accent-soft/[0.55]'
  if (item.role === 'assistant') return 'border-success/20 bg-success/[0.08]'
  if (item.role === 'tool') return 'border-warning/20 bg-warning/[0.08]'
  return 'border-bd bg-page/[0.45]'
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

function readStoredHiddenBoardColumns() {
  if (typeof window === 'undefined') return [] as BoardColumnId[]
  try {
    const rawValue = window.localStorage.getItem(HIDDEN_BOARD_COLUMNS_STORAGE_KEY)
    if (!rawValue) return [] as BoardColumnId[]
    const parsed = JSON.parse(rawValue)
    if (!Array.isArray(parsed)) return [] as BoardColumnId[]
    return parsed.filter((value): value is BoardColumnId => typeof value === 'string' && BOARD_COLUMN_IDS.has(value as BoardColumnId))
  } catch {
    return [] as BoardColumnId[]
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
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
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
  const [hiddenBoardColumnIds, setHiddenBoardColumnIds] = useState<BoardColumnId[]>(() => readStoredHiddenBoardColumns())

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
  const hiddenBoardColumnIdSet = useMemo(() => new Set(hiddenBoardColumnIds), [hiddenBoardColumnIds])
  const visibleBoardColumns = useMemo(
    () => boardColumns.filter((column) => !hiddenBoardColumnIdSet.has(column.id) && (!hideEmptyColumns || column.items.length > 0)),
    [boardColumns, hiddenBoardColumnIdSet, hideEmptyColumns],
  )
  const autoHiddenEmptyColumnCount = useMemo(
    () => (hideEmptyColumns ? boardColumns.filter((column) => !hiddenBoardColumnIdSet.has(column.id) && column.items.length === 0).length : 0),
    [boardColumns, hiddenBoardColumnIdSet, hideEmptyColumns],
  )
  const manuallyHiddenColumnCount = hiddenBoardColumnIds.length

  const selectedCardSummary = useMemo(
    () => boardCards.find((item) => item.agent_id === selectedCardId) ?? null,
    [boardCards, selectedCardId],
  )

  const boardHasItems = boardCards.length > 0
  const boardHasVisibleColumns = visibleBoardColumns.length > 0

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

  useEffect(() => {
    try {
      window.localStorage.setItem(HIDDEN_BOARD_COLUMNS_STORAGE_KEY, JSON.stringify(hiddenBoardColumnIds))
    } catch {
      // Ignore storage failures and keep the toggle local to the current render.
    }
  }, [hiddenBoardColumnIds])

  const focusComposer = () => {
    const focusInput = () => {
      composerRef.current?.focus()
      composerRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }

    if (controlPanelCollapsed) {
      setControlPanelCollapsed(false)
      window.setTimeout(focusInput, 0)
      return
    }

    focusInput()
  }

  const toggleBoardColumnVisibility = (columnId: BoardColumnId) => {
    setHiddenBoardColumnIds((current) => (
      current.includes(columnId) ? current.filter((value) => value !== columnId) : [...current, columnId]
    ))
  }

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
    <div className="h-full min-h-0 p-4 lg:p-6">
      <div className="flex h-full min-h-0 flex-col gap-4 xl:flex-row">
        <aside className={`flex w-full flex-col overflow-hidden ${shellPanelClass} transition-all duration-300 ${controlPanelCollapsed ? 'xl:w-[108px]' : 'xl:w-[370px]'}`}>
          {controlPanelCollapsed ? (
            <div className="flex w-full items-center justify-between gap-3 px-4 py-4 xl:h-full xl:flex-col xl:items-stretch xl:justify-start xl:px-4 xl:py-5">
              <div className={`${sectionCardClass} flex min-w-0 items-center gap-3 px-3 py-3 xl:flex-col xl:items-center xl:gap-2 xl:px-2 xl:py-4`}>
                <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[1rem] border border-accent/20 bg-accent-soft text-sm font-semibold tracking-[-0.05em] text-accent">
                  AI
                </div>
                <div className="min-w-0 xl:text-center">
                  <h2 className="truncate text-sm font-semibold tracking-[-0.03em] text-tx">AI 管控</h2>
                  <p className="mt-1 text-xs text-tx-faint xl:hidden">已收起，展开后可切换机器和创建会话。</p>
                </div>
              </div>

              <button
                onClick={() => setControlPanelCollapsed(false)}
                className={secondaryButtonClass}
              >
                展开
              </button>

              <div className="hidden xl:flex xl:flex-col xl:gap-3 xl:pt-2">
                <div className={`${insetCardClass} px-2 py-3 text-center`}>
                  <div className="text-[11px] text-tx-faint">机器</div>
                  <div className="mt-1 truncate text-sm text-tx-sub" title={selectedMachineInfo?.name ?? ''}>
                    {selectedMachineInfo?.name ?? '未选'}
                  </div>
                </div>
                <div className={`${insetCardClass} px-2 py-3 text-center`}>
                  <div className="text-[11px] text-tx-faint">会话</div>
                  <div className="mt-1 text-lg font-semibold text-tx-sub">{boardCards.length}</div>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
                <div className={`${sectionCardClass} p-4`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Bridge Desk</div>
                      <h2 className="mt-2 text-xl font-semibold tracking-[-0.04em] text-tx">AI 管控</h2>
                      <p className="mt-2 text-sm leading-6 text-tx-muted">把机器、provider、创建入口和当前活跃会话收进同一块控制台里，继续保留现有 bridge 轮询逻辑。</p>
                    </div>
                    <button
                      onClick={() => setControlPanelCollapsed(true)}
                      className={secondaryButtonClass}
                    >
                      收起
                    </button>
                  </div>
                </div>

                <div className={`${sectionCardClass} space-y-4 p-4`}>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Runtime</div>
                      <div className="mt-1 text-sm font-medium text-tx-sub">机器与 provider</div>
                    </div>
                    {selectedMachineInfo && (
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${selectedMachineInfo.daemon_reachable ? 'border-success/25 bg-success/10 text-success' : 'border-danger/25 bg-danger/10 text-danger'}`}>
                        {selectedMachineInfo.daemon_reachable ? 'daemon 已连通' : 'daemon 未连通'}
                      </span>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-tx-muted">机器</label>
                    <select
                      value={selectedMachine}
                      onChange={(event) => setSelectedMachine(event.target.value)}
                      className={fieldClass}
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
                        className={`${fieldClass} flex-1`}
                      />
                      <button
                        onClick={() => void refreshProviders()}
                        disabled={!selectedMachine || providerLoading}
                        className={secondaryButtonClass}
                      >
                        刷新
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                    <div className="space-y-2">
                      <label className="text-xs text-tx-muted">Provider</label>
                      <select
                        value={selectedProvider}
                        onChange={(event) => setSelectedProvider(event.target.value)}
                        className={fieldClass}
                        disabled={providerLoading || providers.length === 0}
                      >
                        {providers.map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {provider.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-tx-muted">Mode</label>
                      <select
                        value={selectedModeId}
                        onChange={(event) => setSelectedModeId(event.target.value)}
                        className={fieldClass}
                        disabled={!selectedProviderInfo || selectedProviderInfo.modes.length === 0}
                      >
                        {selectedProviderInfo?.modes.map((mode) => (
                          <option key={mode.id} value={mode.id}>
                            {mode.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-tx-muted">Model</label>
                      <select
                        value={selectedModel}
                        onChange={(event) => setSelectedModel(event.target.value)}
                        className={fieldClass}
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
                    <div className={`${insetCardClass} space-y-2 px-3 py-3 text-xs text-tx-faint`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-tx-sub">{selectedProviderInfo.label}</span>
                        <span className={`rounded-full border px-2 py-0.5 ${selectedProviderInfo.status === 'ready' ? 'border-success/25 bg-success/10 text-success' : 'border-warning/25 bg-warning/10 text-warning'}`}>
                          {selectedProviderInfo.status}
                        </span>
                      </div>
                      {selectedProviderInfo.fetched_at && <div>刷新时间：{formatTimeLabel(selectedProviderInfo.fetched_at)}</div>}
                      {selectedProviderInfo.error && <div className="text-danger">{selectedProviderInfo.error}</div>}
                      {selectedProviderInfo.features.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {selectedProviderInfo.features.slice(0, 6).map((feature) => (
                            <span key={feature.id} className="rounded-full border border-bd bg-surface-elevated/[0.9] px-2 py-0.5 text-[11px] text-tx-faint">
                              {feature.label}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className={`${sectionCardClass} space-y-3 p-4`}>
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
                        className={secondaryButtonClass}
                      >
                        新会话
                      </button>
                    )}
                  </div>
                  <div className={`rounded-[1.1rem] border px-3 py-3 text-xs leading-6 ${activeSession ? 'border-accent/20 bg-accent-soft/[0.65] text-accent-strong' : 'border-bd bg-page/[0.45] text-tx-faint'}`}>
                    {activeSession
                      ? `当前输入会直接发送到“${activeSession.title || activeSession.agent_id}”。提交后卡片会跟随 provider 状态自动移动，通常会先进入“执行中”，结束后再回到“待继续”或“已完成”。`
                      : '想继续一个已有会话时，先点击中间看板里的卡片；未选中会话时，这里的输入会创建新会话。'}
                  </div>
                  <textarea
                    ref={composerRef}
                    value={composer}
                    onChange={(event) => setComposer(event.target.value)}
                    rows={4}
                    placeholder={activeSession ? '继续发送消息...' : '输入首条消息，创建新的 agent 会话...'}
                    className={`${fieldClass} min-h-[112px] resize-none`}
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
                    className={primaryButtonClass}
                  >
                    {submitting ? '提交中...' : activeSession ? '发送消息' : '创建会话'}
                  </button>
                </div>

                {(errorMessage || notice) && (
                  <div className={`rounded-[1.1rem] border px-3 py-3 text-xs ${errorMessage ? 'border-danger/25 bg-danger/10 text-danger' : 'border-accent/20 bg-accent-soft/[0.65] text-accent-strong'}`}>
                    {errorMessage ?? notice}
                  </div>
                )}
              </div>

              <div className="mt-auto border-t border-bd/70 px-5 py-5">
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Board Snapshot</div>
                  <h3 className="mt-2 text-sm font-medium text-tx-sub">看板快照</h3>
                  <p className="mt-1 text-xs leading-6 text-tx-faint">当前机器的会话卡片来自 bridge history，选中后在右侧查看完整 timeline。</p>
                </div>
                {boardHasVisibleColumns ? (
                  <div className="mt-4 grid grid-cols-2 gap-2.5">
                    {visibleBoardColumns.map((column) => (
                      <div key={column.id} className={`rounded-[1.15rem] border px-3 py-3 ${columnTone(column.id)}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-tx-sub">{column.label}</span>
                          <span className="text-xs text-tx-faint">{column.items.length}</span>
                        </div>
                        <div className="mt-1 text-[11px] leading-5 text-tx-faint">{column.description}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-[1.2rem] border border-dashed border-bd px-4 py-5 text-center text-xs leading-6 text-tx-faint">
                    当前没有可见列，可在中间看板里重新显示列。
                  </div>
                )}
                {(manuallyHiddenColumnCount > 0 || autoHiddenEmptyColumnCount > 0) && (
                  <div className="mt-3 text-[11px] text-tx-faint">
                    {manuallyHiddenColumnCount > 0 && `手动隐藏 ${manuallyHiddenColumnCount} 列`}
                    {manuallyHiddenColumnCount > 0 && autoHiddenEmptyColumnCount > 0 && ' · '}
                    {autoHiddenEmptyColumnCount > 0 && `空列自动隐藏 ${autoHiddenEmptyColumnCount} 列`}
                  </div>
                )}
                <div className={`${insetCardClass} mt-3 px-3 py-3 text-xs text-tx-faint`}>
                  {historyLoading ? '正在刷新当前机器的看板历史...' : `当前筛出 ${boardCards.length} 张会话卡片`}
                </div>
              </div>
            </>
          )}
        </aside>

        <section className={`flex min-h-[420px] flex-1 flex-col overflow-hidden ${shellPanelClass}`}>
          <div className="border-b border-bd/70 px-5 py-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Session Board</div>
                <h3 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-tx">会话看板</h3>
                <p className="mt-2 text-sm leading-6 text-tx-muted">按状态分列浏览当前机器会话，点击卡片即可在右侧打开完整详情。</p>
              </div>
              <div className="flex w-full flex-col gap-3 lg:w-auto">
                <div className={`${sectionCardClass} flex w-full flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-end lg:w-auto`}>
                  <div className="relative flex-1 sm:min-w-[240px] lg:w-[280px] lg:flex-none">
                    <input
                      value={boardQuery}
                      onChange={(event) => setBoardQuery(event.target.value)}
                      placeholder="搜索标题、provider、路径或摘要"
                      className={`${fieldClass} pr-12`}
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
                    className={secondaryButtonClass}
                  >
                    {historyLoading ? '刷新中...' : '刷新看板'}
                  </button>
                  <button
                    onClick={() => setHideEmptyColumns((current) => !current)}
                    className={`${secondaryButtonClass} ${hideEmptyColumns ? 'border-accent/25 bg-accent-soft text-accent' : ''}`}
                  >
                    {hideEmptyColumns ? '显示空列' : '隐藏空列'}
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-tx-faint">
                  <span className="mr-1">列显示：</span>
                  {boardColumns.map((column) => {
                    const hidden = hiddenBoardColumnIdSet.has(column.id)
                    return (
                      <button
                        key={column.id}
                        onClick={() => toggleBoardColumnVisibility(column.id)}
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${hidden ? 'border-bd bg-page/[0.4] text-tx-faint opacity-70' : 'border-accent/25 bg-accent-soft text-accent hover:text-accent-strong'}`}
                        title={hidden ? `显示 ${column.label}` : `隐藏 ${column.label}`}
                      >
                        {column.label} {column.items.length}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden bg-page/[0.28]">
            {bootstrapping && (
              <div className="flex h-full items-center justify-center px-6 text-sm text-tx-faint">加载 bridge 机器中...</div>
            )}

            {!bootstrapping && !boardHasItems && (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-tx-faint">
                {deferredBoardQuery ? '当前过滤条件下没有匹配的会话卡片。' : '当前机器还没有 bridge 历史，会话创建后会直接进入看板。'}
              </div>
            )}

            {!bootstrapping && boardHasItems && !boardHasVisibleColumns && (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-tx-faint">
                当前所有列都被隐藏了。请使用上方的列显示开关重新打开至少一列。
              </div>
            )}

            {!bootstrapping && boardHasItems && boardHasVisibleColumns && (
              <div className="flex h-full min-w-max gap-4 p-5">
                {visibleBoardColumns.map((column) => (
                  <section key={column.id} className="flex h-full w-[324px] shrink-0 flex-col overflow-hidden rounded-[1.6rem] border border-bd bg-page/[0.42] shadow-float">
                    <div className={`border-b px-4 py-4 ${columnTone(column.id)}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <h4 className="text-sm font-medium tracking-[-0.02em] text-tx-sub">{column.label}</h4>
                          <p className="mt-1 text-[11px] leading-5 text-tx-faint">{column.description}</p>
                        </div>
                        <span className="rounded-full border border-bd/70 bg-surface-elevated/[0.9] px-2 py-0.5 text-xs text-tx-sub">{column.items.length}</span>
                      </div>
                    </div>

                    <div className="flex-1 space-y-3 overflow-y-auto p-3.5">
                      {column.items.length === 0 && (
                        <div className="rounded-[1.2rem] border border-dashed border-bd px-4 py-6 text-center text-xs leading-6 text-tx-faint">
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
                            className={`group cursor-pointer rounded-[1.25rem] border px-4 py-3 transition ${isSelected ? 'border-accent/25 bg-accent-soft/[0.78] ring-1 ring-accent/15' : 'border-bd bg-surface-elevated/[0.88] hover:border-bd-strong hover:bg-surface-elevated/[0.96]'}`}
                          >
                            <div className="flex items-start gap-3">
                              <div className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${boardDotTone(item.board_status, item.attention)}`} />
                              <div className="min-w-0 flex-1 space-y-2">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-medium text-tx-sub">{item.title || item.agent_id}</div>
                                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-tx-faint">
                                      <span className="rounded-full border border-bd/70 bg-page/[0.65] px-1.5 py-0.5">{item.provider}</span>
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
                                    <span className="rounded-full border border-warning/25 bg-warning/10 px-1.5 py-0.5 text-[11px] text-warning">
                                      {attentionReasonLabel(item.attention_reason)}
                                    </span>
                                  )}
                                  {item.persistence_handle && (
                                    <button
                                      onClick={(event) => void handleResume(item, event)}
                                      className="rounded-full border border-bd bg-page/[0.45] px-1.5 py-0.5 text-[11px] text-tx-muted transition hover:border-bd-strong hover:text-tx-sub"
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
            <div className="border-t border-bd/50 px-5 py-4">
              <button
                onClick={() => void refreshHistory(selectedMachine, historyCursor, true)}
                disabled={historyLoading}
                className={`w-full ${secondaryButtonClass}`}
              >
                {historyLoading ? '加载中...' : '加载更多会话卡片'}
              </button>
            </div>
          )}
        </section>

        <section className={`flex min-h-[420px] flex-1 flex-col overflow-hidden xl:max-w-[500px] xl:min-w-[430px] ${shellPanelClass}`}>
          <div className="flex items-center justify-between gap-3 border-b border-bd/70 px-5 py-5">
            <div className="min-w-0">
              {activeSession ? (
                <>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium tracking-[-0.02em] text-tx-sub">{activeSession.title || activeSession.agent_id}</span>
                    <span className={`rounded-full border px-1.5 py-0.5 text-[11px] ${statusTone(activeSession.status)}`}>
                      {activeSession.status}
                    </span>
                    {!isTerminalStatus(activeSession.status) && (
                      <span className="rounded-full border border-accent/25 bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent">
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
                  <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Timeline Detail</div>
                  <h3 className="mt-2 text-sm font-medium text-tx-sub">等待会话</h3>
                  <p className="mt-1 text-xs text-tx-faint">从中间看板选择会话，右侧查看完整 timeline 并继续发消息。</p>
                </div>
              )}
            </div>

            {activeSession && (
              <button
                onClick={() => void refreshSession(activeSession.agent_id, activeSession.machine_id)}
                disabled={sessionLoading}
                className={secondaryButtonClass}
              >
                刷新 timeline
              </button>
            )}
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto overflow-x-hidden p-5 text-sm">
            {activeSession && (
              <div className="rounded-[1.2rem] border border-accent/20 bg-accent-soft/[0.68] px-4 py-3 text-xs leading-6 text-accent-strong">
                <div>当前详情页对应的就是活动会话。继续对话时，点击左侧输入框发送；如果左栏已收起，可以先展开再续聊。</div>
                <button
                  onClick={focusComposer}
                  className="mt-2 rounded-[1rem] border border-accent/25 bg-surface-elevated/[0.92] px-3 py-2 text-xs font-medium text-accent transition hover:text-accent-strong"
                >
                  {controlPanelCollapsed ? '展开并继续对话' : '聚焦输入框继续对话'}
                </button>
              </div>
            )}

            {!activeSession && !sessionLoading && (
              <p className="mt-8 text-center text-tx-faint">中间看板负责切换会话，右侧继续承担完整 timeline 与续聊操作。</p>
            )}

            {activeSession && timeline.length === 0 && !sessionLoading && (
              <p className="mt-8 text-center text-tx-faint">timeline 还没有内容，面板会继续轮询。</p>
            )}

            {sessionLoading && (
              <div className="rounded-[1.2rem] border border-bd bg-page/[0.45] px-4 py-3 text-sm text-tx-faint">
                正在同步 session snapshot 与 timeline...
              </div>
            )}

            {timeline.map((item) => {
              const argumentsText = stringifyPayload(item.arguments)
              const resultText = stringifyPayload(item.result)

              return (
                <div key={item.id} className={`space-y-3 rounded-[1.25rem] border p-4 ${timelineTone(item)}`}>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-tx-faint">
                    <span className="rounded-full border border-bd bg-surface-elevated/[0.9] px-2 py-0.5 text-tx-sub">{item.role}</span>
                    <span>{item.kind}</span>
                    {item.tool_name && <span>· {item.tool_name}</span>}
                    {item.seq != null && <span>· seq {item.seq}</span>}
                    <span>· {formatTimeLabel(item.created_at)}</span>
                  </div>

                  {item.text && <div className="whitespace-pre-wrap leading-relaxed text-tx">{item.text}</div>}

                  {argumentsText && (
                    <div className="space-y-1">
                      <div className="text-xs text-tx-muted">arguments</div>
                      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-[1rem] border border-bd/70 bg-surface-elevated/[0.75] p-3 text-xs text-tx-faint">{argumentsText}</pre>
                    </div>
                  )}

                  {resultText && (
                    <div className="space-y-1">
                      <div className="text-xs text-tx-muted">result</div>
                      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-[1rem] border border-bd/70 bg-surface-elevated/[0.75] p-3 text-xs text-tx-faint">{resultText}</pre>
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