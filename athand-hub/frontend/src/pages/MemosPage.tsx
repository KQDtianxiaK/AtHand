import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { createMemo, deleteMemo, getMemos, Memo, updateMemo } from '../api/client'

const shellPanelClass = 'rounded-[1.75rem] border border-bd bg-surface/[0.88] shadow-ambient backdrop-blur-xl'
const sectionCardClass = 'rounded-[1.35rem] border border-bd bg-page/[0.52]'
const insetCardClass = 'rounded-[1.1rem] border border-bd bg-page/[0.4]'
const fieldClass = 'w-full rounded-[1.05rem] border border-bd-strong bg-surface-elevated/[0.9] px-3 py-2.5 text-sm text-tx shadow-inset outline-none transition placeholder:text-tx-faint focus:border-accent/40 focus:ring-2 focus:ring-accent/10'
const secondaryButtonClass = 'rounded-[1rem] border border-bd bg-page/[0.55] px-3 py-2 text-xs font-medium text-tx-muted transition hover:border-bd-strong hover:bg-surface-elevated/[0.92] hover:text-tx-sub disabled:opacity-50'
const primaryButtonClass = 'rounded-[1.05rem] bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:bg-accent-strong disabled:opacity-50'

// Markdown 渲染组件（预览用）
function MarkdownView({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none
                    prose-headings:text-tx prose-headings:tracking-[-0.03em]
                    prose-p:text-tx prose-p:leading-7
                    prose-strong:text-tx-sub prose-em:text-tx-muted
                    prose-code:text-accent prose-code:bg-page/[0.65] prose-code:px-1.5 prose-code:py-0.5
                    prose-code:rounded-[0.55rem] prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
                    prose-pre:bg-surface-elevated/[0.92] prose-pre:border prose-pre:border-bd prose-pre:rounded-[1rem]
                    prose-blockquote:border-accent prose-blockquote:text-tx-muted
                    prose-a:text-accent prose-a:no-underline hover:prose-a:underline
                    prose-ul:text-tx prose-ol:text-tx prose-li:text-tx
                    prose-hr:border-bd prose-table:text-tx prose-th:text-tx prose-td:text-tx">
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
  const pinnedCount = memos.filter((memo) => memo.is_pinned).length
  const activeMemoTitle = selected?.title?.trim() || '无标题备忘录'

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
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6 xl:flex-row">
      <section className={`flex w-full min-h-[360px] flex-col overflow-hidden xl:w-[336px] ${shellPanelClass}`}>
        <div className="border-b border-bd/70 px-5 py-5">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Memo Library</div>
          <h2 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-tx">备忘录</h2>
          <p className="mt-2 text-sm leading-6 text-tx-muted">把搜索、最近更新和置顶笔记收进一套更安静、可阅读的工作区里。</p>
        </div>

        <div className="space-y-4 p-4">
          <div className={`${sectionCardClass} p-3`}>
            <div className="flex flex-col gap-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索标题或正文..."
                className={fieldClass}
              />
              <button onClick={handleNew} className={`${primaryButtonClass} w-full`}>
                新建备忘录
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className={`${insetCardClass} px-3 py-3`}>
              <div className="text-[11px] text-tx-faint">当前结果</div>
              <div className="mt-1 text-xl font-semibold tracking-[-0.03em] text-tx-sub">{memos.length}</div>
            </div>
            <div className={`${insetCardClass} px-3 py-3`}>
              <div className="text-[11px] text-tx-faint">置顶笔记</div>
              <div className="mt-1 text-xl font-semibold tracking-[-0.03em] text-tx-sub">{pinnedCount}</div>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <div className="mb-3 px-1 text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">
            {search.trim() ? 'Search Results' : 'Recent Notes'}
          </div>

          <div className="space-y-3">
            {memos.map((memo) => {
              const isSelected = selected?.id === memo.id && mode !== 'new'
              return (
                <button
                  key={memo.id}
                  onClick={() => handleSelect(memo)}
                  className={`w-full rounded-[1.25rem] border px-4 py-3.5 text-left transition-all ${
                    isSelected
                      ? 'border-accent/20 bg-accent-soft/[0.8] shadow-float ring-1 ring-accent/10'
                      : 'border-bd bg-surface-elevated/[0.88] hover:border-bd-strong hover:bg-surface-elevated/[0.96]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {memo.is_pinned && (
                      <span className="rounded-full border border-warning/25 bg-warning/10 px-2 py-0.5 text-[11px] text-warning">
                        📌 置顶
                      </span>
                    )}
                    <span className="truncate text-sm font-medium text-tx-sub">
                      {memo.title || '无标题备忘录'}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs leading-6 text-tx-muted">
                    {memo.content.slice(0, 96) || '（空内容）'}
                  </p>
                  <div className="mt-2 text-[11px] text-tx-faint">
                    {new Date(memo.updated_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </button>
              )
            })}

            {memos.length === 0 && (
              <div className="rounded-[1.2rem] border border-dashed border-bd px-5 py-8 text-center text-sm leading-6 text-tx-faint">
                {search.trim() ? '没有匹配的备忘录结果。' : '还没有备忘录，先创建第一篇。'}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className={`flex min-h-[420px] min-w-0 flex-1 flex-col overflow-hidden ${shellPanelClass}`}>
        <div className="border-b border-bd/70 px-5 py-5">
          {mode === 'view' && selected ? (
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Reading</div>
                <h2 className="mt-2 truncate text-[1.75rem] font-semibold tracking-[-0.04em] text-tx">{activeMemoTitle}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-tx-faint">
                  <span className="rounded-full border border-bd bg-page/[0.55] px-2 py-1">
                    更新于 {new Date(selected.updated_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {selected.is_pinned && (
                    <span className="rounded-full border border-warning/25 bg-warning/10 px-2 py-1 text-warning">
                      📌 已置顶
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button onClick={handleStartEdit} className={secondaryButtonClass}>编辑</button>
                <button onClick={() => handlePin(selected)} className={secondaryButtonClass}>
                  {selected.is_pinned ? '取消置顶' : '置顶'}
                </button>
                <button
                  onClick={() => handleDelete(selected.id)}
                  className="rounded-[1rem] border border-danger/25 bg-danger/10 px-3 py-2 text-xs font-medium text-danger transition hover:bg-danger/15"
                >
                  删除
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">
                  {mode === 'new' ? 'New Memo' : 'Memo Workspace'}
                </div>
                <h2 className="mt-2 text-[1.75rem] font-semibold tracking-[-0.04em] text-tx">
                  {mode === 'new' ? '新建备忘录' : mode === 'edit' ? '编辑备忘录' : '选择一篇备忘录'}
                </h2>
                <p className="mt-2 text-sm leading-6 text-tx-muted">
                  {mode === 'new'
                    ? '支持 Markdown，左侧维护列表，右侧专注写作和预览。'
                    : mode === 'edit'
                      ? '编辑区和预览区保持同屏，减少来回切换。'
                      : '选择左侧条目查看，或者新建一篇新的备忘录。'}
                </p>
              </div>

              {mode === 'view' && !selected && (
                <button onClick={handleNew} className={primaryButtonClass}>新建备忘录</button>
              )}
            </div>
          )}
        </div>

        {(mode === 'edit' || mode === 'new') ? (
          <>
            <div className="border-b border-bd/50 px-5 py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="标题"
                  className={`${fieldClass} flex-1 text-base font-medium`}
                />
                <div className="flex gap-2">
                  <button onClick={handleSave} className={primaryButtonClass}>保存</button>
                  <button onClick={handleCancelEdit} className={secondaryButtonClass}>取消</button>
                </div>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-2">
              <div className="flex min-h-0 flex-col border-b border-bd/50 xl:border-b-0 xl:border-r xl:border-bd/50">
                <div className="border-b border-bd/50 px-5 py-3 text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">
                  Markdown 编辑
                </div>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="写点什么...（支持 Markdown）"
                  className="flex-1 resize-none bg-transparent px-5 py-4 font-mono text-sm leading-7 text-tx outline-none placeholder:text-tx-faint"
                />
              </div>

              <div className="flex min-h-0 flex-col">
                <div className="border-b border-bd/50 px-5 py-3 text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">
                  实时预览
                </div>
                <div className="min-h-0 flex-1 overflow-auto bg-page/[0.28] p-5">
                  <div className={`${sectionCardClass} min-h-full p-6`}>
                    <MarkdownView content={content} />
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : selected ? (
          <div className="min-h-0 flex-1 overflow-auto bg-page/[0.28] p-5">
            <div className={`${sectionCardClass} min-h-full p-6 lg:p-8`}>
              <MarkdownView content={selected.content} />
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            <div className={`${sectionCardClass} w-full max-w-2xl px-8 py-12 text-center`}>
              <div className="text-4xl">📝</div>
              <div className="mt-4 text-xl font-medium text-tx-sub">选择一篇备忘录开始阅读</div>
              <p className="mt-3 text-sm leading-7 text-tx-faint">
                左侧列表负责搜索和切换，右侧专注内容预览；想开始写新的内容时，可以直接创建一篇新备忘录。
              </p>
              <button onClick={handleNew} className={`${primaryButtonClass} mt-6`}>
                新建备忘录
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
