import { useCallback, useEffect, useState } from 'react'
import {
  createNewsSource,
  deleteNewsSource,
  getNewsSettings,
  getNewsSources,
  testNewsSource,
  updateNewsSettings,
  updateNewsSource,
  type NewsSettingsData,
  type NewsSource,
} from '../api/client'

const modalShellClass = 'w-full max-w-6xl rounded-[1.75rem] border border-bd bg-surface/[0.98] shadow-float backdrop-blur-xl'
const sectionCardClass = 'rounded-[1.3rem] border border-bd bg-page/[0.52]'
const insetCardClass = 'rounded-[1.05rem] border border-bd bg-page/[0.4]'
const fieldClass = 'w-full rounded-[1rem] border border-bd-strong bg-surface-elevated/[0.92] px-3 py-2.5 text-sm text-tx shadow-inset outline-none transition placeholder:text-tx-faint focus:border-accent/40 focus:ring-2 focus:ring-accent/10'
const secondaryButtonClass = 'rounded-[1rem] border border-bd bg-page/[0.55] px-3 py-2 text-xs font-medium text-tx-muted transition hover:border-bd-strong hover:bg-surface-elevated/[0.92] hover:text-tx-sub disabled:opacity-50'
const primaryButtonClass = 'rounded-[1rem] bg-accent px-3 py-2 text-xs font-medium text-white transition hover:bg-accent-strong disabled:opacity-50'

type NoticeTone = 'info' | 'success' | 'error'

type BbParams = {
  category: string[]
  type: string[]
  featured: string
  language: string
  timeFilter: string
  minScore: string
  keyword: string
}

const DEFAULT_BB_PARAMS: BbParams = {
  category: [],
  type: [],
  featured: '',
  language: '',
  timeFilter: '',
  minScore: '',
  keyword: '',
}

const BB_LABELS: Record<string, Record<string, string>> = {
  category: { programming: '编程', ai: 'AI', product: '产品', business: '商业' },
  type: { article: '文章', podcast: '播客', video: '视频', twitter: '推文' },
  language: { zh: '中文', en: '英文', all: '全语言' },
  timeFilter: { '1d': '近1天', '3d': '近3天', '1w': '近1周', '1m': '近1月', '3m': '近3月' },
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
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

function SourceTypeBadge({ sourceType }: { sourceType: string }) {
  const label = sourceType === 'x_account' ? 'X' : sourceType === 'rss' ? 'RSS' : sourceType === 'blog' ? '博客' : sourceType
  const className =
    sourceType === 'x_account'
      ? 'border-sky-500/20 bg-sky-500/10 text-sky-600'
      : sourceType === 'rss'
        ? 'border-amber-500/20 bg-amber-500/10 text-amber-600'
        : sourceType === 'blog'
          ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600'
          : 'border-bd bg-page/[0.7] text-tx-muted'

  return <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${className}`}>{label}</span>
}

function TogglePill({ enabled, onToggle, disabled }: { enabled: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition ${enabled ? 'border-emerald-500/30 bg-emerald-500/80' : 'border-bd bg-page/[0.65]'} ${disabled ? 'opacity-50' : ''}`}
      aria-label={enabled ? '点击禁用' : '点击启用'}
    >
      <span
        className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform"
        style={{ left: enabled ? '22px' : '2px' }}
      />
    </button>
  )
}

