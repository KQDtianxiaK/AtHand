import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { createMemo, deleteMemo, getMemos, Memo, updateMemo } from '../api/client'

// Markdown 渲染组件（预览用）
function MarkdownView({ content }: { content: string }) {
  return (
    <div className="prose prose-sm prose-invert max-w-none
                    prose-headings:text-tx prose-p:text-tx prose-p:leading-relaxed
                    prose-strong:text-tx prose-em:text-tx-sub
                    prose-code:text-blue-300 prose-code:bg-raised prose-code:px-1.5 prose-code:py-0.5
                    prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
                    prose-pre:bg-raised prose-pre:border prose-pre:border-bd prose-pre:rounded-lg
                    prose-blockquote:border-blue-500 prose-blockquote:text-tx-sub
                    prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
                    prose-ul:text-tx prose-ol:text-tx prose-li:text-tx
                    prose-hr:border-bd prose-table:text-tx
                    prose-th:text-tx prose-td:text-tx">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content || '*（空内容）*'}
      </ReactMarkdown>
    </div>
  )
}

export default function MemosPage() {
  const [memos, setMemos] = useState<Memo[]>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Memo | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  // 'view' = 渲染模式，'edit' = 编辑模式（分栏预览），'new' = 新建
  const [mode, setMode] = useState<'view' | 'edit' | 'new'>('view')

  const [refreshKey, setRefreshKey] = useState(0)

  const load = () => getMemos(false, search || undefined).then(setMemos).catch(console.error)

  useEffect(() => { load() }, [search, refreshKey])

  // AI 助手操作备忘录后自动刷新
  useEffect(() => {
    const MEMO_TOOLS = new Set(['create_memo', 'delete_memo', 'search_memos'])
    const handler = (e: Event) => {
      const { tool } = (e as CustomEvent).detail
      if (MEMO_TOOLS.has(tool)) setRefreshKey((k) => k + 1)
    }
    window.addEventListener('athand:data-changed', handler)
    return () => window.removeEventListener('athand:data-changed', handler)
  }, [])

  const handleNew = () => {
    setSelected(null)
    setTitle('')
    setContent('')
    setMode('new')
  }

  const handleSave = async () => {
    if (mode === 'edit' && selected) {
      await updateMemo(selected.id, { title, content })
      // 更新本地 selected 以便返回 view 时显示最新内容
      setSelected({ ...selected, title, content, updated_at: new Date().toISOString() })
    } else {
      await createMemo({ title, content })
    }
    setMode(mode === 'edit' ? 'view' : 'view')
    load()
  }

  const handleSelect = (memo: Memo) => {
    setSelected(memo)
    setTitle(memo.title)
    setContent(memo.content)
    setMode('view')
  }

  const handleStartEdit = () => {
    setMode('edit')
  }

  const handleCancelEdit = () => {
    if (selected) {
      setTitle(selected.title)
      setContent(selected.content)
      setMode('view')
    } else {
      setMode('view')
      setSelected(null)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除？')) return
    await deleteMemo(id)
    if (selected?.id === id) {
      setSelected(null)
      setMode('view')
    }
    load()
  }

  const handlePin = async (memo: Memo) => {
    await updateMemo(memo.id, { is_pinned: !memo.is_pinned })
    load()
  }

  return (
    <div className="flex flex-col lg:flex-row h-full">
      {/* 左侧列表 */}
      <div className="lg:w-72 border-b lg:border-b-0 lg:border-r border-bd flex flex-col flex-shrink-0">
        <div className="p-3 border-b border-bd flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索..."
            className="flex-1 px-3 py-1.5 rounded-lg bg-raised text-tx border border-bd-strong text-sm"
          />
          <button
            onClick={handleNew}
            className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700"
          >
            +
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {memos.map((memo) => (
            <button
              key={memo.id}
              onClick={() => handleSelect(memo)}
              className={`w-full text-left px-4 py-3 border-b border-bd/50 hover:bg-raised/50 ${
                selected?.id === memo.id ? 'bg-raised/50' : ''
              }`}
            >
              <div className="flex items-center gap-1">
                {memo.is_pinned && <span className="text-yellow-400 text-xs">📌</span>}
                <span className="text-sm font-medium text-tx truncate">
                  {memo.title || '无标题'}
                </span>
              </div>
              <p className="text-xs text-tx-muted mt-1 truncate">{memo.content.slice(0, 60)}</p>
              <p className="text-xs text-tx-faint mt-1">
                {new Date(memo.updated_at).toLocaleDateString()}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* 右侧内容区 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 工具栏 */}
        <div className="h-12 flex items-center px-4 border-b border-bd gap-2 flex-shrink-0">
          {(mode === 'view' || mode === 'edit' || mode === 'new') && (
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="标题"
              readOnly={mode === 'view'}
              className={`flex-1 px-3 py-1.5 rounded-lg text-tx border font-medium text-sm
                         ${mode === 'view'
                           ? 'bg-transparent border-transparent cursor-default'
                           : 'bg-surface border-bd focus:outline-none focus:border-blue-500'}`}
            />
          )}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* 渲染/编辑 切换 */}
            {selected && mode === 'view' && (
              <>
                <button
                  onClick={handleStartEdit}
                  className="px-3 py-1.5 rounded-lg bg-raised hover:bg-raised/80 text-tx-sub text-xs flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                  </svg>
                  编辑
                </button>
                <button
                  onClick={() => handlePin(selected)}
                  className="px-3 py-1.5 rounded-lg bg-raised hover:bg-raised/80 text-tx-sub text-xs"
                >
                  {selected.is_pinned ? '取消置顶' : '📌'}
                </button>
                <button
                  onClick={() => handleDelete(selected.id)}
                  className="px-3 py-1.5 rounded-lg bg-red-600/20 text-red-400 hover:bg-red-600/30 text-xs"
                >
                  删除
                </button>
              </>
            )}
            {(mode === 'edit' || mode === 'new') && (
              <>
                <button
                  onClick={handleSave}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs"
                >
                  保存
                </button>
                {mode === 'edit' && (
                  <button
                    onClick={handleCancelEdit}
                    className="px-3 py-1.5 rounded-lg bg-raised hover:bg-raised/80 text-tx-sub text-xs"
                  >
                    取消
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* 内容区 */}
        {mode === 'view' && selected && (
          // 查看模式：渲染 Markdown
          <div className="flex-1 overflow-auto p-6">
            <MarkdownView content={selected.content} />
          </div>
        )}

        {mode === 'view' && !selected && (
          // 未选中时的空状态
          <div className="flex-1 flex items-center justify-center text-tx-faint text-sm">
            <div className="text-center space-y-2">
              <p>选择一篇备忘录，或点击 <span className="text-blue-400">+</span> 新建</p>
            </div>
          </div>
        )}

        {(mode === 'edit' || mode === 'new') && (
          // 编辑模式：左右分栏
          <div className="flex-1 flex min-h-0">
            {/* 左：Markdown 编辑器 */}
            <div className="flex-1 flex flex-col border-r border-bd min-w-0">
              <div className="px-3 py-1.5 border-b border-bd/50 text-xs text-tx-faint flex-shrink-0">
                Markdown 编辑
              </div>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="写点什么... (支持 Markdown)"
                className="flex-1 px-4 py-3 bg-surface text-tx resize-none font-mono text-sm
                           focus:outline-none leading-relaxed"
              />
            </div>
            {/* 右：实时预览 */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="px-3 py-1.5 border-b border-bd/50 text-xs text-tx-faint flex-shrink-0">
                预览
              </div>
              <div className="flex-1 overflow-auto px-6 py-3">
                <MarkdownView content={content} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
