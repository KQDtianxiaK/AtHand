import { useEffect, useMemo, useState, useCallback } from 'react'
import {
  createTodo, createTodoList, deleteTodo, deleteTodoList,
  getTodoLists, getTodos, toggleImportant, toggleMyDay,
  Todo, TodoList, updateTodo, updateTodoList,
} from '../api/client'

// ---- Types & helpers ----
type SmartView = 'myday' | 'important' | 'planned' | 'all'
type ActiveView = SmartView | `list:${number}`

const smartViews: { key: SmartView; icon: string; label: string }[] = [
  { key: 'myday', icon: '☀️', label: '我的一天' },
  { key: 'important', icon: '⭐', label: '重要' },
  { key: 'planned', icon: '📅', label: '计划内' },
  { key: 'all', icon: '🏠', label: '全部' },
]

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isMyDay(todo: Todo) {
  return todo.my_day_date === todayStr()
}

function formatDate(d: string) {
  // Parse as local date (avoid UTC timezone shift)
  const [y, m, day] = d.slice(0, 10).split('-').map(Number)
  const date = new Date(y, m - 1, day)
  const today = new Date()
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const diff = Math.floor((date.getTime() - todayMid.getTime()) / 86400000)
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff === -1) return '昨天'
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

const shellPanelClass = 'rounded-[1.75rem] border border-bd bg-surface/[0.88] shadow-ambient backdrop-blur-xl'
const sectionCardClass = 'rounded-[1.35rem] border border-bd bg-page/[0.52]'
const insetCardClass = 'rounded-[1.1rem] border border-bd bg-page/[0.4]'
const fieldClass = 'w-full rounded-[1.05rem] border border-bd-strong bg-surface-elevated/[0.9] px-3 py-2.5 text-sm text-tx shadow-inset outline-none transition placeholder:text-tx-faint focus:border-accent/40 focus:ring-2 focus:ring-accent/10'
const secondaryButtonClass = 'rounded-[1rem] border border-bd bg-page/[0.55] px-3 py-2 text-xs font-medium text-tx-muted transition hover:border-bd-strong hover:bg-surface-elevated/[0.92] hover:text-tx-sub disabled:opacity-50'
const primaryButtonClass = 'rounded-[1.05rem] bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:bg-accent-strong disabled:opacity-50'

// ---- Components ----

