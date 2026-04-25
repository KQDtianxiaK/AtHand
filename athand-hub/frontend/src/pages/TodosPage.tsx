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

// ---- Components ----

function TodoItem({
  todo, selected, onSelect, onToggleDone, onToggleImportant, onToggleMyDay, activeView,
}: {
  todo: Todo; selected: boolean
  onSelect: () => void; onToggleDone: () => void
  onToggleImportant: () => void; onToggleMyDay: () => void
  activeView: ActiveView
}) {
  return (
    <div
      onClick={onSelect}
      className={`group flex items-center gap-3 px-4 py-3 cursor-pointer border-l-2 transition-colors ${
        selected
          ? 'bg-raised/60 border-blue-500'
          : 'bg-surface/40 border-transparent hover:bg-raised/40'
      }`}
    >
      {/* checkbox */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleDone() }}
        className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
          todo.is_done
            ? 'bg-blue-600 border-blue-600'
            : todo.is_important ? 'border-amber-400' : 'border-bd-muted hover:border-blue-400'
        }`}
      >
        {todo.is_done && <span className="text-white text-xs">✓</span>}
      </button>

      {/* text */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm truncate ${todo.is_done ? 'line-through text-tx-faint' : 'text-tx'}`}>
          {todo.title}
        </p>
        <div className="flex items-center gap-2 text-xs text-tx-muted mt-0.5">
          {activeView !== 'myday' && isMyDay(todo) && <span>☀️ 我的一天</span>}
          {todo.due_date && (
            <span className={todo.due_date.slice(0, 10) < todayStr() && !todo.is_done ? 'text-red-400' : ''}>
              📅 {formatDate(todo.due_date)}{todo.recurrence && ' 🔁'}
            </span>
          )}
        </div>
      </div>

      {/* star */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleImportant() }}
        className={`text-lg flex-shrink-0 transition-colors ${
          todo.is_important ? 'text-amber-400' : 'text-tx-faintest opacity-0 group-hover:opacity-100 hover:text-amber-400'
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
    <div className="w-80 border-l border-bd bg-surface/50 flex flex-col">
      {/* header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-bd">
        <span className="text-sm text-tx-muted">详情</span>
        <button onClick={onClose} className="text-tx-muted hover:text-tx">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* title */}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          className="w-full bg-transparent text-tx text-lg font-medium border-none outline-none"
        />

        {/* toggles */}
        <div className="space-y-1">
          <button
            onClick={() => onToggleMyDay(todo.id)}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors ${
              isMyDay(todo) ? 'bg-blue-600/20 text-blue-300' : 'hover:bg-raised text-tx-sub'
            }`}
          >
            <span>☀️</span>
            {isMyDay(todo) ? '已添加到"我的一天"' : '添加到"我的一天"'}
          </button>
          <button
            onClick={() => onToggleImportant(todo.id)}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors ${
              todo.is_important ? 'bg-amber-600/20 text-amber-300' : 'hover:bg-raised text-tx-sub'
            }`}
          >
            <span>{todo.is_important ? '★' : '☆'}</span>
            {todo.is_important ? '已标记为重要' : '标记为重要'}
          </button>
        </div>

        {/* due date */}
        <div>
          <label className="block text-xs text-tx-muted mb-1">截止日期</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            onBlur={commitDate}
            className="w-full px-3 py-2 rounded bg-raised text-tx text-sm border border-bd-strong focus:border-blue-500 focus:outline-none"
          />
        </div>

        {/* recurrence */}
        <div>
          <label className="block text-xs text-tx-muted mb-1">🔁 重复</label>
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
              className="flex-1 px-3 py-2 rounded bg-raised text-tx text-sm border border-bd-strong focus:border-blue-500 focus:outline-none"
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
                className="flex-1 px-3 py-2 rounded bg-raised text-tx text-sm border border-bd-strong focus:border-blue-500 focus:outline-none"
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
                className="w-24 px-3 py-2 rounded bg-raised text-tx text-sm border border-bd-strong focus:border-blue-500 focus:outline-none"
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>{d} 日</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* priority */}
        <div>
          <label className="block text-xs text-tx-muted mb-1">优先级</label>
          <select
            value={todo.priority}
            onChange={(e) => onUpdate(todo.id, { priority: Number(e.target.value) })}
            className="w-full px-3 py-2 rounded bg-raised text-tx text-sm border border-bd-strong"
          >
            <option value={0}>🔴 P0 紧急</option>
            <option value={1}>🟠 P1 高</option>
            <option value={2}>🟡 P2 中</option>
            <option value={3}>🟢 P3 低</option>
          </select>
        </div>

        {/* list */}
        <div>
          <label className="block text-xs text-tx-muted mb-1">列表</label>
          <select
            value={todo.list_id ?? ''}
            onChange={(e) => onUpdate(todo.id, { list_id: e.target.value ? Number(e.target.value) : null } as any)}
            className="w-full px-3 py-2 rounded bg-raised text-tx text-sm border border-bd-strong"
          >
            <option value="">无</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>{l.emoji} {l.name}</option>
            ))}
          </select>
        </div>

        {/* description */}
        <div>
          <label className="block text-xs text-tx-muted mb-1">备注</label>
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onBlur={commitDesc}
            rows={4}
            placeholder="添加备注..."
            className="w-full px-3 py-2 rounded bg-raised text-tx text-sm border border-bd-strong focus:border-blue-500 focus:outline-none resize-none"
          />
        </div>

        {/* meta + delete */}
        <div className="text-xs text-tx-faint space-y-1 pt-2 border-t border-bd">
          <p>创建于 {new Date(todo.created_at).toLocaleString('zh-CN')}</p>
          {todo.done_at && <p>完成于 {new Date(todo.done_at).toLocaleString('zh-CN')}</p>}
        </div>
        <button
          onClick={() => { onDelete(todo.id); onClose() }}
          className="w-full text-center text-sm text-red-400 hover:text-red-300 py-2"
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
    <div className="flex h-full">
      {/* ====== Left nav ====== */}
      <div className="w-64 bg-surface/50 border-r border-bd flex flex-col">
        <div className="p-4 space-y-1">
          {smartViews.map((v) => (
            <button
              key={v.key}
              onClick={() => { setActiveView(v.key); setSelectedId(null) }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                activeView === v.key
                  ? 'bg-blue-600/20 text-blue-300'
                  : 'text-tx-sub hover:bg-raised/50'
              }`}
            >
              <span className="text-lg">{v.icon}</span>
              <span className="flex-1 text-left">{v.label}</span>
              {(viewCounts[v.key] ?? 0) > 0 && (
                <span className="text-xs tabular-nums text-tx-faint">{viewCounts[v.key]}</span>
              )}
            </button>
          ))}
        </div>

        <div className="border-t border-bd mx-4" />

        {/* custom lists */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1">
          {lists.map((l) => (
            <div key={l.id} className="group flex items-center">
              <button
                onClick={() => { setActiveView(`list:${l.id}`); setSelectedId(null) }}
                className={`flex-1 flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  activeView === `list:${l.id}`
                    ? 'bg-blue-600/20 text-blue-300'
                    : 'text-tx-sub hover:bg-raised/50'
                }`}
              >
                <span className="text-lg">{l.emoji}</span>
                <span className="flex-1 truncate text-left">{l.name}</span>
                {(viewCounts[`list:${l.id}`] ?? 0) > 0 && (
                  <span className="text-xs tabular-nums text-tx-faint">{viewCounts[`list:${l.id}`]}</span>
                )}
              </button>
              <button
                onClick={() => handleDeleteList(l.id)}
                className="text-tx-faintest hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 px-1"
              >
                ✕
              </button>
            </div>
          ))}
          {showNewList ? (
            <div className="flex gap-1 mt-1">
              <input
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddList(); if (e.key === 'Escape') setShowNewList(false) }}
                placeholder="列表名称"
                autoFocus
                className="flex-1 px-2 py-1 rounded bg-raised text-tx text-sm border border-bd-strong focus:border-blue-500 focus:outline-none"
              />
              <button onClick={handleAddList} className="text-blue-400 text-sm px-1">✓</button>
              <button onClick={() => setShowNewList(false)} className="text-tx-muted text-sm px-1">✕</button>
            </div>
          ) : (
            <button
              onClick={() => setShowNewList(true)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-tx-faint hover:text-tx-sub hover:bg-raised/50"
            >
              <span className="text-lg">+</span>
              <span>新建列表</span>
            </button>
          )}
        </div>
      </div>

      {/* ====== Center: task list ====== */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* header */}
        <div className="px-6 pt-6 pb-4">
          <h2 className={`text-2xl font-bold ${activeView === 'myday' ? 'text-tx' : 'text-tx'}`}>
            {viewTitle}
          </h2>
          {subtitle && <p className="text-sm text-tx-muted mt-1">{subtitle}</p>}
        </div>

        {/* add input */}
        <div className="px-6 pb-3">
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-surface/60 border border-bd focus-within:border-blue-500 transition-colors">
            <span className="text-blue-400 text-lg">+</span>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder="添加任务"
              className="flex-1 bg-transparent text-tx text-sm outline-none placeholder-tx-faint"
            />
          </div>
        </div>

        {/* task list */}
        <div className="flex-1 overflow-y-auto px-6 pb-4">
          <div className="rounded-lg overflow-hidden divide-y divide-bd/50">
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

          {undoneTodos.length === 0 && !showDone && (
            <div className="text-center py-12 text-tx-faint">
              {activeView === 'myday' ? (
                <>
                  <p className="text-4xl mb-3">☀️</p>
                  <p>专注于今天重要的事</p>
                </>
              ) : (
                <p>暂无待办</p>
              )}
            </div>
          )}

          {/* completed section */}
          {(doneTodos.length > 0 || showDone) && (
            <div className="mt-4">
              <button
                onClick={() => setShowDone(!showDone)}
                className="flex items-center gap-2 text-sm text-tx-muted hover:text-tx mb-2"
              >
                <span className={`transition-transform ${showDone ? 'rotate-90' : ''}`}>▶</span>
                已完成 ({doneTodos.length})
              </button>
              {showDone && (
                <div className="rounded-lg overflow-hidden divide-y divide-bd/50">
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
      </div>

      {/* ====== Right: detail panel ====== */}
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