function BestBlogsParamsEditor({ params, onChange }: { params: BbParams; onChange: (params: BbParams) => void }) {
  const setValue = (key: keyof BbParams, value: string) => onChange({ ...params, [key]: value })
  const toggleValue = (key: 'category' | 'type', value: string) => {
    const current = params[key]
    onChange({ ...params, [key]: current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value] })
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className={`${insetCardClass} space-y-3 p-3`}>
          <div className="text-xs font-medium text-tx-sub">分类（可多选）</div>
          <div className="grid gap-2">
            {([
              ['programming', '编程开发'],
              ['ai', '人工智能'],
              ['product', '产品设计'],
              ['business', '商业科技'],
            ] as const).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-xs text-tx-sub">
                <input type="checkbox" checked={params.category.includes(value)} onChange={() => toggleValue('category', value)} className="rounded border-bd" />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className={`${insetCardClass} space-y-3 p-3`}>
          <div className="text-xs font-medium text-tx-sub">资源类型（可多选）</div>
          <div className="grid gap-2">
            {([
              ['article', '文章'],
              ['podcast', '播客'],
              ['video', '视频'],
              ['twitter', '推文'],
            ] as const).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-xs text-tx-sub">
                <input type="checkbox" checked={params.type.includes(value)} onChange={() => toggleValue('type', value)} className="rounded border-bd" />
                {label}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div>
          <label className="mb-1.5 block text-xs text-tx-muted">语言</label>
          <select value={params.language} onChange={(event) => setValue('language', event.target.value)} className={fieldClass}>
            <option value="">默认</option>
            <option value="zh">中文</option>
            <option value="en">英文</option>
            <option value="all">全部语言</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs text-tx-muted">时间范围</label>
          <select value={params.timeFilter} onChange={(event) => setValue('timeFilter', event.target.value)} className={fieldClass}>
            <option value="">默认（1周）</option>
            <option value="1d">最近1天</option>
            <option value="3d">最近3天</option>
            <option value="1w">最近1周</option>
            <option value="1m">最近1月</option>
            <option value="3m">最近3月</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs text-tx-muted">最低评分（0-100）</label>
          <input type="number" min={0} max={100} value={params.minScore} onChange={(event) => setValue('minScore', event.target.value)} placeholder="不限" className={fieldClass} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs text-tx-muted">关键词搜索</label>
          <input type="text" value={params.keyword} onChange={(event) => setValue('keyword', event.target.value)} placeholder="如 ChatGPT" className={fieldClass} />
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-tx-sub">
        <input type="checkbox" checked={params.featured === 'y'} onChange={(event) => setValue('featured', event.target.checked ? 'y' : '')} className="rounded border-bd" />
        仅精选文章
      </label>
    </div>
  )
}

function SourceRow({
  source,
  onUpdate,
  onDelete,
  onTest,
}: {
  source: NewsSource
  onUpdate: (id: number, body: Record<string, unknown>) => Promise<void>
  onDelete: (id: number) => Promise<void>
  onTest: (id: number) => Promise<void>
}) {
  const isBestBlogs = source.url.includes('bestblogs.dev')
  const [editing, setEditing] = useState(false)
  const [busyAction, setBusyAction] = useState<'toggle' | 'test' | 'delete' | 'save' | null>(null)
  const [bbParams, setBbParams] = useState<BbParams>(DEFAULT_BB_PARAMS)

  useEffect(() => {
    if (!isBestBlogs) return
    try {
      const config = JSON.parse(source.config_json || '{}')
      const params = config.params || {}
      setBbParams({
        category: Array.isArray(params.category) ? params.category : params.category ? [params.category] : [],
        type: Array.isArray(params.type) ? params.type : params.type ? [params.type] : [],
        featured: params.featured || '',
        language: params.language || '',
        timeFilter: params.timeFilter || '',
        minScore: params.minScore || '',
        keyword: params.keyword || '',
      })
    } catch {
      setBbParams(DEFAULT_BB_PARAMS)
    }
  }, [isBestBlogs, source.config_json])

  const tags: string[] = []
  if (isBestBlogs) {
    bbParams.category.forEach((value) => tags.push(BB_LABELS.category[value] || value))
    bbParams.type.forEach((value) => tags.push(BB_LABELS.type[value] || value))
    if (bbParams.language) tags.push(BB_LABELS.language[bbParams.language] || bbParams.language)
    if (bbParams.timeFilter) tags.push(BB_LABELS.timeFilter[bbParams.timeFilter] || bbParams.timeFilter)
    if (bbParams.minScore) tags.push(`≥${bbParams.minScore}分`)
    if (bbParams.keyword) tags.push(`关键词:${bbParams.keyword}`)
    if (bbParams.featured === 'y') tags.push('精选')
  }

  const handleSaveBestBlogs = async () => {
    const params = Object.fromEntries(
      Object.entries(bbParams).filter(([, value]) => (Array.isArray(value) ? value.length > 0 : value !== '')),
    )
    setBusyAction('save')
    try {
      await onUpdate(source.id, { config_json: JSON.stringify({ params }) })
      setEditing(false)
    } finally {
      setBusyAction(null)
    }
  }

  const handleToggle = async () => {
    setBusyAction('toggle')
    try {
      await onUpdate(source.id, { enabled: !source.enabled })
    } finally {
      setBusyAction(null)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`确定删除信息源「${source.name}」吗？`)) return
    setBusyAction('delete')
    try {
      await onDelete(source.id)
    } finally {
      setBusyAction(null)
    }
  }

  const handleTest = async () => {
    setBusyAction('test')
    try {
      await onTest(source.id)
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <div className={`${sectionCardClass} p-4`}>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SourceTypeBadge sourceType={source.source_type} />
            <span className="text-sm font-medium text-tx-sub">{source.name}</span>
            {source.category ? <span className="rounded-full border border-bd bg-page/[0.7] px-2.5 py-1 text-[11px] text-tx-muted">#{source.category}</span> : null}
            {!source.enabled ? <span className="rounded-full border border-bd bg-page/[0.7] px-2.5 py-1 text-[11px] text-tx-faint">已禁用</span> : null}
          </div>
          <p className="mt-2 break-all text-xs leading-6 text-tx-muted">{source.url || '内置信息源'}</p>
          {tags.length > 0 && !editing ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span key={tag} className="rounded-full border border-accent/15 bg-accent-soft/[0.78] px-2.5 py-1 text-[11px] text-accent">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isBestBlogs ? (
            <button onClick={() => setEditing((value) => !value)} className={editing ? primaryButtonClass : secondaryButtonClass}>
              {editing ? '收起参数' : '参数'}
            </button>
          ) : null}
          <TogglePill enabled={source.enabled} onToggle={() => void handleToggle()} disabled={busyAction === 'toggle'} />
          <button onClick={() => void handleTest()} disabled={busyAction === 'test'} className={secondaryButtonClass}>
            {busyAction === 'test' ? '测试中...' : '测试'}
          </button>
          <button onClick={() => void handleDelete()} disabled={busyAction === 'delete'} className="rounded-[1rem] border border-danger/25 bg-danger/10 px-3 py-2 text-xs font-medium text-danger transition hover:bg-danger/15 disabled:opacity-50">
            {busyAction === 'delete' ? '删除中...' : '删除'}
          </button>
        </div>
      </div>

      {isBestBlogs && editing ? (
        <div className={`${insetCardClass} mt-4 space-y-4 p-4`}>
          <div>
            <div className="text-xs font-medium text-accent">BestBlogs 过滤参数</div>
            <p className="mt-1 text-xs leading-6 text-tx-muted">这些规则会直接写回源配置，用来约束你拉取到的 BestBlogs 结果。</p>
          </div>
          <BestBlogsParamsEditor params={bbParams} onChange={setBbParams} />
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(false)} className={secondaryButtonClass}>取消</button>
            <button onClick={() => void handleSaveBestBlogs()} disabled={busyAction === 'save'} className={primaryButtonClass}>
              {busyAction === 'save' ? '保存中...' : '保存参数'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function AddSourceForm({ onAdded }: { onAdded: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    name: '',
    source_type: 'rss',
    url: '',
    api_key: '',
    config_json: '{}',
    category: '',
  })
  const [bbParams, setBbParams] = useState<BbParams>(DEFAULT_BB_PARAMS)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const isBestBlogs = form.source_type === 'rss' && form.url.includes('bestblogs.dev')

  const resetForm = () => {
    setForm({ name: '', source_type: 'rss', url: '', api_key: '', config_json: '{}', category: '' })
    setBbParams(DEFAULT_BB_PARAMS)
    setErrorMessage('')
  }

  const handleSubmit = async () => {
    if (!form.name.trim()) return
    setSubmitting(true)
    setErrorMessage('')
    try {
      const configJson = isBestBlogs
        ? JSON.stringify({ params: Object.fromEntries(Object.entries(bbParams).filter(([, value]) => (Array.isArray(value) ? value.length > 0 : value !== ''))) })
        : form.config_json
      await createNewsSource({ ...form, name: form.name.trim(), config_json: configJson })
      resetForm()
      setOpen(false)
      await onAdded()
    } catch (error) {
      setErrorMessage(getErrorMessage(error, '添加信息源失败。'))
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className={primaryButtonClass}>
        添加信息源
      </button>
    )
  }

  return (
    <div className={`${sectionCardClass} space-y-4 p-4`}>
      <SectionHeader eyebrow="New Source" title="添加信息源" description="支持 RSS、博客和 X/Twitter 账号。BestBlogs 会自动启用过滤参数编辑。" />

      {errorMessage ? <InlineNotice tone="error" message={errorMessage} actionLabel="关闭" onAction={() => setErrorMessage('')} /> : null}

      <div className="grid gap-3 md:grid-cols-2">
        <input placeholder="名称" value={form.name} onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))} className={fieldClass} />
        <select value={form.source_type} onChange={(event) => setForm((previous) => ({ ...previous, source_type: event.target.value }))} className={fieldClass}>
          <option value="rss">RSS</option>
          <option value="blog">博客</option>
          <option value="x_account">X/Twitter 账号</option>
        </select>
      </div>

      <input
        placeholder={form.source_type === 'x_account' ? 'X handle（如 karpathy）' : 'URL'}
        value={form.url}
        onChange={(event) => setForm((previous) => ({ ...previous, url: event.target.value }))}
        className={fieldClass}
      />

      {isBestBlogs ? (
        <div className={`${insetCardClass} space-y-4 p-4`}>
          <div>
            <div className="text-xs font-medium text-accent">BestBlogs 过滤参数（可选）</div>
            <p className="mt-1 text-xs leading-6 text-tx-muted">你可以在创建前直接配置过滤规则，也可以创建后再编辑。</p>
          </div>
          <BestBlogsParamsEditor params={bbParams} onChange={setBbParams} />
        </div>
      ) : null}

      {form.source_type === 'x_account' ? (
        <input
          placeholder="X API Bearer Token（可选）"
          type="password"
          value={form.api_key}
          onChange={(event) => setForm((previous) => ({ ...previous, api_key: event.target.value }))}
          className={fieldClass}
        />
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <input placeholder="分类标签（可选）" value={form.category} onChange={(event) => setForm((previous) => ({ ...previous, category: event.target.value }))} className={fieldClass} />
        {form.source_type === 'x_account' ? (
          <input
            placeholder='配置 JSON（如 {"handle":"karpathy"}）'
            value={form.config_json}
            onChange={(event) => setForm((previous) => ({ ...previous, config_json: event.target.value }))}
            className={fieldClass}
          />
        ) : null}
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={() => { resetForm(); setOpen(false) }} className={secondaryButtonClass}>取消</button>
        <button onClick={() => void handleSubmit()} disabled={submitting || !form.name.trim()} className={primaryButtonClass}>
          {submitting ? '添加中...' : '添加信息源'}
        </button>
      </div>
    </div>
  )
}

export default function NewsSettingsDialog({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<NewsSettingsData | null>(null)
  const [sources, setSources] = useState<NewsSource[]>([])
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadingSources, setLoadingSources] = useState(false)
  const [notice, setNotice] = useState<{ tone: NoticeTone; message: string } | null>(null)

  const loadSources = useCallback(async () => {
    setLoadingSources(true)
    try {
      const nextSources = await getNewsSources()
      setSources(nextSources)
    } catch (error) {
      setNotice({ tone: 'error', message: getErrorMessage(error, '信息源列表加载失败。') })
    } finally {
      setLoadingSources(false)
    }
  }, [])

  const loadSettings = useCallback(async () => {
    setLoading(true)
    try {
      const [nextSettings, nextSources] = await Promise.all([getNewsSettings(), getNewsSources()])
      setSettings(nextSettings)
      setSources(nextSources)
      setNotice(null)
    } catch (error) {
      setNotice({ tone: 'error', message: getErrorMessage(error, '新闻设置加载失败。') })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  const handleSave = async () => {
    if (!settings) return
    setSaving(true)
    try {
      await updateNewsSettings(settings)
      setDirty(false)
      setNotice({ tone: 'success', message: '新闻设置已保存。' })
    } catch (error) {
      setNotice({ tone: 'error', message: getErrorMessage(error, '保存新闻设置失败。') })
    } finally {
      setSaving(false)
    }
  }

  const handleUpdateSource = async (id: number, body: Record<string, unknown>) => {
    try {
      await updateNewsSource(id, body)
      await loadSources()
      setNotice({ tone: 'success', message: '信息源已更新。' })
    } catch (error) {
      setNotice({ tone: 'error', message: getErrorMessage(error, '更新信息源失败。') })
      throw error
    }
  }

  const handleDeleteSource = async (id: number) => {
    try {
      await deleteNewsSource(id)
      await loadSources()
      setNotice({ tone: 'success', message: '信息源已删除。' })
    } catch (error) {
      setNotice({ tone: 'error', message: getErrorMessage(error, '删除信息源失败。') })
      throw error
    }
  }

  const handleTestSource = async (id: number) => {
    try {
      const result = await testNewsSource(id)
      setNotice({ tone: result.status === 'ok' ? 'success' : 'error', message: result.message })
    } catch (error) {
      setNotice({ tone: 'error', message: getErrorMessage(error, '测试信息源失败。') })
      throw error
    }
  }

  const updateField = <K extends keyof NewsSettingsData>(key: K, value: NewsSettingsData[K]) => {
    setSettings((previous) => (previous ? { ...previous, [key]: value } : previous))
    setDirty(true)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className={`${modalShellClass} max-h-[90vh] overflow-hidden`} onClick={(event) => event.stopPropagation()}>
        <div className="border-b border-bd/70 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">News Control</div>
              <h2 className="mt-2 text-[1.55rem] font-semibold tracking-[-0.04em] text-tx">新闻设置</h2>
              <p className="mt-2 text-sm leading-6 text-tx-muted">在这里维护信息源、调度时间、功能开关和摘要 Prompt，让新闻工作区的抓取与沉淀保持可控。</p>
            </div>
            <button onClick={onClose} className="rounded-full border border-bd bg-page/[0.6] px-3 py-2 text-sm text-tx-muted transition hover:border-bd-strong hover:text-tx-sub">
              关闭
            </button>
          </div>
        </div>

        <div className="min-h-0 overflow-auto px-6 py-5">
          {notice ? (
            <div className="mb-4">
              <InlineNotice tone={notice.tone} message={notice.message} actionLabel="关闭" onAction={() => setNotice(null)} />
            </div>
          ) : null}

          {loading ? (
            <div className="flex min-h-[420px] items-center justify-center">
              <div className={`${sectionCardClass} w-full max-w-xl px-8 py-12 text-center`}>
                <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                <h3 className="mt-5 text-xl font-semibold tracking-[-0.03em] text-tx">正在加载新闻设置</h3>
                <p className="mt-3 text-sm leading-7 text-tx-faint">先读取调度配置和信息源，再进入可编辑状态。</p>
              </div>
            </div>
          ) : settings ? (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.9fr)]">
              <div className="space-y-5">
                <div className={`${sectionCardClass} p-5`}>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <SectionHeader
                      eyebrow="Sources"
                      title="信息源管理"
                      description="启用、测试和过滤不同信息源。RSS、博客和 X 账号都会汇总进新闻工作区。"
                    />
                    <AddSourceForm onAdded={loadSources} />
                  </div>

                  <div className="mt-5 space-y-3">
                    {loadingSources ? <InlineNotice tone="info" message="正在刷新信息源列表..." /> : null}
                    {sources.length > 0 ? (
                      sources.map((source) => (
                        <SourceRow key={source.id} source={source} onUpdate={handleUpdateSource} onDelete={handleDeleteSource} onTest={handleTestSource} />
                      ))
                    ) : (
                      <div className="rounded-[1.1rem] border border-dashed border-bd px-4 py-8 text-center text-sm leading-6 text-tx-faint">
                        当前还没有自定义信息源。可以先添加 RSS、博客或 X 账号。
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-5">
                <div className={`${sectionCardClass} p-5`}>
                  <SectionHeader eyebrow="Schedule" title="调度设置" description="控制每天抓取和生成摘要的时间，以及摘要语言与回溯窗口。" />
                  <div className="mt-5 grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-xs text-tx-muted">抓取时间</label>
                      <input type="time" value={settings.fetch_time} onChange={(event) => updateField('fetch_time', event.target.value)} className={fieldClass} />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs text-tx-muted">总结时间</label>
                      <input type="time" value={settings.digest_time} onChange={(event) => updateField('digest_time', event.target.value)} className={fieldClass} />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs text-tx-muted">回溯时间（小时）</label>
                      <input type="number" min={1} max={168} value={settings.lookback_hours} onChange={(event) => updateField('lookback_hours', Number(event.target.value))} className={fieldClass} />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs text-tx-muted">总结语言</label>
                      <select value={settings.digest_language} onChange={(event) => updateField('digest_language', event.target.value)} className={fieldClass}>
                        <option value="zh">中文</option>
                        <option value="en">English</option>
                        <option value="bilingual">双语</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className={`${sectionCardClass} p-5`}>
                  <SectionHeader eyebrow="Switches" title="功能开关" description="决定是否启用内置源和摘要通知。" />
                  <div className="mt-5 space-y-3">
                    <label className={`${insetCardClass} flex items-start gap-3 p-4`}>
                      <input type="checkbox" checked={settings.follow_builders_enabled} onChange={(event) => updateField('follow_builders_enabled', event.target.checked)} className="mt-1 rounded border-bd" />
                      <div>
                        <div className="text-sm font-medium text-tx-sub">启用 Follow Builders 内置源</div>
                        <div className="mt-1 text-xs leading-6 text-tx-muted">这个内置源免费、无需 API Key，适合作为默认 AI 构建者信息流。</div>
                      </div>
                    </label>

                    <label className={`${insetCardClass} flex items-start gap-3 p-4`}>
                      <input type="checkbox" checked={settings.notification_enabled} onChange={(event) => updateField('notification_enabled', event.target.checked)} className="mt-1 rounded border-bd" />
                      <div>
                        <div className="text-sm font-medium text-tx-sub">新总结就绪时通知</div>
                        <div className="mt-1 text-xs leading-6 text-tx-muted">摘要任务完成后会推送通知，方便你从其他页面及时回来查看。</div>
                      </div>
                    </label>
                  </div>
                </div>

                <div className={`${sectionCardClass} p-5`}>
                  <SectionHeader eyebrow="Prompt" title="总结 Prompt" description="自定义每日总结的 AI 提示词。留空时仍使用默认模板。" />
                  <p className="mt-4 text-xs leading-6 text-tx-muted">支持 {'{'} date {'}'} 和 {'{'} item_count {'}'} 变量，用来控制输出格式与强调重点。</p>
                  <textarea
                    value={settings.digest_prompt}
                    onChange={(event) => updateField('digest_prompt', event.target.value)}
                    placeholder="留空使用默认 Prompt..."
                    rows={10}
                    className={`${fieldClass} mt-4 resize-y py-3`}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[420px] items-center justify-center">
              <div className={`${sectionCardClass} w-full max-w-xl px-8 py-12 text-center`}>
                <div className="text-5xl">⚠️</div>
                <h3 className="mt-5 text-xl font-semibold tracking-[-0.03em] text-tx">新闻设置暂时不可用</h3>
                <p className="mt-3 text-sm leading-7 text-tx-faint">当前没有加载到设置数据。可以先重试连接，再决定是否关闭弹窗。</p>
                <button onClick={() => void loadSettings()} className={`${primaryButtonClass} mt-6 px-5 py-3 text-sm`}>
                  重试加载
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-bd/70 px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="text-xs text-tx-muted">{dirty ? '你有未保存的新闻设置改动。' : '当前设置已同步到最新状态。'}</div>
            <div className="flex gap-2">
              <button onClick={onClose} className={secondaryButtonClass}>关闭</button>
              <button onClick={() => void handleSave()} disabled={!dirty || saving || !settings} className={primaryButtonClass}>
                {saving ? '保存中...' : '保存设置'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}