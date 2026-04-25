import { useEffect, useRef, useState, useMemo } from 'react'
import {
  connectDashboardWS,
  createTask,
  deleteSession,
  deleteTask,
  getKimiSessionMessages,
  getKimiWorkDirs,
  getMachines,
  getSessionMessages,
  getTaskMessages,
  getTasks,
  killOrphanKimi,
  resolveKimiSession,
  KimiSessionMessage,
  KimiWorkDir,
  Machine,
  Task,
  TaskMessage,
} from '../api/client'
import AiControlBridgePanel from '../components/AiControlBridgePanel'
import SpeechButton from '../components/SpeechButton'

/** 一个 session 分组：可能包含多个 task（session 续对话），也可能只有 1 个独立 task */
interface SessionGroup {
  /** 分组 key：session_id 或 "task-{id}" */
  key: string
  sessionId: string | null
  tasks: Task[]
  /** 第一个任务的 prompt（作为标题） */
  title: string
  /** 最新任务的状态 */
  latestStatus: string
  /** 最新任务 */
  latestTask: Task
  /** 第一条任务的时间 */
  createdAt: string
  machineId: string
  workDir: string | null
}

export default function AgentsPage() {
  const [surface, setSurface] = useState<'bridge' | 'legacy'>('bridge')

  if (surface === 'bridge') {
    return <AiControlBridgePanel onOpenLegacy={() => setSurface('legacy')} />
  }

  return <LegacyAgentsPage onOpenBridge={() => setSurface('bridge')} />
}

