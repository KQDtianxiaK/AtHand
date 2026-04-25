import { useEffect, useState, useCallback, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  getNewsItems, getLatestDigest, getNewsDigests, triggerNewsFetch,
  triggerDigestGeneration, triggerTodayDigestGeneration,
  markNewsItemRead, markDigestRead,
  type NewsItemData, type NewsDigestData,
} from '../api/client'
import NewsSettingsDialog from '../components/NewsSettingsDialog'

// ---- 类型 badge 颜色 ----
const TYPE_BADGES: Record<string, { label: string; color: string }> = {
  tweet: { label: 'X/Twitter', color: 'bg-sky-500/20 text-sky-400' },
  blog_post: { label: '博客', color: 'bg-emerald-500/20 text-emerald-400' },
  podcast: { label: '播客', color: 'bg-purple-500/20 text-purple-400' },
  article: { label: '文章', color: 'bg-amber-500/20 text-amber-400' },
}

function TypeBadge({ type }: { type: string }) {
  const badge = TYPE_BADGES[type] || { label: type, color: 'bg-gray-500/20 text-gray-400' }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.color}`}>
      {badge.label}
    </span>
  )
}

function SourceBadge({ name }: { name: string }) {
  if (!name) return null
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-white/5 text-tx-muted border border-bd">
      {name}
    </span>
  )
}

// ---- 推文图片工具 ----
function extractImageUrls(text: string): string[] {
  const re = /https?:\/\/pbs\.twimg\.com\/media\/[^\s<>"')]+/gi
  const found = new Set<string>()
  ;(text.match(re) || []).forEach(u => found.add(u.replace(/[.,;:!?)]+$/, '')))
  return [...found]
}

function stripImageUrls(text: string): string {
  return text
    .replace(/https?:\/\/pbs\.twimg\.com\/media\/[^\s<>"')]+/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ---- 图片灯箱 ----
function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const dragging = useRef(false)
  const dragStart = useRef({ mx: 0, my: 0, px: 0, py: 0 })

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    setScale(s => Math.min(8, Math.max(0.5, s - e.deltaY * 0.002)))
  }
  const handleMouseDown = (e: React.MouseEvent) => {
    dragging.current = true
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y }
  }
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return
    setPos({ x: dragStart.current.px + e.clientX - dragStart.current.mx, y: dragStart.current.py + e.clientY - dragStart.current.my })
  }
  const handleMouseUp = () => { dragging.current = false }

  return (
    <div className="fixed inset-0 bg-black/90 z-[100] flex flex-col items-center justify-center" onClick={onClose}>
      <div className="absolute top-4 right-4 flex items-center gap-2 z-10" onClick={e => e.stopPropagation()}>
        <button onClick={() => setScale(s => Math.min(8, s * 1.3))} className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white text-lg flex items-center justify-center">+</button>
        <button onClick={() => setScale(s => Math.max(0.5, s / 1.3))} className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white text-lg flex items-center justify-center">−</button>
        <button onClick={() => { setScale(1); setPos({ x: 0, y: 0 }) }} className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white text-xs flex items-center justify-center">1:1</button>
        <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white text-xl flex items-center justify-center">×</button>
      </div>
      <div
        className="w-full h-full flex items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={e => e.stopPropagation()}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          style={{
            transform: `translate(${pos.x}px,${pos.y}px) scale(${scale})`,
            transition: dragging.current ? 'none' : 'transform 0.15s',
            maxWidth: '90vw',
            maxHeight: '90vh',
            objectFit: 'contain',
            userSelect: 'none',
          }}
        />
      </div>
    </div>
  )
}

// ---- 时间格式化 ----
function formatTime(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffH = Math.floor(diffMs / 3600000)
  if (diffH < 1) return `${Math.max(1, Math.floor(diffMs / 60000))} 分钟前`
  if (diffH < 24) return `${diffH} 小时前`
  if (diffH < 48) return '昨天'
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

// ---- 新闻卡片 ----
function NewsCard({ item, cols, onClick }: { item: NewsItemData; cols: 1 | 2 | 3; onClick: () => void }) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  const imageUrls = item.item_type === 'tweet' ? extractImageUrls(item.content) : []
  const rawContent = item.summary || item.content
  const cleanContent = (() => {
    let text = imageUrls.length > 0 ? stripImageUrls(rawContent) : rawContent
    // 非推文内容折叠多余空行，避免卡片里出现大段空白
    if (item.item_type !== 'tweet') {
      text = text.replace(/\n{3,}/g, '\n\n').trim()
    }
    return text
  })()
  const isTweet = item.item_type === 'tweet'
  const maxLen = cols === 1 ? 800 : (isTweet || item.content.length < 500 ? 500 : 300)

  let metrics: { likes?: number; retweets?: number; replies?: number } = {}
  try { metrics = JSON.parse(item.metadata_json || '{}') } catch {}

  return (
    <>
      <div
        className={`bg-surface rounded-xl p-4 hover:bg-raised transition-colors cursor-pointer border border-bd flex flex-col ${item.is_read ? 'opacity-70' : ''}`}
        onClick={onClick}
      >
        {/* 头部: badge + 时间 */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <TypeBadge type={item.item_type} />
            {item.source_name && <SourceBadge name={item.source_name} />}
          </div>
          <span className="text-xs text-tx-muted shrink-0 ml-2">{formatTime(item.published_at)}</span>
        </div>

        {/* 作者 */}
        {item.author && <p className="text-xs text-tx-muted mb-1.5">{item.author}</p>}

        {/* 标题 */}
        {item.title && item.item_type !== 'tweet' && (
          <h3 className="font-semibold text-tx mb-2 line-clamp-2">{item.title}</h3>
        )}

        {/* 内嵌图 (first image inline) */}
        {imageUrls.length > 0 && (
          <div
            className="mb-2 rounded-lg overflow-hidden"
            onClick={e => { e.stopPropagation(); setLightboxSrc(imageUrls[0]) }}
          >
            <img
              src={imageUrls[0]}
              alt=""
              loading="lazy"
              className="w-full object-cover rounded-lg hover:opacity-90 transition-opacity cursor-zoom-in"
              style={{ maxHeight: cols === 1 ? '320px' : '200px' }}
            />
          </div>
        )}

        {/* 正文 */}
        <p className={`text-sm text-tx-sub leading-relaxed flex-1 ${isTweet ? 'whitespace-pre-line' : 'whitespace-normal line-clamp-4'}`}>
          {cleanContent.length > maxLen ? cleanContent.slice(0, maxLen) + '...' : cleanContent}
        </p>

        {/* 推文指标 */}
        {item.item_type === 'tweet' && metrics.likes !== undefined && (
          <div className="flex items-center gap-4 mt-2 text-xs text-tx-muted">
            <span>❤️ {metrics.likes?.toLocaleString()}</span>
            <span>🔁 {metrics.retweets?.toLocaleString()}</span>
            {metrics.replies !== undefined && <span>💬 {metrics.replies?.toLocaleString()}</span>}
          </div>
        )}

        {/* 底部: 原文链接 */}
        {item.original_url && (
          <a
            href={item.original_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-3 text-xs text-blue-400 hover:text-blue-300"
            onClick={(e) => e.stopPropagation()}
          >
            查看原文 →
          </a>
        )}
      </div>

      {lightboxSrc && <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </>
  )
}

// ---- 每日总结 Tab ----
function DigestView({ digest, onGenerateDigest }: {
  digest: NewsDigestData | null
  onGenerateDigest: () => void
}) {
  if (!digest) {
    return (
      <div className="text-center py-16">
        <p className="text-tx-muted mb-4">暂无总结</p>
        <button
          onClick={onGenerateDigest}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors"
        >
          生成今日总结
        </button>
      </div>
    )
  }

  if (digest.status === 'generating') {
    return (
      <div className="text-center py-16">
        <div className="inline-block w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-tx-muted">正在生成总结...</p>
      </div>
    )
  }

  if (digest.status === 'failed') {
    return (
      <div className="text-center py-16">
        <p className="text-red-400 mb-4">总结生成失败</p>
        <p className="text-sm text-tx-muted mb-4">{digest.content}</p>
        <button
          onClick={onGenerateDigest}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors"
        >
          重新生成
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 总结头 */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-tx">{digest.title || `每日总结 — ${digest.date}`}</h3>
          <p className="text-sm text-tx-muted">
            包含 {digest.item_count} 条资讯
            {digest.generated_at && ` · 生成于 ${new Date(digest.generated_at).toLocaleTimeString('zh-CN')}`}
          </p>
        </div>
        <button
          onClick={onGenerateDigest}
          className="text-xs px-3 py-1.5 rounded-lg bg-raised hover:bg-surface text-tx-sub transition-colors"
        >
          重新生成
        </button>
      </div>
      {/* Markdown 内容 */}
      <div className="bg-surface rounded-xl p-6 text-sm leading-relaxed text-tx-sub prose-digest">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => <h1 className="text-lg font-bold text-tx mt-4 mb-2 first:mt-0">{children}</h1>,
            h2: ({ children }) => <h2 className="text-base font-semibold text-tx mt-4 mb-2 first:mt-0">{children}</h2>,
            h3: ({ children }) => <h3 className="text-sm font-semibold text-tx mt-3 mb-1">{children}</h3>,
            p: ({ children }) => <p className="mb-3 last:mb-0 text-tx-sub leading-relaxed">{children}</p>,
            ul: ({ children }) => <ul className="list-disc ml-4 space-y-1 mb-3 text-tx-sub">{children}</ul>,
            ol: ({ children }) => <ol className="list-decimal ml-4 space-y-1 mb-3 text-tx-sub">{children}</ol>,
            li: ({ children }) => <li className="text-tx-sub pl-1">{children}</li>,
            strong: ({ children }) => <strong className="font-semibold text-tx">{children}</strong>,
            blockquote: ({ children }) => <blockquote className="border-l-2 border-blue-500/40 pl-3 italic text-tx-muted my-3">{children}</blockquote>,
            code: ({ children }) => <code className="bg-raised px-1 py-0.5 rounded text-xs font-mono text-emerald-400">{children}</code>,
            a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">{children}</a>,
            hr: () => <hr className="border-bd my-4" />,
          }}
        >
          {digest.content.replace(/^[·•]\s*/gm, '- ')}
        </ReactMarkdown>
      </div>
    </div>
  )
}

// ---- 历史总结侧边 ----
function DigestHistory({ digests, selectedId, onSelect }: {
  digests: NewsDigestData[]
  selectedId: number | null
  onSelect: (d: NewsDigestData) => void
}) {
  if (!digests.length) return null
  return (
    <div className="space-y-1">
      <h4 className="text-xs text-tx-muted uppercase tracking-wider mb-2 px-1">历史总结</h4>
      {digests.map((d) => (
        <button
          key={d.id}
          onClick={() => onSelect(d)}
          className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
            selectedId === d.id ? 'bg-blue-600/20 text-blue-400' : 'text-tx-sub hover:bg-raised'
          }`}
        >
          <div className="flex items-center justify-between">
            <span>{d.date}</span>
            {!d.is_read && d.status === 'ready' && (
              <span className="w-2 h-2 rounded-full bg-blue-400" />
            )}
          </div>
          <p className="text-xs text-tx-muted truncate">{d.item_count} 条 · {d.status === 'ready' ? '已就绪' : d.status}</p>
        </button>
      ))}
    </div>
  )
}

