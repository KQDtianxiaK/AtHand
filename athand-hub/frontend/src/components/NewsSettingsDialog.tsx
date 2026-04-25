import { useEffect, useState } from 'react'
import {
  getNewsSettings, updateNewsSettings, getNewsSources, createNewsSource,
  updateNewsSource, deleteNewsSource, testNewsSource,
  type NewsSettingsData, type NewsSource,
} from '../api/client'

// ---- BestBlogs 过滤参数 ----
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
  category: [], type: [], featured: '', language: '', timeFilter: '', minScore: '', keyword: '',
}

function BestBlogsParamsEditor({ params, onChange }: { params: BbParams; onChange: (p: BbParams) => void }) {
  const set = (key: keyof BbParams, val: string) => onChange({ ...params, [key]: val })
  const toggle = (key: 'category' | 'type', val: string) => {
    const arr = params[key]
    onChange({ ...params, [key]: arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val] })
  }
  const cls = 'w-full px-2 py-1 text-xs bg-surface border border-bd rounded-lg focus:border-blue-500 outline-none'
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-tx-muted block mb-1">分类（可多选）</label>
          <div className="flex flex-col gap-1">
            {([['programming','编程开发'],['ai','人工智能'],['product','产品设计'],['business','商业科技']] as const).map(([val, label]) => (
              <label key={val} className="flex items-center gap-2 text-xs text-tx-sub cursor-pointer">
                <input type="checkbox" checked={params.category.includes(val)} onChange={() => toggle('category', val)} />
                {label}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs text-tx-muted block mb-1">资源类型（可多选）</label>
          <div className="flex flex-col gap-1">
            {([['article','文章'],['podcast','播客'],['video','视频'],['twitter','推文']] as const).map(([val, label]) => (
              <label key={val} className="flex items-center gap-2 text-xs text-tx-sub cursor-pointer">
                <input type="checkbox" checked={params.type.includes(val)} onChange={() => toggle('type', val)} />
                {label}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs text-tx-muted block mb-1">语言</label>
          <select value={params.language} onChange={e => set('language', e.target.value)} className={cls}>
            <option value="">默认</option>
            <option value="zh">中文</option>
            <option value="en">英文</option>
            <option value="all">全部语言</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-tx-muted block mb-1">时间范围</label>
          <select value={params.timeFilter} onChange={e => set('timeFilter', e.target.value)} className={cls}>
            <option value="">默认（1周）</option>
            <option value="1d">最近1天</option>
            <option value="3d">最近3天</option>
            <option value="1w">最近1周</option>
            <option value="1m">最近1月</option>
            <option value="3m">最近3月</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-tx-muted block mb-1">最低评分（0-100）</label>
          <input
            type="number" min={0} max={100} placeholder="不限"
            value={params.minScore}
            onChange={e => set('minScore', e.target.value)}
            className={cls}
          />
        </div>
        <div>
          <label className="text-xs text-tx-muted block mb-1">关键词搜索</label>
          <input
            type="text" placeholder="如 ChatGPT"
            value={params.keyword}
            onChange={e => set('keyword', e.target.value)}
            className={cls}
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs text-tx-sub cursor-pointer">
        <input
          type="checkbox"
          checked={params.featured === 'y'}
          onChange={e => set('featured', e.target.checked ? 'y' : '')}
        />
        仅精选文章
      </label>
    </div>
  )
}

// ---- 信息源编辑行 ----
const BB_LABELS: Record<string, Record<string, string>> = {
  category: { programming: '编程', ai: 'AI', product: '产品', business: '商业' },
  type: { article: '文章', podcast: '播客', video: '视频', twitter: '推文' },
  language: { zh: '中文', en: '英文', all: '全语言' },
  timeFilter: { '1d': '近1天', '3d': '近3天', '1w': '近1周', '1m': '近1月', '3m': '近3月' },
}

function SourceRow({ source, onUpdate, onDelete, onTest }: {
  source: NewsSource
  onUpdate: (id: number, body: Record<string, unknown>) => void
  onDelete: (id: number) => void
  onTest: (id: number) => void
}) {
  const isBestBlogs = source.url.includes('bestblogs.dev')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [bbParams, setBbParams] = useState<BbParams>(DEFAULT_BB_PARAMS)

  useEffect(() => {
    if (!isBestBlogs) return
    try {
      const cfg = JSON.parse(source.config_json || '{}')
      const p = cfg.params || {}
      setBbParams({
        category: Array.isArray(p.category) ? p.category : (p.category ? [p.category] : []),
        type: Array.isArray(p.type) ? p.type : (p.type ? [p.type] : []),
        featured: p.featured || '',
        language: p.language || '',
        timeFilter: p.timeFilter || '',
        minScore: p.minScore || '',
        keyword: p.keyword || '',
      })
    } catch {}
  }, [source.config_json, isBestBlogs])

  const handleSaveBb = async () => {
    setSaving(true)
    const params = Object.fromEntries(
      Object.entries(bbParams).filter(([, v]) => Array.isArray(v) ? (v as string[]).length > 0 : v !== '')
    )
    await onUpdate(source.id, { config_json: JSON.stringify({ params }) })
    setSaving(false)
    setEditing(false)
  }

  const bbTags: string[] = []
  if (isBestBlogs) {
    bbParams.category.forEach(c => bbTags.push(BB_LABELS.category[c] || c))
    bbParams.type.forEach(t => bbTags.push(BB_LABELS.type[t] || t))
    if (bbParams.language) bbTags.push(BB_LABELS.language[bbParams.language] || bbParams.language)
    if (bbParams.timeFilter) bbTags.push(BB_LABELS.timeFilter[bbParams.timeFilter] || bbParams.timeFilter)
    if (bbParams.minScore) bbTags.push(`≥${bbParams.minScore}分`)
    if (bbParams.keyword) bbTags.push(`关键词:${bbParams.keyword}`)
    if (bbParams.featured === 'y') bbTags.push('精选')
  }

  return (
    <div className="py-2 border-b border-bd last:border-b-0">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs px-1.5 py-0.5 rounded ${
              source.source_type === 'x_account' ? 'bg-sky-500/20 text-sky-400'
              : source.source_type === 'rss' ? 'bg-amber-500/20 text-amber-400'
              : source.source_type === 'blog' ? 'bg-emerald-500/20 text-emerald-400'
              : 'bg-gray-500/20 text-gray-400'
            }`}>
              {source.source_type === 'x_account' ? 'X' : source.source_type === 'rss' ? 'RSS' : source.source_type === 'blog' ? '博客' : source.source_type}
            </span>
            <span className="font-medium text-sm text-tx truncate">{source.name}</span>
            {source.category && <span className="text-xs text-tx-muted">#{source.category}</span>}
          </div>
          <p className="text-xs text-tx-muted truncate mt-0.5">{source.url}</p>
        </div>
        {isBestBlogs && (
          <button
            onClick={() => setEditing(!editing)}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              editing ? 'bg-blue-600/20 text-blue-400' : 'bg-raised text-tx-sub hover:bg-surface'
            }`}
          >
            参数
          </button>
        )}
        <button
          onClick={() => onUpdate(source.id, { enabled: !source.enabled })}
          title={source.enabled ? '点击禁用' : '点击启用'}
          className="relative w-10 h-5 rounded-full transition-colors flex-shrink-0"
          style={{ background: source.enabled ? '#22c55e' : '#4b5563' }}
        >
          <span
            className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
            style={{ transform: source.enabled ? 'translateX(20px)' : 'translateX(0px)' }}
          />
        </button>
        <button onClick={() => onTest(source.id)} className="text-xs px-2 py-1 rounded bg-raised text-tx-sub hover:bg-surface">
          测试
        </button>
        <button onClick={() => onDelete(source.id)} className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30">
          删除
        </button>
      </div>
      {isBestBlogs && !editing && bbTags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {bbTags.map((t) => (
            <span key={t} className="text-xs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">{t}</span>
          ))}
        </div>
      )}
      {isBestBlogs && editing && (
        <div className="mt-2 bg-raised rounded-lg p-3 space-y-2 border border-blue-500/30">
          <p className="text-xs font-medium text-blue-400">BestBlogs 过滤参数</p>
          <BestBlogsParamsEditor params={bbParams} onChange={setBbParams} />
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setEditing(false)} className="text-xs px-3 py-1 rounded text-tx-sub hover:bg-surface">
              取消
            </button>
            <button
              onClick={handleSaveBb}
              disabled={saving}
              className="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {saving ? '保存中...' : '保存参数'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- 添加信息源表单 ----
function AddSourceForm({ onAdd }: { onAdd: () => void }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    name: '', source_type: 'rss', url: '', api_key: '', config_json: '{}', category: '',
  })
  const [bbParams, setBbParams] = useState<BbParams>(DEFAULT_BB_PARAMS)
  const [submitting, setSubmitting] = useState(false)
  const isBestBlogs = form.source_type === 'rss' && form.url.includes('bestblogs.dev')

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-sm text-blue-400 hover:text-blue-300">
        + 添加信息源
      </button>
    )
  }

  const handleSubmit = async () => {
    if (!form.name) return
    setSubmitting(true)
    try {
      const configJson = isBestBlogs
        ? JSON.stringify({ params: Object.fromEntries(Object.entries(bbParams).filter(([, v]) => Array.isArray(v) ? (v as string[]).length > 0 : v !== '')) })
        : form.config_json
      await createNewsSource({ ...form, config_json: configJson })
      setForm({ name: '', source_type: 'rss', url: '', api_key: '', config_json: '{}', category: '' })
      setBbParams(DEFAULT_BB_PARAMS)
      setOpen(false)
      onAdd()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-raised rounded-lg p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input
          placeholder="名称"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="px-2 py-1.5 text-sm bg-surface border border-bd rounded-lg focus:border-blue-500 outline-none"
        />
        <select
          value={form.source_type}
          onChange={(e) => setForm((f) => ({ ...f, source_type: e.target.value }))}
          className="px-2 py-1.5 text-sm bg-surface border border-bd rounded-lg focus:border-blue-500 outline-none"
        >
          <option value="rss">RSS</option>
          <option value="blog">博客</option>
          <option value="x_account">X/Twitter 账号</option>
        </select>
      </div>
      <input
        placeholder={form.source_type === 'x_account' ? 'X handle（如 karpathy）' : 'URL'}
        value={form.url}
        onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
        className="w-full px-2 py-1.5 text-sm bg-surface border border-bd rounded-lg focus:border-blue-500 outline-none"
      />
      {isBestBlogs && (
        <div className="bg-raised rounded-lg p-3 space-y-2 border border-blue-500/30">
          <p className="text-xs font-medium text-blue-400">BestBlogs 过滤参数（可选）</p>
          <BestBlogsParamsEditor params={bbParams} onChange={setBbParams} />
        </div>
      )}
      {form.source_type === 'x_account' && (
        <input
          placeholder="X API Bearer Token（可选）"
          type="password"
          value={form.api_key}
          onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
          className="w-full px-2 py-1.5 text-sm bg-surface border border-bd rounded-lg focus:border-blue-500 outline-none"
        />
      )}
      <div className="grid grid-cols-2 gap-2">
        <input
          placeholder="分类标签（可选）"
          value={form.category}
          onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
          className="px-2 py-1.5 text-sm bg-surface border border-bd rounded-lg focus:border-blue-500 outline-none"
        />
        {form.source_type === 'x_account' && (
          <input
            placeholder='配置 JSON（如 {"handle":"karpathy"}）'
            value={form.config_json}
            onChange={(e) => setForm((f) => ({ ...f, config_json: e.target.value }))}
            className="px-2 py-1.5 text-sm bg-surface border border-bd rounded-lg focus:border-blue-500 outline-none"
          />
        )}
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={() => setOpen(false)} className="text-sm px-3 py-1.5 rounded-lg text-tx-sub hover:bg-surface">
          取消
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting || !form.name}
          className="text-sm px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
        >
          添加
        </button>
      </div>
    </div>
  )
}