function TodoItem({
  todo, selected, onSelect, onToggleDone, onToggleImportant, onToggleMyDay, activeView,
}: {
  todo: Todo; selected: boolean
  onSelect: () => void; onToggleDone: () => void
  onToggleImportant: () => void; onToggleMyDay: () => void
  activeView: ActiveView
}) {
  const overdue = !!todo.due_date && todo.due_date.slice(0, 10) < todayStr() && !todo.is_done

  return (
    <div
      onClick={onSelect}
      className={`group flex cursor-pointer items-center gap-3 rounded-[1.25rem] border px-4 py-3.5 transition-all ${
        selected
          ? 'border-accent/25 bg-accent-soft/[0.76] shadow-float ring-1 ring-accent/10'
          : 'border-bd bg-surface-elevated/[0.88] hover:border-bd-strong hover:bg-surface-elevated/[0.96]'
      }`}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onToggleDone() }}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
          todo.is_done
            ? 'border-success bg-success'
            : todo.is_important ? 'border-warning bg-warning/10 text-warning' : 'border-bd-strong bg-page/[0.55] hover:border-accent/40'
        }`}
      >
        {todo.is_done && <span className="text-white text-xs">✓</span>}
      </button>

      <div className="flex-1 min-w-0">
        <p className={`truncate text-sm font-medium ${todo.is_done ? 'text-tx-faint line-through' : 'text-tx-sub'}`}>
          {todo.title}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
          {activeView !== 'myday' && isMyDay(todo) && (
            <span className="rounded-full border border-brand/20 bg-brand-soft/[0.72] px-2 py-0.5 text-brand">
              ☀ 我的一天
            </span>
          )}
          {todo.due_date && (
            <span className={`rounded-full border px-2 py-0.5 ${overdue ? 'border-danger/25 bg-danger/10 text-danger' : 'border-bd bg-page/[0.55] text-tx-faint'}`}>
              📅 {formatDate(todo.due_date)}{todo.recurrence && ' · 🔁'}
            </span>
          )}
          {todo.list_id && (
            <span className="rounded-full border border-bd bg-page/[0.55] px-2 py-0.5 text-tx-faint">
              列表任务
            </span>
          )}
        </div>
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); onToggleImportant() }}
        className={`shrink-0 text-[20px] leading-none transition-colors ${
          todo.is_important ? 'text-warning' : 'text-tx-faintest opacity-0 group-hover:opacity-100 hover:text-warning'
        }`}
      >
        {todo.is_important ? '★' : '☆'}
      </button>
    </div>
  )
}

function DetailPanel({
  todo, onClose, onUpdate, onDelete, onToggleMyDay, onToggleImportant, lists,
}: {
  todo: Todo; onClose: () => void
  onUpdate: (id: number, data: Partial<Todo>) => void
  onDelete: (id: number) => void
  onToggleMyDay: (id: number) => void
  onToggleImportant: (id: number) => void
  lists: TodoList[]
}) {
  const [title, setTitle] = useState(todo.title)
  const [desc, setDesc] = useState(todo.description)
  const [dueDate, setDueDate] = useState(todo.due_date?.slice(0, 10) || '')
  // recurrence state: type ('', 'daily', 'weekly', 'monthly') + detail (weekday 1-7 or day 1-31)
  const parseRec = (r: string | null) => {
    if (!r) return { type: '', detail: 1 }
    if (r === 'daily') return { type: 'daily', detail: 1 }
    if (r.startsWith('weekly:')) return { type: 'weekly', detail: parseInt(r.split(':')[1]) }
    if (r.startsWith('monthly:')) return { type: 'monthly', detail: parseInt(r.split(':')[1]) }
    return { type: '', detail: 1 }
  }
  const [recType, setRecType] = useState(() => parseRec(todo.recurrence).type)
  const [recDetail, setRecDetail] = useState(() => parseRec(todo.recurrence).detail)

  useEffect(() => {
    setTitle(todo.title)
    setDesc(todo.description)
    setDueDate(todo.due_date?.slice(0, 10) || '')
    const parsed = parseRec(todo.recurrence)
    setRecType(parsed.type)
    setRecDetail(parsed.detail)
  }, [todo.id, todo.title, todo.description, todo.due_date, todo.recurrence])

  const commitTitle = () => {
    if (title.trim() && title !== todo.title) onUpdate(todo.id, { title: title.trim() })
  }
  const commitDesc = () => {
    if (desc !== todo.description) onUpdate(todo.id, { description: desc })
  }
  const commitDate = () => {
    // Send YYYY-MM-DD directly to avoid UTC timezone shift
    const val = dueDate || null
    const prevVal = todo.due_date?.slice(0, 10) || null
    if (val !== prevVal) onUpdate(todo.id, { due_date: val } as any)
  }
  const applyRecurrence = (type: string, detail: number) => {
    let val: string | null = null
    if (type === 'daily') val = 'daily'
    else if (type === 'weekly') val = `weekly:${detail}`
    else if (type === 'monthly') val = `monthly:${detail}`
    if (val !== (todo.recurrence ?? null)) onUpdate(todo.id, { recurrence: val } as any)
  }

  return (
    <div className={`flex min-h-[420px] w-full flex-col overflow-hidden xl:w-[360px] ${shellPanelClass}`}>
      <div className="flex items-center justify-between gap-3 border-b border-bd/70 px-5 py-4">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Task Detail</div>
          <div className="mt-1 text-sm font-medium text-tx-sub">任务详情</div>
        </div>
        <button onClick={onClose} className={secondaryButtonClass}>关闭</button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        <div className={`${sectionCardClass} p-4`}>
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Editing</div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-tx-faint">
            {todo.is_done ? (
              <span className="rounded-full border border-success/25 bg-success/10 px-2 py-0.5 text-success">已完成</span>
            ) : (
              <span className="rounded-full border border-accent/25 bg-accent-soft px-2 py-0.5 text-accent">进行中</span>
            )}
            <span className="rounded-full border border-bd bg-page/[0.55] px-2 py-0.5 text-tx-faint">P{todo.priority}</span>
            {todo.due_date && <span className="rounded-full border border-bd bg-page/[0.55] px-2 py-0.5 text-tx-faint">{formatDate(todo.due_date)}</span>}
          </div>
        </div>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          className="w-full bg-transparent text-xl font-semibold tracking-[-0.03em] text-tx outline-none placeholder:text-tx-faint"
        />

        <div className={`${sectionCardClass} space-y-2 p-3`}>
          <button
            onClick={() => onToggleMyDay(todo.id)}
            className={`flex w-full items-center gap-2 rounded-[1rem] border px-3 py-2.5 text-sm transition-colors ${
              isMyDay(todo) ? 'border-brand/20 bg-brand-soft/[0.72] text-brand' : 'border-transparent bg-page/[0.4] text-tx-sub hover:border-bd hover:bg-surface-elevated/[0.92]'
            }`}
          >
            <span>☀️</span>
            {isMyDay(todo) ? '已添加到"我的一天"' : '添加到"我的一天"'}
          </button>
          <button
            onClick={() => onToggleImportant(todo.id)}
            className={`flex w-full items-center gap-2 rounded-[1rem] border px-3 py-2.5 text-sm transition-colors ${
              todo.is_important ? 'border-warning/25 bg-warning/10 text-warning' : 'border-transparent bg-page/[0.4] text-tx-sub hover:border-bd hover:bg-surface-elevated/[0.92]'
            }`}
          >
            <span>{todo.is_important ? '★' : '☆'}</span>
            {todo.is_important ? '已标记为重要' : '标记为重要'}
          </button>
        </div>

        <div className={`${sectionCardClass} p-4`}>
          <label className="mb-2 block text-xs text-tx-muted">截止日期</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            onBlur={commitDate}
            className={fieldClass}
          />
        </div>

        <div className={`${sectionCardClass} p-4`}>
          <label className="mb-2 block text-xs text-tx-muted">🔁 重复</label>
          <div className="flex gap-2">
            <select
              value={recType}
              onChange={(e) => {
                const t = e.target.value
                const d = t !== recType ? 1 : recDetail
                setRecType(t)
                setRecDetail(d)
                applyRecurrence(t, d)
              }}
              className={fieldClass}
            >
              <option value="">不重复</option>
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
              <option value="monthly">每月</option>
            </select>
            {recType === 'weekly' && (
              <select
                value={recDetail}
                onChange={(e) => {
                  const d = Number(e.target.value)
                  setRecDetail(d)
                  applyRecurrence('weekly', d)
                }}
                className={fieldClass}
              >
                {['周一','周二','周三','周四','周五','周六','周日'].map((label, i) => (
                  <option key={i} value={i + 1}>{label}</option>
                ))}
              </select>
            )}
            {recType === 'monthly' && (
              <select
                value={recDetail}
                onChange={(e) => {
                  const d = Number(e.target.value)
                  setRecDetail(d)
                  applyRecurrence('monthly', d)
                }}
                className={`${fieldClass} w-28`}
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>{d} 日</option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div className={`${sectionCardClass} p-4`}>
          <label className="mb-2 block text-xs text-tx-muted">优先级</label>
          <select
            value={todo.priority}
            onChange={(e) => onUpdate(todo.id, { priority: Number(e.target.value) })}
            className={fieldClass}
          >
            <option value={0}>🔴 P0 紧急</option>
            <option value={1}>🟠 P1 高</option>
            <option value={2}>🟡 P2 中</option>
            <option value={3}>🟢 P3 低</option>
          </select>
        </div>

        <div className={`${sectionCardClass} p-4`}>
          <label className="mb-2 block text-xs text-tx-muted">列表</label>
          <select
            value={todo.list_id ?? ''}
            onChange={(e) => onUpdate(todo.id, { list_id: e.target.value ? Number(e.target.value) : null } as any)}
            className={fieldClass}
          >
            <option value="">无</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>{l.emoji} {l.name}</option>
            ))}
          </select>
        </div>

        <div className={`${sectionCardClass} p-4`}>
          <label className="mb-2 block text-xs text-tx-muted">备注</label>
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onBlur={commitDesc}
            rows={4}
            placeholder="添加备注..."
            className={`${fieldClass} min-h-[120px] resize-none`}
          />
        </div>

        <div className={`${insetCardClass} space-y-1 px-4 py-3 text-xs text-tx-faint`}>
          <p>创建于 {new Date(todo.created_at).toLocaleString('zh-CN')}</p>
          {todo.done_at && <p>完成于 {new Date(todo.done_at).toLocaleString('zh-CN')}</p>}
        </div>
        <button
          onClick={() => { onDelete(todo.id); onClose() }}
          className="w-full rounded-[1.05rem] border border-danger/25 bg-danger/10 px-3 py-2.5 text-center text-sm font-medium text-danger transition hover:bg-danger/15"
        >
          删除任务
        </button>
      </div>
    </div>
  )
}

// ---- Main page ----

export default function TodosPage() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [allTodos, setAllTodos] = useState<Todo[]>([])
  const [lists, setLists] = useState<TodoList[]>([])
  const [activeView, setActiveView] = useState<ActiveView>('myday')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newListName, setNewListName] = useState('')
  const [showNewList, setShowNewList] = useState(false)

  const loadAll = () => getTodos().then(setAllTodos).catch(console.error)

  const load = useCallback(() => {
    const viewParam = activeView === 'all' ? undefined : activeView
    getTodos({ view: viewParam }).then(setTodos).catch(console.error)
    loadAll()
  }, [activeView])

  const loadLists = () => getTodoLists().then(setLists).catch(console.error)

  useEffect(() => { load() }, [load])
  useEffect(() => { loadLists(); loadAll() }, [])

  // ---- per-view undone counts ----
  const viewCounts = useMemo(() => {
    const today = todayStr()
    const undone = allTodos.filter((t) => !t.is_done)
    const counts: Record<string, number> = {
      myday: undone.filter((t) => t.my_day_date === today).length,
      important: undone.filter((t) => t.is_important).length,
      planned: undone.filter((t) => t.due_date !== null).length,
      all: undone.length,
    }
    lists.forEach((l) => { counts[`list:${l.id}`] = undone.filter((t) => t.list_id === l.id).length })
    return counts
  }, [allTodos, lists])

  const selectedTodo = useMemo(() => todos.find((t) => t.id === selectedId) ?? null, [todos, selectedId])

  // ---- handlers ----
  const handleAdd = async () => {
    if (!newTitle.trim()) return
    const body: any = { title: newTitle.trim() }
    if (activeView === 'myday') body.my_day = true
    if (activeView === 'important') body.is_important = true
    if (activeView.startsWith('list:')) body.list_id = Number(activeView.split(':')[1])
    await createTodo(body)
    setNewTitle('')
    load()
  }

  const handleToggleDone = async (todo: Todo) => {
    await updateTodo(todo.id, { is_done: !todo.is_done })
    load()
  }

  const handleToggleImportant = async (id: number) => {
    await toggleImportant(id)
    load()
  }

  const handleToggleMyDay = async (id: number) => {
    await toggleMyDay(id)
    load()
  }

  const handleUpdate = async (id: number, data: Partial<Todo>) => {
    await updateTodo(id, data)
    load()
  }

  const handleDelete = async (id: number) => {
    await deleteTodo(id)
    if (selectedId === id) setSelectedId(null)
    load()
  }

  const handleAddList = async () => {
    if (!newListName.trim()) return
    await createTodoList({ name: newListName.trim() })
    setNewListName('')
    setShowNewList(false)
    loadLists()
  }

  const handleDeleteList = async (id: number) => {
    await deleteTodoList(id)
    if (activeView === `list:${id}`) setActiveView('all')
    loadLists()
    load()
  }

  // ---- view title ----
  const viewTitle = useMemo(() => {
    const sv = smartViews.find((v) => v.key === activeView)
    if (sv) return `${sv.icon} ${sv.label}`
    if (activeView.startsWith('list:')) {
      const l = lists.find((l) => l.id === Number(activeView.split(':')[1]))
      return l ? `${l.emoji} ${l.name}` : ''
    }
    return ''
  }, [activeView, lists])

  // ---- header subtitle ----
  const subtitle = useMemo(() => {
    if (activeView === 'myday') {
      return new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
    }
    return undefined
  }, [activeView])

  // split done vs undone
  const undoneTodos = useMemo(() => todos.filter((t) => !t.is_done), [todos])
  const doneTodos = useMemo(() => todos.filter((t) => t.is_done), [todos])

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6 xl:flex-row">
      <section className={`flex w-full min-h-[320px] flex-col overflow-hidden xl:w-[280px] ${shellPanelClass}`}>
        <div className="border-b border-bd/70 px-5 py-5">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Task Views</div>
          <h2 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-tx">待办空间</h2>
          <p className="mt-2 text-sm leading-6 text-tx-muted">把智能视图、自定义列表和今日焦点收进同一套清爽骨架里。</p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <div className={`${sectionCardClass} p-3`}>
            <div className="mb-2 px-1 text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Smart Views</div>
            <div className="space-y-1.5">
              {smartViews.map((v) => {
                const isActive = activeView === v.key
                return (
                  <button
                    key={v.key}
                    onClick={() => { setActiveView(v.key); setSelectedId(null) }}
                    className={`flex w-full items-center gap-3 rounded-[1.15rem] border px-3.5 py-3 text-sm transition-all ${
                      isActive
                        ? 'border-accent/20 bg-accent-soft/[0.82] text-accent-strong shadow-float'
                        : 'border-transparent text-tx-sub hover:border-bd hover:bg-surface-elevated/[0.92] hover:text-tx'
                    }`}
                  >
                    <span className={`inline-flex h-10 w-10 items-center justify-center rounded-[1rem] border text-lg ${isActive ? 'border-accent/20 bg-surface-elevated/[0.95]' : 'border-transparent bg-page/[0.45]'}`}>
                      {v.icon}
                    </span>
                    <span className="flex-1 text-left font-medium">{v.label}</span>
                    <span className={`rounded-full px-2 py-1 text-[11px] tabular-nums ${isActive ? 'bg-surface-elevated/[0.95] text-accent' : 'bg-page/[0.55] text-tx-faint'}`}>
                      {viewCounts[v.key] ?? 0}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className={`${sectionCardClass} p-3`}>
            <div className="mb-3 flex items-center justify-between gap-2 px-1">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Lists</div>
                <div className="mt-1 text-sm font-medium text-tx-sub">自定义列表</div>
              </div>
              {!showNewList && (
                <button onClick={() => setShowNewList(true)} className={secondaryButtonClass}>新建</button>
              )}
            </div>

            <div className="space-y-1.5">
              {lists.map((l) => {
                const isActive = activeView === `list:${l.id}`
                return (
                  <div key={l.id} className="group flex items-center gap-2">
                    <button
                      onClick={() => { setActiveView(`list:${l.id}`); setSelectedId(null) }}
                      className={`flex flex-1 items-center gap-3 rounded-[1.15rem] border px-3.5 py-3 text-sm transition-all ${
                        isActive
                          ? 'border-accent/20 bg-accent-soft/[0.82] text-accent-strong shadow-float'
                          : 'border-transparent text-tx-sub hover:border-bd hover:bg-surface-elevated/[0.92] hover:text-tx'
                      }`}
                    >
                      <span className={`inline-flex h-10 w-10 items-center justify-center rounded-[1rem] border text-lg ${isActive ? 'border-accent/20 bg-surface-elevated/[0.95]' : 'border-transparent bg-page/[0.45]'}`}>
                        {l.emoji}
                      </span>
                      <span className="flex-1 truncate text-left font-medium">{l.name}</span>
                      <span className={`rounded-full px-2 py-1 text-[11px] tabular-nums ${isActive ? 'bg-surface-elevated/[0.95] text-accent' : 'bg-page/[0.55] text-tx-faint'}`}>
                        {viewCounts[`list:${l.id}`] ?? 0}
                      </span>
                    </button>
                    <button
                      onClick={() => handleDeleteList(l.id)}
                      className="px-2 text-xs text-tx-faintest opacity-0 transition hover:text-danger group-hover:opacity-100"
                    >
                      删除
                    </button>
                  </div>
                )
              })}

              {showNewList ? (
                <div className={`${insetCardClass} space-y-2 p-3`}>
                  <input
                    value={newListName}
                    onChange={(e) => setNewListName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddList(); if (e.key === 'Escape') setShowNewList(false) }}
                    placeholder="列表名称"
                    autoFocus
                    className={fieldClass}
                  />
                  <div className="flex gap-2">
                    <button onClick={handleAddList} className={`${primaryButtonClass} flex-1`}>创建</button>
                    <button onClick={() => setShowNewList(false)} className={`${secondaryButtonClass} flex-1`}>取消</button>
                  </div>
                </div>
              ) : lists.length === 0 ? (
                <div className="rounded-[1.15rem] border border-dashed border-bd px-4 py-5 text-center text-xs leading-6 text-tx-faint">
                  还没有自定义列表。
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className={`flex min-h-[420px] min-w-0 flex-1 flex-col overflow-hidden ${shellPanelClass}`}>
        <div className="border-b border-bd/70 px-5 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Focus Board</div>
              <h2 className="mt-2 text-[1.8rem] font-semibold tracking-[-0.04em] text-tx">{viewTitle}</h2>
              {subtitle ? (
                <p className="mt-2 text-sm text-tx-muted">{subtitle}</p>
              ) : (
                <p className="mt-2 text-sm text-tx-muted">保留原有 Todo 逻辑，只把界面层升级到新的视觉骨架。</p>
              )}
            </div>

            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-full border border-accent/20 bg-accent-soft px-3 py-1.5 text-accent">待办 {undoneTodos.length}</span>
              <span className="rounded-full border border-bd bg-page/[0.55] px-3 py-1.5 text-tx-faint">已完成 {doneTodos.length}</span>
              {selectedTodo && <span className="rounded-full border border-brand/20 bg-brand-soft/[0.72] px-3 py-1.5 text-brand">已打开详情</span>}
            </div>
          </div>
        </div>

        <div className="border-b border-bd/50 px-5 py-4">
          <div className={`${sectionCardClass} p-3`}>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="flex flex-1 items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-[1rem] border border-accent/20 bg-accent-soft text-lg text-accent">+</span>
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                  placeholder="添加任务"
                  className={`${fieldClass} flex-1`}
                />
              </div>
              <button
                onClick={() => void handleAdd()}
                disabled={!newTitle.trim()}
                className={`${primaryButtonClass} w-full sm:w-auto`}
              >
                添加任务
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {undoneTodos.length > 0 ? (
            <div className="space-y-3">
              {undoneTodos.map((todo) => (
                <TodoItem
                  key={todo.id}
                  todo={todo}
                  selected={selectedId === todo.id}
                  activeView={activeView}
                  onSelect={() => setSelectedId(selectedId === todo.id ? null : todo.id)}
                  onToggleDone={() => handleToggleDone(todo)}
                  onToggleImportant={() => handleToggleImportant(todo.id)}
                  onToggleMyDay={() => handleToggleMyDay(todo.id)}
                />
              ))}
            </div>
          ) : !showDone ? (
            <div className="flex min-h-[280px] items-center justify-center">
              <div className={`${sectionCardClass} w-full max-w-xl px-6 py-10 text-center`}>
                <div className="text-4xl">{activeView === 'myday' ? '☀️' : '🗂️'}</div>
                <div className="mt-4 text-lg font-medium text-tx-sub">
                  {activeView === 'myday' ? '专注于今天重要的事' : '当前视图还没有待办'}
                </div>
                <p className="mt-2 text-sm leading-6 text-tx-faint">
                  {activeView === 'myday' ? '把今天真正要推进的任务留在这里，减少切换成本。' : '创建第一条任务后，它会直接出现在这里。'}
                </p>
              </div>
            </div>
          ) : null}

          {(doneTodos.length > 0 || showDone) && (
            <div className="mt-5">
              <button
                onClick={() => setShowDone(!showDone)}
                className={`${secondaryButtonClass} mb-3 flex items-center gap-2`}
              >
                <span className={`transition-transform ${showDone ? 'rotate-90' : ''}`}>▶</span>
                已完成 ({doneTodos.length})
              </button>
              {showDone && (
                <div className="space-y-3">
                  {doneTodos.map((todo) => (
                    <TodoItem
                      key={todo.id}
                      todo={todo}
                      selected={selectedId === todo.id}
                      activeView={activeView}
                      onSelect={() => setSelectedId(selectedId === todo.id ? null : todo.id)}
                      onToggleDone={() => handleToggleDone(todo)}
                      onToggleImportant={() => handleToggleImportant(todo.id)}
                      onToggleMyDay={() => handleToggleMyDay(todo.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {selectedTodo && (
        <DetailPanel
          todo={selectedTodo}
          lists={lists}
          onClose={() => setSelectedId(null)}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          onToggleMyDay={handleToggleMyDay}
          onToggleImportant={handleToggleImportant}
        />
      )}
    </div>
  )
}