// ---- 主页面 ----
export default function NewsPage() {
  const [tab, setTab] = useState<'cards' | 'today' | 'daily'>('cards')
  const [cols, setCols] = useState<1 | 2 | 3>(2)
  const [items, setItems] = useState<NewsItemData[]>([])
  const [loading, setLoading] = useState(false)
  const [filterType, setFilterType] = useState<string>('')
  const [filterDate, setFilterDate] = useState<string>('')
  const [settingsOpen, setSettingsOpen] = useState(false)

  // 模态图片灯箱 (用于详情弹窗中的图片)
  const [modalLightboxSrc, setModalLightboxSrc] = useState<string | null>(null)

  // 总结
  const [currentDigest, setCurrentDigest] = useState<NewsDigestData | null>(null)   // daily
  const [todayDigest, setTodayDigest] = useState<NewsDigestData | null>(null)        // today
  const [allDailyDigests, setAllDailyDigests] = useState<NewsDigestData[]>([])
  const [fetching, setFetching] = useState(false)

  // 详情弹窗
  const [selectedItem, setSelectedItem] = useState<NewsItemData | null>(null)

  const loadItems = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getNewsItems({
        item_type: filterType || undefined,
        date: filterDate || undefined,
        page_size: 100,
      })
      setItems(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [filterType, filterDate])

  const loadDigests = useCallback(async () => {
    try {
      const [latestDaily, latestToday, allDaily] = await Promise.all([
        getLatestDigest('daily'),
        getLatestDigest('today'),
        getNewsDigests(30, 'daily'),
      ])
      setCurrentDigest(latestDaily)
      setTodayDigest(latestToday)
      setAllDailyDigests(allDaily)
    } catch (e) {
      console.error(e)
    }
  }, [])

  useEffect(() => {
    loadItems()
  }, [loadItems])

  useEffect(() => {
    if (tab === 'today' || tab === 'daily') loadDigests()
  }, [tab, loadDigests])

  // 进入总结Tab时自动标记当前总结为已读
  useEffect(() => {
    if (tab !== 'daily') return
    if (!currentDigest || currentDigest.is_read || currentDigest.status !== 'ready') return
    markDigestRead(currentDigest.id)
      .then(() => {
        setCurrentDigest(prev => prev ? { ...prev, is_read: true } : prev)
        setAllDailyDigests(prev => prev.map(d => d.id === currentDigest.id ? { ...d, is_read: true } : d))
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, currentDigest?.id, currentDigest?.is_read])

  const handleFetch = async () => {
    setFetching(true)
    try {
      await triggerNewsFetch()
      // 等 3 秒后刷新列表
      setTimeout(() => {
        loadItems()
        setFetching(false)
      }, 3000)
    } catch {
      setFetching(false)
    }
  }

  const handleGenerateDigest = async () => {
    setCurrentDigest(prev => prev
      ? { ...prev, status: 'generating' as const }
      : { id: 0, date: new Date(Date.now() - 86400000).toISOString().slice(0, 10), digest_type: 'daily', title: '', content: '', status: 'generating' as const, item_count: 0, generated_at: null, is_read: false, created_at: new Date().toISOString() }
    )
    try {
      await triggerDigestGeneration()
      const poll = setInterval(async () => {
        try {
          const d = await getLatestDigest('daily')
          if (d) {
            setCurrentDigest(d)
            if (d.status === 'ready' || d.status === 'failed') {
              clearInterval(poll)
              loadDigests()
            }
          }
        } catch { clearInterval(poll) }
      }, 3000)
    } catch (e) {
      console.error(e)
      setCurrentDigest(prev => prev ? { ...prev, status: 'failed' as const, content: '触发生成失败，请重试' } : null)
    }
  }

  const handleGenerateTodayDigest = async () => {
    setTodayDigest(prev => prev
      ? { ...prev, status: 'generating' as const }
      : { id: 0, date: new Date().toISOString().slice(0, 10), digest_type: 'today', title: '', content: '', status: 'generating' as const, item_count: 0, generated_at: null, is_read: false, created_at: new Date().toISOString() }
    )
    try {
      await triggerTodayDigestGeneration()
      const poll = setInterval(async () => {
        try {
          const d = await getLatestDigest('today')
          if (d) {
            setTodayDigest(d)
            if (d.status === 'ready' || d.status === 'failed') {
              clearInterval(poll)
            }
          }
        } catch { clearInterval(poll) }
      }, 3000)
    } catch (e) {
      console.error(e)
      setTodayDigest(prev => prev ? { ...prev, status: 'failed' as const, content: '触发生成失败，请重试' } : null)
    }
  }

  const handleCardClick = async (item: NewsItemData) => {
    setSelectedItem(item)
    if (!item.is_read) {
      await markNewsItemRead(item.id)
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, is_read: true } : i)))
    }
  }

  return (
    <div className="p-4 md:p-6 h-full flex flex-col">
      {/* 头部 */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-2xl font-bold text-tx">📰 新闻</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleFetch}
            disabled={fetching}
            className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
          >
            {fetching ? '抓取中...' : '立即抓取'}
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="px-3 py-1.5 text-sm rounded-lg bg-raised text-tx-sub hover:bg-surface transition-colors"
          >
            ⚙️ 设置
          </button>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 bg-raised rounded-lg p-1 w-fit mb-4">
        <button
          onClick={() => setTab('cards')}
          className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
            tab === 'cards' ? 'bg-surface text-tx font-medium shadow-sm' : 'text-tx-sub hover:text-tx'
          }`}
        >
          卡片浏览
        </button>
        <button
          onClick={() => setTab('today')}
          className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
            tab === 'today' ? 'bg-surface text-tx font-medium shadow-sm' : 'text-tx-sub hover:text-tx'
          }`}
        >
          今日速览
        </button>
        <button
          onClick={() => setTab('daily')}
          className={`px-4 py-1.5 text-sm rounded-md transition-colors relative ${
            tab === 'daily' ? 'bg-surface text-tx font-medium shadow-sm' : 'text-tx-sub hover:text-tx'
          }`}
        >
          每日日报
          {currentDigest && !currentDigest.is_read && currentDigest.status === 'ready' && (
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500" />
          )}
        </button>
      </div>

      {/* 卡片浏览 Tab */}
      {tab === 'cards' && (
        <div className="flex-1 overflow-auto">
          {/* 筛选栏 */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="px-3 py-1.5 text-sm bg-raised border border-bd rounded-lg focus:border-blue-500 outline-none"
            />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="px-3 py-1.5 text-sm bg-raised border border-bd rounded-lg focus:border-blue-500 outline-none"
            >
              <option value="">全部类型</option>
              <option value="tweet">X/Twitter</option>
              <option value="blog_post">博客</option>
              <option value="podcast">播客</option>
              <option value="article">文章</option>
            </select>
            {/* 列数切换 */}
            <div className="flex items-center gap-1 ml-auto">
              {([1, 2, 3] as const).map(n => (
                <button
                  key={n}
                  onClick={() => setCols(n)}
                  title={`${n} 列`}
                  className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${
                    cols === n ? 'bg-blue-600 text-white' : 'bg-raised text-tx-muted hover:bg-surface border border-bd'
                  }`}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                    {n === 1 && <rect x="2" y="2" width="10" height="10" rx="1" />}
                    {n === 2 && (<><rect x="1" y="2" width="5" height="10" rx="1" /><rect x="8" y="2" width="5" height="10" rx="1" /></>)}
                    {n === 3 && (<><rect x="1" y="2" width="3" height="10" rx="1" /><rect x="5.5" y="2" width="3" height="10" rx="1" /><rect x="10" y="2" width="3" height="10" rx="1" /></>)}
                  </svg>
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="text-center py-16 text-tx-muted">加载中...</div>
          ) : items.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-tx-muted mb-4">暂无新闻</p>
              <p className="text-sm text-tx-muted">请先添加信息源或点击 "立即抓取"</p>
            </div>
          ) : (
            <div className={`grid gap-4 ${
              cols === 1 ? 'grid-cols-1' :
              cols === 2 ? 'grid-cols-1 md:grid-cols-2' :
              'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
            }`}>
              {items.map((item) => (
                <NewsCard key={item.id} item={item} cols={cols} onClick={() => handleCardClick(item)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 今日速览 Tab */}
      {tab === 'today' && (
        <div className="flex-1 overflow-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-tx">📅 今日速览</h3>
            <button
              onClick={handleGenerateTodayDigest}
              disabled={todayDigest?.status === 'generating'}
              className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
            >
              {todayDigest?.status === 'generating' ? '生成中...' : '抓取并生成今日速览'}
            </button>
          </div>
          {!todayDigest ? (
            <div className="bg-surface rounded-xl p-10 text-center text-tx-muted text-sm">
              点击右上角按钮，抓取今日最新消息并生成速览
            </div>
          ) : todayDigest.status === 'generating' ? (
            <div className="bg-surface rounded-xl p-10 text-center">
              <div className="inline-block w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mb-2" />
              <p className="text-tx-muted text-sm">正在抓取并生成今日速览...</p>
            </div>
          ) : (
            <>
              <p className="text-xs text-tx-muted mb-3">
                {todayDigest.item_count} 条资讯
                {todayDigest.generated_at && ` · 生成于 ${new Date(todayDigest.generated_at).toLocaleTimeString('zh-CN')}`}
              </p>
              <DigestView digest={todayDigest} onGenerateDigest={handleGenerateTodayDigest} />
            </>
          )}
        </div>
      )}

      {/* 每日日报 Tab */}
      {tab === 'daily' && (
        <div className="flex-1 overflow-auto flex gap-6">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-tx">📰 每日日报（自动生成）</h3>
              <button
                onClick={handleGenerateDigest}
                disabled={currentDigest?.status === 'generating'}
                className="text-xs px-3 py-1.5 rounded-lg bg-raised text-tx-sub hover:bg-surface disabled:opacity-50 transition-colors"
              >
                {currentDigest?.status === 'generating' ? '生成中...' : '重新生成昨日日报'}
              </button>
            </div>
            <DigestView digest={currentDigest} onGenerateDigest={handleGenerateDigest} />
          </div>
          {allDailyDigests.length > 1 && (
            <div className="w-48 shrink-0 overflow-auto">
              <DigestHistory
                digests={allDailyDigests}
                selectedId={currentDigest?.id ?? null}
                onSelect={async (d) => {
                  setCurrentDigest(d)
                  if (!d.is_read && d.status === 'ready') {
                    await markDigestRead(d.id)
                    setAllDailyDigests((prev) => prev.map((x) => (x.id === d.id ? { ...x, is_read: true } : x)))
                  }
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* 详情弹窗 */}
      {selectedItem && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelectedItem(null)}>
          <div
            className="bg-surface rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 flex-wrap">
                <TypeBadge type={selectedItem.item_type} />
                {selectedItem.source_name && <SourceBadge name={selectedItem.source_name} />}
                <span className="text-sm text-tx-muted">{selectedItem.author}</span>
              </div>
              <button onClick={() => setSelectedItem(null)} className="text-tx-muted hover:text-tx text-xl">×</button>
            </div>
            {selectedItem.title && selectedItem.item_type !== 'tweet' && (
              <h2 className="text-xl font-bold text-tx mb-3">{selectedItem.title}</h2>
            )}
            <p className="text-xs text-tx-muted mb-4">
              {selectedItem.published_at && new Date(selectedItem.published_at).toLocaleString('zh-CN')}
            </p>

            {/* 图片画廊 */}
            {extractImageUrls(selectedItem.content).map((imgUrl, idx) => (
              <div key={idx} className="mb-3 rounded-lg overflow-hidden">
                <img
                  src={imgUrl}
                  alt=""
                  loading="lazy"
                  className="w-full rounded-lg cursor-zoom-in hover:opacity-90 transition-opacity max-h-80 object-cover"
                  onClick={() => setModalLightboxSrc(imgUrl)}
                />
              </div>
            ))}

            {/* 摘要 */}
            {selectedItem.summary && (
              <div className="bg-raised rounded-lg p-4 mb-4">
                <h4 className="text-xs font-medium text-tx-muted mb-2 uppercase tracking-wider">AI 摘要</h4>
                <p className="text-sm text-tx-sub leading-relaxed whitespace-pre-line">{selectedItem.summary}</p>
              </div>
            )}

            {/* 原文 */}
            <div className="text-sm text-tx-sub leading-relaxed whitespace-pre-line">
              {(() => {
                const text = stripImageUrls(selectedItem.content)
                return text.length > 5000 ? text.slice(0, 5000) + '\n\n...(内容过长已截断)' : text
              })()}
            </div>

            {selectedItem.original_url && (
              <a
                href={selectedItem.original_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-4 text-sm text-blue-400 hover:text-blue-300"
              >
                查看原文 →
              </a>
            )}
          </div>
        </div>
      )}

      {/* 模态灯箱 (详情弹窗中的图片) */}
      {modalLightboxSrc && <ImageLightbox src={modalLightboxSrc} onClose={() => setModalLightboxSrc(null)} />}

      {/* 设置弹窗 */}
      {settingsOpen && <NewsSettingsDialog onClose={() => { setSettingsOpen(false); loadItems() }} />}
    </div>
  )
}