function LegacyAgentsPage({ onOpenBridge }: { onOpenBridge: () => void }) {
  const [machines, setMachines] = useState<Machine[]>([])
  const [selectedMachine, setSelectedMachine] = useState('')
  const [prompt, setPrompt] = useState('')
  const [workDir, setWorkDir] = useState('')
  const [tasks, setTasks] = useState<Task[]>([])
  const [activeGroup, setActiveGroup] = useState<SessionGroup | null>(null)
  const [messages, setMessages] = useState<TaskMessage[]>([])
  const [streamMessages, setStreamMessages] = useState<any[]>([])
  const [sending, setSending] = useState(false)
  const outputRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  // 左侧 tab 切换
  const [leftTab, setLeftTab] = useState<'athand' | 'kimi'>('athand')
  // Kimi 本地历史
  const [kimiWorkDirs, setKimiWorkDirs] = useState<KimiWorkDir[]>([])
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [kimiMessages, setKimiMessages] = useState<KimiSessionMessage[]>([])
  const [kimiTitle, setKimiTitle] = useState('')
  const [kimiActiveKey, setKimiActiveKey] = useState('')
  // 当前查看的 Kimi session 信息（用于继续对话）
  const [kimiSessionId, setKimiSessionId] = useState<string | null>(null)
  const [kimiWorkDir, setKimiWorkDir] = useState<string | null>(null)
  // 续写模式：记住关联的 Kimi 历史，切换 session 后仍可恢复显示
  const [kimiLinkedSessionId, setKimiLinkedSessionId] = useState<string | null>(null)
  const [kimiLinkedMessages, setKimiLinkedMessages] = useState<KimiSessionMessage[]>([])
  const [kimiLinkedTitle, setKimiLinkedTitle] = useState('')
  // 用 ref 跟踪当前活跃 group，避免 WebSocket 闭包捕获旧值
  const activeGroupRef = useRef<SessionGroup | null>(null)
  activeGroupRef.current = activeGroup
  // 同步跟踪刚创建尚未 render 入 activeGroup 的任务 ID（修复竞态条件）
  const pendingTaskIdRef = useRef<number | null>(null)

  // 将 tasks 按 session 分组
  const sessionGroups = useMemo((): SessionGroup[] => {
    const groupMap = new Map<string, Task[]>()
    const order: string[] = []

    for (const task of tasks) {
      const key = task.session_id || `task-${task.id}`
      if (!groupMap.has(key)) {
        groupMap.set(key, [])
        order.push(key)
      }
      groupMap.get(key)!.push(task)
    }

    return order.map((key) => {
      const groupTasks = groupMap.get(key)!
      // 按创建时间排序（最早的在前）
      groupTasks.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      const first = groupTasks[0]
      const latest = groupTasks[groupTasks.length - 1]
      return {
        key,
        sessionId: first.session_id,
        tasks: groupTasks,
        title: first.prompt,
        latestStatus: latest.status,
        latestTask: latest,
        createdAt: first.created_at,
        machineId: first.machine_id,
        workDir: latest.work_dir || first.work_dir,
      }
    })
  }, [tasks])

  // 加载机器列表
  useEffect(() => {
    getMachines().then((m) => {
      setMachines(m)
      if (m.length > 0 && !selectedMachine) setSelectedMachine(m[0].id)
    })
  }, [])

  // 加载任务列表
  useEffect(() => {
    getTasks({ limit: 50 }).then(setTasks).catch(console.error)
  }, [])

  // 当切换到 Kimi tab 时加载本地历史
  useEffect(() => {
    if (leftTab === 'kimi' && kimiWorkDirs.length === 0) {
      getKimiWorkDirs().then(setKimiWorkDirs).catch(console.error)
    }
  }, [leftTab])

  // 当 activeGroup 更新时（如 tasks 刷新后），同步更新
  useEffect(() => {
    if (!activeGroup) return
    // 先按 key 精确匹配
    let updated = sessionGroups.find((g) => g.key === activeGroup.key)
    // fakeGroup(kimi-resume-xxx)的 key 不会出现在 sessionGroups 中，改用 sessionId 匹配
    if (!updated && activeGroup.sessionId) {
      updated = sessionGroups.find((g) => g.sessionId === activeGroup.sessionId)
    }
    if (updated && (updated.latestTask.id !== activeGroup.latestTask?.id || updated.latestStatus !== activeGroup.latestStatus)) {
      setActiveGroup(updated)
    }
  }, [sessionGroups])

  // WebSocket 接收实时输出 — 只建立一次连接，用 ref 读取最新 group
  useEffect(() => {
    const ws = connectDashboardWS((data) => {
      const group = activeGroupRef.current
      const activeTaskIds = group?.tasks.map((t) => t.id) ?? []
      // pendingTaskIdRef 修复竞态：handleSend 创建任务后 React 尚未 render，ref 已同步更新
      const isTracked = (taskId: number) =>
        activeTaskIds.includes(taskId) || pendingTaskIdRef.current === taskId

      if (data.type === 'task_output' && isTracked(data.task_id)) {
        setStreamMessages((prev) => [...prev, data.message])
      }
      if (data.type === 'task_done') {
        // 刷新任务列表以更新状态和 session_id
        getTasks({ limit: 50 }).then((newTasks) => {
          setTasks(newTasks)
          // 如果完成的是当前 group 中的任务，重新加载消息
          if (isTracked(data.task_id)) {
            pendingTaskIdRef.current = null  // 清除 pending
            const doneTask = newTasks.find((t) => t.id === data.task_id)
            if (doneTask?.session_id) {
              getSessionMessages(doneTask.session_id).then((msgs) => {
                setMessages(msgs)
                setStreamMessages([])
              })
            } else {
              getTaskMessages(data.task_id).then((msgs) => {
                setMessages(msgs)
                setStreamMessages([])
              })
            }
            // 同步更新 activeGroup 状态（兼容 fakeGroup 无法通过 sessionGroups 自动更新的场景）
            setActiveGroup((prev) => {
              if (!prev) return null
              // 通过 task ID 或 session_id 匹配
              const belongs = prev.tasks.some((t) => t.id === data.task_id) ||
                (doneTask?.session_id && prev.sessionId && doneTask.session_id === prev.sessionId)
              if (!belongs) return prev
              const newSessionId = doneTask?.session_id || prev.sessionId
              const taskInGroup = prev.tasks.some((t) => t.id === data.task_id)
              return {
                ...prev,
                latestStatus: 'done',
                sessionId: newSessionId,
                tasks: taskInGroup
                  ? prev.tasks.map((t) =>
                      t.id === data.task_id
                        ? { ...t, status: 'done', session_id: newSessionId || t.session_id }
                        : t
                    )
                  : [...prev.tasks, { ...doneTask!, status: 'done' }],
                latestTask: doneTask || prev.latestTask,
              }
            })
          }
        })
      }
      if (data.type === 'agent_online' || data.type === 'agent_offline') {
        getMachines().then(setMachines)
      }
    })
    wsRef.current = ws
    return () => ws.close()
  }, []) // 只建立一次

  // 自动滚动到底部
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [streamMessages, messages])

  // 发送新任务或在已有 session 上继续对话
  const handleSend = async () => {
    if (!prompt.trim() || !selectedMachine) return
    setSending(true)
    try {
      // 如果当前 group 有 session_id 且最新任务已完成，则继续该 session
      const sessionId = activeGroup?.sessionId
      const canContinue = sessionId && activeGroup.latestStatus === 'done'

      const task = await createTask({
        machine_id: selectedMachine,
        prompt: prompt.trim(),
        work_dir: workDir || activeGroup?.workDir || undefined,
        mode: canContinue ? 'continue' : 'normal',
        session_id: canContinue ? sessionId : undefined,
      })

      // 同步写入 ref —— 在 React render 之前，WS handler 已能通过 ref 追踪此任务
      pendingTaskIdRef.current = task.id

      // 更新任务列表
      setTasks((prev) => [task, ...prev])

      if (canContinue) {
        // 继续对话：新任务加入当前 group，保持消息不清空，只清空 stream
        setStreamMessages([])
        // 更新 activeGroup 加入新任务
        setActiveGroup((prev) => prev ? {
          ...prev,
          tasks: [...prev.tasks, task],
          latestTask: task,
          latestStatus: task.status,
        } : null)
      } else {
        // 新任务：创建新的 group
        const newGroup: SessionGroup = {
          key: task.session_id || `task-${task.id}`,
          sessionId: task.session_id,
          tasks: [task],
          title: task.prompt,
          latestStatus: task.status,
          latestTask: task,
          createdAt: task.created_at,
          machineId: task.machine_id,
          workDir: task.work_dir,
        }
        setActiveGroup(newGroup)
        setMessages([])
        setStreamMessages([])
      }
      setPrompt('')
    } catch (err: any) {
      alert(err.message)
    } finally {
      setSending(false)
    }
  }

  const handleViewGroup = async (group: SessionGroup) => {
    setActiveGroup(group)
    setStreamMessages([])
    setSelectedMachine(group.machineId)
    if (group.workDir) setWorkDir(group.workDir)

    // 如果有 session_id，加载整个 session 的消息；否则加载单个任务
    if (group.sessionId) {
      const msgs = await getSessionMessages(group.sessionId)
      setMessages(msgs)
      // 尝试加载关联的 Kimi 本地历史（刷新页面后恢复）
      try {
        const kimiData = await resolveKimiSession(group.sessionId)
        setKimiLinkedSessionId(group.sessionId)
        setKimiLinkedMessages(kimiData.messages)
        setKimiLinkedTitle(kimiData.title)
      } catch {
        // 非 Kimi 续写的会话，不显示 linked history
        if (kimiLinkedSessionId !== group.sessionId) {
          setKimiLinkedSessionId(null)
          setKimiLinkedMessages([])
        }
      }
    } else {
      const msgs = await getTaskMessages(group.tasks[0].id)
      setMessages(msgs)
      setKimiLinkedSessionId(null)
      setKimiLinkedMessages([])
    }
  }

  const handleDelete = async (group: SessionGroup, e: React.MouseEvent) => {
    e.stopPropagation()
    const count = group.tasks.length
    const label = count > 1 ? `此会话（${count} 轮对话）` : '此任务'
    if (!confirm(`确定删除${label}？`)) return

    try {
      if (group.sessionId && count > 1) {
        await deleteSession(group.sessionId)
      } else {
        // 删除所有关联任务
        for (const t of group.tasks) {
          await deleteTask(t.id)
        }
      }
      setTasks((prev) => prev.filter((t) => !group.tasks.some((gt) => gt.id === t.id)))
      if (activeGroup?.key === group.key) {
        setActiveGroup(null)
        setMessages([])
        setStreamMessages([])
      }
    } catch (err: any) {
      alert(err.message)
    }
  }

  const handleViewKimiSession = async (dirHash: string, sessionId: string) => {
    const key = `${dirHash}/${sessionId}`
    setKimiActiveKey(key)
    setKimiSessionId(null)
    setKimiWorkDir(null)
    // 打开不同的 Kimi 会话时，清除续写关联
    setKimiLinkedSessionId(null)
    setKimiLinkedMessages([])
    // 切换到 kimi 视图时清除 athand 的选中
    setActiveGroup(null)
    setMessages([])
    setStreamMessages([])
    try {
      const data = await getKimiSessionMessages(dirHash, sessionId)
      setKimiMessages(data.messages)
      setKimiTitle(data.title)
      setKimiSessionId(data.session_id)
      setKimiWorkDir(data.work_dir)
    } catch (err: any) {
      alert(err.message)
    }
  }

  /** 从 Kimi 本地历史继续对话：切到 AtHand 标签，并预填 session_id 和 work_dir */
  const handleContinueKimiSession = () => {
    if (!kimiSessionId) return
    setLeftTab('athand')
    // 预填工作目录
    if (kimiWorkDir) setWorkDir(kimiWorkDir)
    // 保存 Kimi 历史到 linked 状态，切换 session 后仍可恢复
    setKimiLinkedSessionId(kimiSessionId)
    setKimiLinkedMessages(kimiMessages)
    setKimiLinkedTitle(kimiTitle)
    // 构造一个虚拟 group，让 isOngoingSession 判断成立
    const fakeGroup: SessionGroup = {
      key: `kimi-resume-${kimiSessionId}`,
      sessionId: kimiSessionId,
      tasks: [],
      title: kimiTitle,
      latestStatus: 'done',  // 让"继续对话"按钮可用
      latestTask: {} as any,
      createdAt: '',
      machineId: selectedMachine,
      workDir: kimiWorkDir,
    }
    setActiveGroup(fakeGroup)
    setMessages([])
    setStreamMessages([])
    setKimiActiveKey('')
  }

  const toggleDir = (hash: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(hash)) next.delete(hash)
      else next.add(hash)
      return next
    })
  }

  const isOngoingSession = activeGroup?.sessionId && activeGroup.latestStatus === 'done'

  return (
    <div className="flex flex-col lg:flex-row h-full">
      {/* 左侧：输入和任务列表 */}
      <div className="lg:w-80 border-b lg:border-b-0 lg:border-r border-bd flex flex-col">
        <div className="p-4 space-y-3 border-b border-bd">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">AI 管控</h2>
            <button
              onClick={onOpenBridge}
              className="text-xs px-3 py-1.5 rounded-lg border border-bd text-tx-muted hover:text-tx-sub hover:border-bd-strong"
            >
              新 AI 管控
            </button>
          </div>

          {/* Tab 切换 */}
          <div className="flex rounded-lg bg-raised p-0.5">
            <button
              onClick={() => setLeftTab('athand')}
              className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
                leftTab === 'athand' ? 'bg-page text-tx shadow-sm' : 'text-tx-muted hover:text-tx-sub'
              }`}
            >AtHand 会话</button>
            <button
              onClick={() => setLeftTab('kimi')}
              className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
                leftTab === 'kimi' ? 'bg-page text-tx shadow-sm' : 'text-tx-muted hover:text-tx-sub'
              }`}
            >Kimi 本地历史</button>
          </div>

          {leftTab === 'athand' && (
            <>
              {/* 机器选择 */}
              <select
                value={selectedMachine}
                onChange={(e) => setSelectedMachine(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-raised text-tx border border-bd-strong"
              >
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.is_online ? '🟢' : '🔴'} {m.name}
                  </option>
                ))}
              </select>

              {/* 工作目录 */}
              <input
                value={workDir}
                onChange={(e) => setWorkDir(e.target.value)}
                placeholder="工作目录（如 ~/projects/myapp）"
                className="w-full px-3 py-2 rounded-lg bg-raised text-tx border border-bd-strong text-sm"
              />

              {/* 当前模式提示 */}
              {isOngoingSession && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-700/50 text-xs text-blue-700 dark:text-blue-300">
                  <span>🔗</span>
                  <span>继续对话 · {activeGroup.tasks.length} 轮</span>
                  <button
                    onClick={() => { setActiveGroup(null); setMessages([]); setStreamMessages([]) }}
                    className="ml-auto text-blue-400 hover:text-tx"
                  >✕</button>
                </div>
              )}

              {/* Prompt 输入 */}
              <div className="flex gap-2">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={isOngoingSession ? '继续对话...' : '输入 prompt...'}
                  rows={3}
                  className="flex-1 px-3 py-2 rounded-lg bg-raised text-tx border border-bd-strong resize-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend()
                  }}
                />
                <div className="flex flex-col gap-2">
                  <SpeechButton onResult={(text) => setPrompt((prev) => prev + text)} />
                  <button
                    onClick={handleSend}
                    disabled={sending || !prompt.trim()}
                    className="px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                    title={isOngoingSession ? '继续对话 (Ctrl+Enter)' : '发送 (Ctrl+Enter)'}
                  >
                    {isOngoingSession ? '↩' : '▶'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* 列表区域 */}
        <div className="flex-1 overflow-y-auto">
          {leftTab === 'athand' ? (
            <>
              <h3 className="px-4 py-2 text-sm text-tx-muted font-medium">历史会话</h3>
              {sessionGroups.map((group) => (
                <div
                  key={group.key}
                  onClick={() => { handleViewGroup(group); setKimiActiveKey('') }}
                  className={`group relative w-full text-left px-4 py-2 border-b border-bd/50 hover:bg-raised/50 cursor-pointer ${
                    activeGroup?.key === group.key && !kimiActiveKey ? 'bg-raised/50' : ''
                  }`}
                >
                  <div className="flex items-center gap-2 pr-6">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      group.latestStatus === 'done' ? 'bg-green-400' :
                      group.latestStatus === 'queued' ? 'bg-yellow-400 animate-pulse' :
                      group.latestStatus === 'failed' ? 'bg-red-400' : 'bg-tx-muted'
                    }`} />
                    <span className="text-sm text-tx-sub truncate">{group.title.slice(0, 50)}</span>
                    {group.tasks.length > 1 && (
                      <span className="flex-shrink-0 text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-1.5 rounded-full">
                        {group.tasks.length}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-tx-faint mt-1 flex items-center gap-1.5">
                    <span>{group.machineId}</span>
                    {group.workDir && (
                      <>
                        <span>·</span>
                        <span className="truncate text-tx-faintest" title={group.workDir}>{group.workDir}</span>
                      </>
                    )}
                  </div>
                  {/* 删除按钮 */}
                  <button
                    onClick={(e) => handleDelete(group, e)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-tx-faint hover:text-red-400 transition-opacity p-1"
                    title="删除"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {/* 终止孤儿 kimi 进程按钮 */}
              <div className="px-4 py-3 border-t border-bd/50">
                <button
                  onClick={async () => {
                    if (!selectedMachine) return
                    try {
                      const res = await killOrphanKimi(selectedMachine)
                      if (res.killed_count > 0) {
                        alert(`已终止 ${res.killed_count} 个后台 kimi 进程`)
                      } else {
                        alert('没有发现未被管理的 kimi 后台进程')
                      }
                    } catch (err: any) {
                      alert(err.message)
                    }
                  }}
                  className="w-full text-xs px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-700/50 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  title="终止不在 AtHand 管理中的后台 kimi 进程"
                >
                  🧹 清理后台 Kimi 进程
                </button>
              </div>
            </>
          ) : (
            /* Kimi 本地历史列表 */
            <>
              {kimiWorkDirs.length === 0 && (
                <p className="px-4 py-4 text-sm text-tx-faint">加载中…</p>
              )}
              {kimiWorkDirs.map((wd) => (
                <div key={wd.dir_hash}>
                  <button
                    onClick={() => toggleDir(wd.dir_hash)}
                    className="w-full text-left px-4 py-2 border-b border-bd/50 hover:bg-raised/50 flex items-center gap-2"
                  >
                    <span className="text-xs text-tx-faint transform transition-transform" style={{ display: 'inline-block', transform: expandedDirs.has(wd.dir_hash) ? 'rotate(90deg)' : '' }}>▸</span>
                    <span className="text-sm text-tx-sub truncate" title={wd.work_dir}>
                      📁 {wd.work_dir.split('/').slice(-2).join('/')}
                    </span>
                    <span className="ml-auto text-xs text-tx-faint">{wd.sessions.filter(s => s.has_data).length}</span>
                  </button>
                  {expandedDirs.has(wd.dir_hash) && (
                    <div className="bg-raised/30">
                      {wd.sessions.filter(s => s.has_data).map((sess) => (
                        <div
                          key={sess.session_id}
                          onClick={() => handleViewKimiSession(wd.dir_hash, sess.session_id)}
                          className={`pl-8 pr-4 py-1.5 border-b border-bd/30 hover:bg-raised/50 cursor-pointer ${
                            kimiActiveKey === `${wd.dir_hash}/${sess.session_id}` ? 'bg-raised/50' : ''
                          }`}
                        >
                          <span className="text-sm text-tx-sub truncate block">{sess.title}</span>
                          <span className="text-xs text-tx-faint">{new Date(sess.mtime * 1000).toLocaleDateString()}</span>
                        </div>
                      ))}
                      {wd.sessions.filter(s => s.has_data).length === 0 && (
                        <p className="pl-8 pr-4 py-1.5 text-xs text-tx-faint">无对话数据</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* 右侧：输出展示 */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-4 py-2 border-b border-bd flex items-center justify-between gap-2 overflow-hidden">
          <div className="flex items-center gap-3 text-sm min-w-0 overflow-hidden">
            {kimiActiveKey ? (
              <>
                <span className="text-tx-sub flex-shrink-0">📂 Kimi 本地 · {kimiTitle.slice(0, 40)}</span>
                {kimiWorkDir && (
                  <span className="text-tx-faint font-mono text-xs truncate" title={kimiWorkDir}>
                    📁 {kimiWorkDir}
                  </span>
                )}
              </>
            ) : activeGroup?.key.startsWith('kimi-resume-') || (activeGroup?.sessionId && activeGroup.sessionId === kimiLinkedSessionId) ? (
              <>
                <span className="text-tx-sub flex-shrink-0">↩ 续写 · {kimiLinkedTitle.slice(0, 40)}</span>
                {activeGroup.workDir && (
                  <span className="text-tx-faint font-mono text-xs truncate" title={activeGroup.workDir}>
                    📁 {activeGroup.workDir}
                  </span>
                )}
              </>
            ) : activeGroup ? (
              <>
                <span className="text-tx-sub flex-shrink-0">
                  {activeGroup.tasks.length > 1
                    ? `会话 · ${activeGroup.tasks.length} 轮`
                    : `任务 #${activeGroup.latestTask.id}`}
                </span>
                <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-xs ${
                  activeGroup.latestStatus === 'done' ? 'bg-green-900/50 text-green-300' :
                  activeGroup.latestStatus === 'queued' ? 'bg-yellow-900/50 text-yellow-300' :
                  activeGroup.latestStatus === 'failed' ? 'bg-red-900/50 text-red-300' : 'bg-raised text-tx-sub'
                }`}>{activeGroup.latestStatus}</span>
                {activeGroup.workDir && (
                  <span className="text-tx-faint font-mono text-xs truncate" title={activeGroup.workDir}>
                    📁 {activeGroup.workDir}
                  </span>
                )}
              </>
            ) : (
              <span className="text-tx-faint">选择任务查看输出</span>
            )}
          </div>
          {kimiActiveKey ? (
            <button
              onClick={handleContinueKimiSession}
              className="text-xs px-2.5 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
            >↩ 继续此对话</button>
          ) : isOngoingSession ? (
            <span className="text-xs text-blue-400">可继续对话</span>
          ) : null}
        </div>
        <div ref={outputRef} className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-3 text-sm">
          {kimiActiveKey ? (
            <KimiMessagesView messages={kimiMessages} />
          ) : activeGroup?.key.startsWith('kimi-resume-') || (activeGroup?.sessionId && activeGroup.sessionId === kimiLinkedSessionId) ? (
            <>
              <KimiMessagesView messages={kimiLinkedMessages} />
              {(activeGroup.tasks.length > 0 || messages.length > 0 || streamMessages.length > 0) && (
                <div className="flex items-center gap-4 my-4">
                  <div className="h-px flex-1 bg-bd/40" />
                  <span className="text-xs text-tx-faint px-2 flex-shrink-0">↑ 历史记录 · 续写 ↓</span>
                  <div className="h-px flex-1 bg-bd/40" />
                </div>
              )}
              <SessionMessagesView
                tasks={activeGroup.tasks}
                messages={messages}
                streamMessages={streamMessages}
              />
            </>
          ) : activeGroup ? (
            <SessionMessagesView
              tasks={activeGroup.tasks}
              messages={messages}
              streamMessages={streamMessages}
            />
          ) : (
            <p className="text-tx-faint text-center mt-8">选择一个任务或发送新的 prompt 开始</p>
          )}
          {activeGroup && !kimiActiveKey && activeGroup.latestStatus === 'queued' && streamMessages.length === 0 && activeGroup.tasks.length > 0 && (
            <div className="flex items-center gap-2 text-tx-muted">
              <span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
              <span>等待 Kimi Code 响应...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 对话视图：每轮显示 prompt + 对应消息 */
function SessionMessagesView({
  tasks,
  messages,
  streamMessages,
}: {
  tasks: Task[]
  messages: TaskMessage[]
  streamMessages: any[]
}) {
  // 按 task_id 将消息分到各轮
  const messagesByTask = useMemo(() => {
    const map = new Map<number, TaskMessage[]>()
    for (const msg of messages) {
      const tid = msg.task_id
      if (!map.has(tid)) map.set(tid, [])
      map.get(tid)!.push(msg)
    }
    return map
  }, [messages])

  return (
    <>
      {tasks.map((task, idx) => {
        const taskMessages = messagesByTask.get(task.id) || []
        const isLatest = idx === tasks.length - 1
        return (
          <div key={task.id}>
            {/* 轮次分隔 + prompt */}
            {tasks.length > 1 && (
              <div className="flex items-center gap-2 mt-3 mb-2">
                <div className="h-px flex-1 bg-bd/50" />
                <span className="text-xs text-tx-faint px-2 flex-shrink-0">第 {idx + 1} 轮</span>
                <div className="h-px flex-1 bg-bd/50" />
              </div>
            )}
            <div className="text-sm mb-2 px-3 py-1.5 rounded-lg bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300">
              {task.prompt}
            </div>
            {/* 该轮的消息 */}
            {taskMessages.map((msg) => (
              <MessageBubble key={msg.id} role={msg.role} content={msg.content} toolCalls={msg.tool_calls} />
            ))}
            {/* 最新轮的流式消息 */}
            {isLatest && streamMessages.map((msg, i) => (
              <MessageBubble
                key={`stream-${i}`}
                role={msg.role}
                content={typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}
                toolCalls={msg.tool_calls ? JSON.stringify(msg.tool_calls) : undefined}
              />
            ))}
          </div>
        )
      })}
    </>
  )
}

/** Kimi 本地历史消息视图 */
function KimiMessagesView({ messages }: { messages: KimiSessionMessage[] }) {
  if (messages.length === 0) {
    return <p className="text-tx-faint text-center mt-8">无对话数据</p>
  }
  return (
    <>
      {messages.map((msg, i) => (
        <MessageBubble
          key={i}
          role={msg.role}
          content={msg.content}
          toolCalls={msg.tool_calls}
        />
      ))}
    </>
  )
}

// === Kimi Content 结构化内容 ===
interface KimiContentBlock {
  type: string
  text?: string
  think?: string
}

/** 尝试解析 Kimi 结构化 content（可能是 JSON 数组字符串，也可能是纯文本） */
function parseKimiContent(content: string | null): { blocks: KimiContentBlock[] | null; raw: string | null } {
  if (!content) return { blocks: null, raw: null }
  // 尝试解析为 JSON 数组
  if (content.startsWith('[')) {
    try {
      const arr = JSON.parse(content)
      if (Array.isArray(arr)) return { blocks: arr, raw: null }
    } catch {}
  }
  return { blocks: null, raw: content }
}

/** 渲染 tool 调用信息 */
function renderToolCalls(toolCalls: string) {
  try {
    const calls = JSON.parse(toolCalls)
    if (!Array.isArray(calls)) return <pre className="text-xs text-tx-muted whitespace-pre-wrap break-all">{toolCalls}</pre>
    return (
      <div className="space-y-1">
        {calls.map((call: any, i: number) => {
          const fn = call.function || call
          const name = fn.name || 'unknown'
          let args: any = {}
          try { args = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : fn.arguments || {} } catch {}
          return (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span className="text-purple-400 font-mono whitespace-nowrap">⚡ {name}</span>
              {args.path && <span className="text-tx-faint font-mono break-all">{args.path}</span>}
              {args.command && <span className="text-tx-faint font-mono break-all">{args.command}</span>}
            </div>
          )
        })}
      </div>
    )
  } catch {
    return <pre className="text-xs text-tx-muted overflow-x-auto">{toolCalls}</pre>
  }
}

function MessageBubble({ role, content, toolCalls }: { role: string; content: string | null; toolCalls?: string | null }) {
  const [showThink, setShowThink] = useState(false)
  const { blocks, raw } = parseKimiContent(content)

  if (role === 'tool') {
    // tool 结果 — 简洁显示
    const text = raw || ''
    const isSystemWrapped = text.includes('<system>') && text.includes('</system>')
    const cleaned = isSystemWrapped
      ? text.replace(/<\/?system>/g, '').trim()
      : text
    return (
      <div className="pl-6 border-l-2 border-yellow-700/30 py-1">
        <span className="text-xs text-yellow-600 font-mono break-all">{cleaned.slice(0, 300)}</span>
      </div>
    )
  }

  if (role === 'assistant' && blocks) {
    // Kimi 结构化输出
    const thinkBlocks = blocks.filter((b) => b.type === 'think' && b.think)
    const textBlocks = blocks.filter((b) => b.type === 'text' && b.text)
    return (
      <div className="space-y-1.5">
        {/* 思考过程 — 折叠 */}
        {thinkBlocks.length > 0 && (
          <div>
            <button
              onClick={() => setShowThink(!showThink)}
              className="text-xs text-tx-faint hover:text-tx-sub flex items-center gap-1"
            >
              <span className="transform transition-transform" style={{ display: 'inline-block', transform: showThink ? 'rotate(90deg)' : '' }}>▸</span>
              <span>思考过程</span>
            </button>
            {showThink && (
              <div className="mt-1 pl-3 border-l-2 border-bd/60 text-xs text-tx-faint leading-relaxed whitespace-pre-wrap">
                {thinkBlocks.map((b, i) => <p key={i}>{b.think}</p>)}
              </div>
            )}
          </div>
        )}
        {/* 正文内容 */}
        {textBlocks.map((b, i) => (
          <div key={i} className="text-tx whitespace-pre-wrap leading-relaxed">{b.text}</div>
        ))}
        {/* 工具调用 */}
        {toolCalls && renderToolCalls(toolCalls)}
      </div>
    )
  }

  // 其他情况（纯文本 assistant、system 等）
  return (
    <div className={`${role === 'assistant' ? 'text-tx' : 'text-blue-300'}`}>
      {raw && <span className="whitespace-pre-wrap">{raw}</span>}
      {toolCalls && (
        <div className="mt-1">{renderToolCalls(toolCalls)}</div>
      )}
    </div>
  )
}
