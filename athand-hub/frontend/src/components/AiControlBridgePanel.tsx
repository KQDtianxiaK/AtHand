import { useEffect, useMemo, useState } from 'react'

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

const TERMINAL_STATUSES = new Set(['done', 'failed', 'cancelled', 'canceled'])

function formatTimeLabel(value: string | null | undefined) {
  if (!value) return '未知时间'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function statusTone(status: string) {
  if (status === 'done') return 'bg-green-900/50 text-green-300 border-green-700/40'
  if (status === 'failed') return 'bg-red-900/50 text-red-300 border-red-700/40'
  if (status === 'queued') return 'bg-yellow-900/50 text-yellow-300 border-yellow-700/40'
  return 'bg-raised text-tx-sub border-bd'
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

export default function AiControlBridgePanel({ onOpenLegacy }: { onOpenLegacy: () => void }) {
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

  const selectedMachineInfo = useMemo(
    () => machines.find((machine) => machine.id === selectedMachine) ?? null,
    [machines, selectedMachine],
  )
  const selectedProviderInfo = useMemo(
    () => providers.find((provider) => provider.id === selectedProvider) ?? null,
    [providers, selectedProvider],
  )

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
    if (!activeSession || TERMINAL_STATUSES.has(activeSession.status)) return

    const timer = window.setInterval(() => {
      void refreshSession(activeSession.agent_id, activeSession.machine_id, true)
      void refreshHistory(activeSession.machine_id)
    }, 2500)

    return () => window.clearInterval(timer)
  }, [activeSession])

  const handleOpenHistory = async (item: AiControlHistoryItem) => {
    setNotice(null)
    try {
      await refreshSession(item.agent_id, item.machine_id)
    } catch (error: any) {
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

  const handleResume = async (item: AiControlHistoryItem, event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (!item.persistence_handle) return
    setNotice(null)
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
    <div className="h-full flex flex-col lg:flex-row">
      <div className="lg:w-96 border-b lg:border-b-0 lg:border-r border-bd flex flex-col">
        <div className="p-4 space-y-3 border-b border-bd">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">AI 管控</h2>
              <p className="text-xs text-tx-faint mt-1">bridge 面板，当前通过 REST 轮询接 paseo sidecar</p>
            </div>
            <button
              onClick={onOpenLegacy}
              className="text-xs px-3 py-1.5 rounded-lg border border-bd text-tx-muted hover:text-tx-sub hover:border-bd-strong"
            >
              旧版页面
            </button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs text-tx-muted">机器</label>
              {selectedMachineInfo && (
                <span className={`text-[11px] px-2 py-0.5 rounded-full border ${selectedMachineInfo.daemon_reachable ? 'bg-green-900/40 text-green-300 border-green-700/40' : 'bg-red-900/40 text-red-300 border-red-700/40'}`}>
                  {selectedMachineInfo.daemon_reachable ? 'daemon 已连通' : 'daemon 未连通'}
                </span>
              )}
            </div>
            <select
              value={selectedMachine}
              onChange={(event) => setSelectedMachine(event.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-raised text-tx border border-bd-strong"
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
                className="flex-1 px-3 py-2 rounded-lg bg-raised text-tx border border-bd-strong text-sm"
              />
              <button
                onClick={() => void refreshProviders()}
                disabled={!selectedMachine || providerLoading}
                className="px-3 py-2 rounded-lg border border-bd text-xs text-tx-muted hover:text-tx-sub disabled:opacity-50"
              >
                刷新
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs text-tx-muted">Provider</label>
              <select
                value={selectedProvider}
                onChange={(event) => setSelectedProvider(event.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-raised text-tx border border-bd-strong text-sm"
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
                className="w-full px-3 py-2 rounded-lg bg-raised text-tx border border-bd-strong text-sm"
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
                className="w-full px-3 py-2 rounded-lg bg-raised text-tx border border-bd-strong text-sm"
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
            <div className="rounded-lg border border-bd bg-raised/30 px-3 py-2 text-xs text-tx-faint space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span>{selectedProviderInfo.label}</span>
                <span className={`px-2 py-0.5 rounded-full border ${selectedProviderInfo.status === 'ready' ? 'bg-green-900/40 text-green-300 border-green-700/40' : 'bg-yellow-900/40 text-yellow-300 border-yellow-700/40'}`}>
                  {selectedProviderInfo.status}
                </span>
              </div>
              {selectedProviderInfo.fetched_at && <div>刷新时间：{formatTimeLabel(selectedProviderInfo.fetched_at)}</div>}
              {selectedProviderInfo.error && <div className="text-red-300">{selectedProviderInfo.error}</div>}
              {selectedProviderInfo.features.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selectedProviderInfo.features.slice(0, 6).map((feature) => (
                    <span key={feature.id} className="px-1.5 py-0.5 rounded bg-page text-tx-faint border border-bd/60">
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
                    setNotice('已切换到新会话模式')
                  }}
                  className="text-xs px-2 py-1 rounded-lg border border-bd hover:border-bd-strong text-tx-muted hover:text-tx-sub"
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
              className="w-full px-3 py-2 rounded-lg bg-raised text-tx border border-bd-strong resize-none"
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
              className="w-full px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
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

        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-3 border-b border-bd flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-medium text-tx-sub">历史会话</h3>
              <p className="text-xs text-tx-faint">按当前机器过滤，可直接打开或恢复</p>
            </div>
            <button
              onClick={() => void refreshHistory()}
              disabled={!selectedMachine || historyLoading}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-bd text-tx-muted hover:text-tx-sub disabled:opacity-50"
            >
              刷新
            </button>
          </div>

          {bootstrapping && (
            <p className="px-4 py-4 text-sm text-tx-faint">加载 bridge 机器中...</p>
          )}

          {!bootstrapping && history.length === 0 && !historyLoading && (
            <p className="px-4 py-4 text-sm text-tx-faint">当前机器还没有 bridge 历史。</p>
          )}

          {history.map((item) => {
            const isActive = activeSession?.agent_id === item.agent_id
            return (
              <div
                key={item.agent_id}
                onClick={() => void handleOpenHistory(item)}
                className={`relative border-b border-bd/50 px-4 py-3 cursor-pointer hover:bg-raised/40 ${isActive ? 'bg-raised/50' : ''}`}
              >
                <div className="flex items-start gap-2 pr-16">
                  <div className={`mt-1 h-2.5 w-2.5 rounded-full ${item.attention ? 'bg-yellow-400' : item.status === 'done' ? 'bg-green-400' : item.status === 'failed' ? 'bg-red-400' : 'bg-blue-400'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm text-tx-sub truncate">{item.title || item.agent_id}</span>
                      <span className={`text-[11px] px-1.5 py-0.5 rounded-full border ${statusTone(item.status)}`}>
                        {item.status}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-tx-faint">
                      <span>{item.provider}</span>
                      <span>·</span>
                      <span className="truncate" title={item.cwd}>{item.cwd}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-tx-faint">更新时间：{formatTimeLabel(item.updated_at)}</div>
                  </div>
                </div>
                {item.persistence_handle && (
                  <button
                    onClick={(event) => void handleResume(item, event)}
                    className="absolute right-4 top-3 text-xs px-2 py-1 rounded-lg border border-bd text-tx-muted hover:text-tx-sub"
                  >
                    恢复
                  </button>
                )}
              </div>
            )
          })}

          {historyCursor && (
            <div className="px-4 py-3 border-t border-bd/50">
              <button
                onClick={() => void refreshHistory(selectedMachine, historyCursor, true)}
                disabled={historyLoading}
                className="w-full text-xs px-3 py-2 rounded-lg border border-bd text-tx-muted hover:text-tx-sub disabled:opacity-50"
              >
                {historyLoading ? '加载中...' : '加载更多'}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="px-4 py-3 border-b border-bd flex items-center justify-between gap-3">
          <div className="min-w-0">
            {activeSession ? (
              <>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm text-tx-sub truncate">{activeSession.title || activeSession.agent_id}</span>
                  <span className={`text-[11px] px-1.5 py-0.5 rounded-full border ${statusTone(activeSession.status)}`}>
                    {activeSession.status}
                  </span>
                  {!TERMINAL_STATUSES.has(activeSession.status) && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full border border-blue-700/40 bg-blue-900/20 text-blue-300">
                      轮询刷新中
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-tx-faint overflow-hidden">
                  <span>{activeSession.provider}</span>
                  <span>·</span>
                  <span>{activeSession.machine_id}</span>
                  <span>·</span>
                  <span className="truncate" title={activeSession.cwd}>{activeSession.cwd}</span>
                </div>
              </>
            ) : (
              <div>
                <h3 className="text-sm text-tx-sub">等待会话</h3>
                <p className="text-xs text-tx-faint mt-1">左侧可直接创建会话，或从历史列表加载已有 agent。</p>
              </div>
            )}
          </div>

          {activeSession && (
            <button
              onClick={() => void refreshSession(activeSession.agent_id, activeSession.machine_id)}
              disabled={sessionLoading}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-bd text-tx-muted hover:text-tx-sub disabled:opacity-50"
            >
              刷新 timeline
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-3 text-sm">
          {!activeSession && (
            <p className="text-tx-faint text-center mt-8">选择历史会话，或者在左侧直接创建一个新的 agent。</p>
          )}

          {activeSession && timeline.length === 0 && !sessionLoading && (
            <p className="text-tx-faint text-center mt-8">timeline 还没有内容，面板会继续轮询。</p>
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
              <div key={item.id} className={`rounded-xl border p-4 space-y-3 ${timelineTone(item)}`}>
                <div className="flex flex-wrap items-center gap-2 text-xs text-tx-faint">
                  <span className="px-2 py-0.5 rounded-full border border-bd bg-page text-tx-sub">{item.role}</span>
                  <span>{item.kind}</span>
                  {item.tool_name && <span>· {item.tool_name}</span>}
                  {item.seq != null && <span>· seq {item.seq}</span>}
                  <span>· {formatTimeLabel(item.created_at)}</span>
                </div>

                {item.text && (
                  <div className="whitespace-pre-wrap leading-relaxed text-tx">{item.text}</div>
                )}

                {argumentsText && (
                  <div className="space-y-1">
                    <div className="text-xs text-tx-muted">arguments</div>
                    <pre className="text-xs whitespace-pre-wrap break-all rounded-lg bg-page/70 border border-bd/70 p-3 text-tx-faint overflow-x-auto">{argumentsText}</pre>
                  </div>
                )}

                {resultText && (
                  <div className="space-y-1">
                    <div className="text-xs text-tx-muted">result</div>
                    <pre className="text-xs whitespace-pre-wrap break-all rounded-lg bg-page/70 border border-bd/70 p-3 text-tx-faint overflow-x-auto">{resultText}</pre>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}