// ---- 主设置弹窗 ----
export default function NewsSettingsDialog({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<NewsSettingsData | null>(null)
  const [sources, setSources] = useState<NewsSource[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testMsg, setTestMsg] = useState('')

  useEffect(() => {
    getNewsSettings().then(setSettings).catch(console.error)
    loadSources()
  }, [])

  const loadSources = () => {
    getNewsSources().then(setSources).catch(console.error)
  }

  const handleSave = async () => {
    if (!settings) return
    setSaving(true)
    try {
      await updateNewsSettings(settings)
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }

  const handleUpdateSource = async (id: number, body: Record<string, unknown>) => {
    await updateNewsSource(id, body)
    loadSources()
  }

  const handleDeleteSource = async (id: number) => {
    await deleteNewsSource(id)
    loadSources()
  }

  const handleTestSource = async (id: number) => {
    setTestMsg('测试中...')
    try {
      const res = await testNewsSource(id)
      setTestMsg(`${res.status === 'ok' ? '✅' : '❌'} ${res.message}`)
    } catch (e: any) {
      setTestMsg(`❌ ${e.message}`)
    }
    setTimeout(() => setTestMsg(''), 5000)
  }

  const updateField = <K extends keyof NewsSettingsData>(key: K, val: NewsSettingsData[K]) => {
    setSettings((s) => s ? { ...s, [key]: val } : s)
    setDirty(true)
  }

  if (!settings) return null

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-surface rounded-2xl w-full max-w-xl max-h-[85vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-surface border-b border-bd p-4 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-lg font-bold text-tx">新闻设置</h2>
          <button onClick={onClose} className="text-tx-muted hover:text-tx text-xl">×</button>
        </div>

        <div className="p-4 space-y-6">
          {/* 信息源管理 */}
          <section>
            <h3 className="text-sm font-semibold text-tx mb-3">信息源</h3>
            {sources.length > 0 ? (
              <div className="bg-raised rounded-lg px-3 mb-3">
                {sources.map((s) => (
                  <SourceRow
                    key={s.id}
                    source={s}
                    onUpdate={handleUpdateSource}
                    onDelete={handleDeleteSource}
                    onTest={handleTestSource}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-tx-muted mb-3">暂无自定义信息源</p>
            )}
            <AddSourceForm onAdd={loadSources} />
            {testMsg && <p className="text-sm mt-2">{testMsg}</p>}
          </section>

          {/* 调度设置 */}
          <section>
            <h3 className="text-sm font-semibold text-tx mb-3">调度设置</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-tx-muted block mb-1">抓取时间</label>
                <input
                  type="time"
                  value={settings.fetch_time}
                  onChange={(e) => updateField('fetch_time', e.target.value)}
                  className="w-full px-3 py-1.5 text-sm bg-raised border border-bd rounded-lg focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-tx-muted block mb-1">总结时间</label>
                <input
                  type="time"
                  value={settings.digest_time}
                  onChange={(e) => updateField('digest_time', e.target.value)}
                  className="w-full px-3 py-1.5 text-sm bg-raised border border-bd rounded-lg focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-tx-muted block mb-1">回溯时间 (小时)</label>
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={settings.lookback_hours}
                  onChange={(e) => updateField('lookback_hours', Number(e.target.value))}
                  className="w-full px-3 py-1.5 text-sm bg-raised border border-bd rounded-lg focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-tx-muted block mb-1">总结语言</label>
                <select
                  value={settings.digest_language}
                  onChange={(e) => updateField('digest_language', e.target.value)}
                  className="w-full px-3 py-1.5 text-sm bg-raised border border-bd rounded-lg focus:border-blue-500 outline-none"
                >
                  <option value="zh">中文</option>
                  <option value="en">English</option>
                  <option value="bilingual">双语</option>
                </select>
              </div>
            </div>
          </section>

          {/* 开关 */}
          <section>
            <h3 className="text-sm font-semibold text-tx mb-3">功能开关</h3>
            <div className="space-y-2">
              <label className="flex items-center gap-3 text-sm text-tx-sub cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.follow_builders_enabled}
                  onChange={(e) => updateField('follow_builders_enabled', e.target.checked)}
                  className="rounded"
                />
                启用 Follow Builders 内置源（免费·无需 API Key）
              </label>
              <label className="flex items-center gap-3 text-sm text-tx-sub cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.notification_enabled}
                  onChange={(e) => updateField('notification_enabled', e.target.checked)}
                  className="rounded"
                />
                新总结就绪时通知
              </label>
            </div>
          </section>

          {/* 自定义 Prompt */}
          <section>
            <h3 className="text-sm font-semibold text-tx mb-2">总结 Prompt</h3>
            <p className="text-xs text-tx-muted mb-2">
              自定义每日总结的 AI 提示词。留空使用默认模板。支持 {'{'} date {'}'} 和 {'{'} item_count {'}'} 变量。
            </p>
            <textarea
              value={settings.digest_prompt}
              onChange={(e) => updateField('digest_prompt', e.target.value)}
              placeholder="留空使用默认 Prompt..."
              rows={6}
              className="w-full px-3 py-2 text-sm bg-raised border border-bd rounded-lg focus:border-blue-500 outline-none resize-y"
            />
          </section>
        </div>

        {/* 底部操作 */}
        <div className="sticky bottom-0 bg-surface border-t border-bd p-4 flex justify-end gap-2 rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-tx-sub hover:bg-raised">
            关闭
          </button>
          {dirty && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {saving ? '保存中...' : '保存设置'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
