import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  getLatestDigest,
  getNewsDigests,
  getNewsItems,
  markDigestRead,
  markNewsItemRead,
  triggerDigestGeneration,
  triggerNewsFetch,
  triggerTodayDigestGeneration,
  type NewsDigestData,
  type NewsItemData,
} from '../api/client'
import NewsSettingsDialog from '../components/NewsSettingsDialog'

const shellPanelClass = 'rounded-[1.75rem] border border-bd bg-surface/[0.88] shadow-ambient backdrop-blur-xl'
const sectionCardClass = 'rounded-[1.35rem] border border-bd bg-page/[0.52]'
const insetCardClass = 'rounded-[1.1rem] border border-bd bg-page/[0.4]'
const fieldClass = 'w-full rounded-[1.05rem] border border-bd-strong bg-surface-elevated/[0.9] px-3 py-2.5 text-sm text-tx shadow-inset outline-none transition placeholder:text-tx-faint focus:border-accent/40 focus:ring-2 focus:ring-accent/10'
const secondaryButtonClass = 'rounded-[1rem] border border-bd bg-page/[0.55] px-3 py-2 text-xs font-medium text-tx-muted transition hover:border-bd-strong hover:bg-surface-elevated/[0.92] hover:text-tx-sub disabled:opacity-50'
const primaryButtonClass = 'rounded-[1rem] bg-accent px-3 py-2 text-xs font-medium text-white transition hover:bg-accent-strong disabled:opacity-50'
const proseClass = 'prose prose-sm max-w-none prose-headings:text-tx prose-headings:tracking-[-0.03em] prose-p:text-tx prose-p:leading-7 prose-strong:text-tx-sub prose-em:text-tx-muted prose-code:text-accent prose-code:bg-page/[0.65] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-[0.55rem] prose-code:text-xs prose-code:before:content-none prose-code:after:content-none prose-pre:bg-surface-elevated/[0.92] prose-pre:border prose-pre:border-bd prose-pre:rounded-[1rem] prose-blockquote:border-accent prose-blockquote:text-tx-muted prose-a:text-accent prose-a:no-underline hover:prose-a:underline prose-ul:text-tx prose-ol:text-tx prose-li:text-tx prose-hr:border-bd prose-table:text-tx prose-th:text-tx prose-td:text-tx'

const TYPE_BADGES: Record<string, { label: string; className: string }> = {
  tweet: { label: 'X/Twitter', className: 'border-sky-500/20 bg-sky-500/10 text-sky-600' },
  blog_post: { label: '博客', className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600' },
  podcast: { label: '播客', className: 'border-amber-500/20 bg-amber-500/10 text-amber-600' },
  article: { label: '文章', className: 'border-accent/20 bg-accent-soft/[0.78] text-accent' },
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}

function formatTime(iso: string | null) {
  if (!iso) return ''
  const value = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - value.getTime()
  const diffHours = Math.floor(diffMs / 3600000)
  if (diffHours < 1) {
    return `${Math.max(1, Math.floor(diffMs / 60000))} 分钟前`
  }
  if (diffHours < 24) {
    return `${diffHours} 小时前`
  }
  if (diffHours < 48) {
    return '昨天'
  }
  return value.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function formatDigestStamp(iso: string | null) {
  if (!iso) return '尚未生成'
  return new Date(iso).toLocaleString('zh-CN')
}

function extractImageUrls(text: string) {
  const re = /https?:\/\/pbs\.twimg\.com\/media\/[^\s<>"')]+/gi
  const found = new Set<string>()
  ;(text.match(re) || []).forEach((url) => found.add(url.replace(/[.,;:!?)]+$/, '')))
  return [...found]
}

function stripImageUrls(text: string) {
  return text
    .replace(/https?:\/\/pbs\.twimg\.com\/media\/[^\s<>"')]+/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function TypeBadge({ type }: { type: string }) {
  const badge = TYPE_BADGES[type] || { label: type, className: 'border-bd bg-page/[0.7] text-tx-muted' }
  return <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${badge.className}`}>{badge.label}</span>
}

function SourceBadge({ name }: { name: string }) {
  if (!name) return null
  return <span className="rounded-full border border-bd bg-page/[0.7] px-2.5 py-1 text-[11px] font-medium text-tx-muted">{name}</span>
}

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className={`${insetCardClass} px-4 py-3`}>
      <div className="text-[11px] text-tx-faint">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-tx-sub">{value}</div>
      <div className="mt-1 text-xs leading-5 text-tx-muted">{detail}</div>
    </div>
  )
}

function InlineNotice({
  message,
  actionLabel,
  onAction,
}: {
  message: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-[1rem] border border-danger/20 bg-danger/10 px-3 py-2.5 text-xs leading-6 text-danger">
      <span className="min-w-0 flex-1">{message}</span>
      {actionLabel && onAction ? (
        <button onClick={onAction} className="shrink-0 rounded-full border border-danger/25 px-2.5 py-1 font-medium transition hover:bg-danger/10">
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const label = status === 'ready' ? '已就绪' : status === 'generating' ? '生成中' : status === 'failed' ? '失败' : '未准备'
  const className =
    status === 'ready'
      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600'
      : status === 'generating'
        ? 'border-amber-500/20 bg-amber-500/10 text-amber-600'
        : status === 'failed'
          ? 'border-danger/20 bg-danger/10 text-danger'
          : 'border-bd bg-page/[0.7] text-tx-muted'

  return <span className={`rounded-full border px-3 py-1 text-[11px] font-medium ${className}`}>{label}</span>
}

function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const dragging = useRef(false)
  const dragStart = useRef({ mx: 0, my: 0, px: 0, py: 0 })

  const handleWheel = (event: React.WheelEvent) => {
    event.preventDefault()
    setScale((value) => Math.min(8, Math.max(0.5, value - event.deltaY * 0.002)))
  }

  const handleMouseDown = (event: React.MouseEvent) => {
    dragging.current = true
    dragStart.current = { mx: event.clientX, my: event.clientY, px: position.x, py: position.y }
  }

  const handleMouseMove = (event: React.MouseEvent) => {
    if (!dragging.current) return
    setPosition({
      x: dragStart.current.px + event.clientX - dragStart.current.mx,
      y: dragStart.current.py + event.clientY - dragStart.current.my,
    })
  }

  const handleMouseUp = () => {
    dragging.current = false
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/90" onClick={onClose}>
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
        <button onClick={() => setScale((value) => Math.min(8, value * 1.25))} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-lg text-white transition hover:bg-white/30">+</button>
        <button onClick={() => setScale((value) => Math.max(0.5, value / 1.25))} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-lg text-white transition hover:bg-white/30">−</button>
        <button onClick={() => { setScale(1); setPosition({ x: 0, y: 0 }) }} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-xs font-medium text-white transition hover:bg-white/30">1:1</button>
        <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-xl text-white transition hover:bg-white/30">×</button>
      </div>
      <div
        className="flex h-full w-full cursor-grab items-center justify-center overflow-hidden active:cursor-grabbing"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={(event) => event.stopPropagation()}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
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

function NewsCard({
  item,
  cols,
  selected,
  onClick,
}: {
  item: NewsItemData
  cols: 1 | 2 | 3
  selected: boolean
  onClick: () => void
}) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  const imageUrls = item.item_type === 'tweet' ? extractImageUrls(item.content) : []
  const rawContent = item.summary || item.content
  const cleanContent = (() => {
    let text = imageUrls.length > 0 ? stripImageUrls(rawContent) : rawContent
    if (item.item_type !== 'tweet') {
      text = text.replace(/\n{3,}/g, '\n\n').trim()
    }
    return text
  })()
  const maxLen = cols === 1 ? 820 : cols === 2 ? 420 : 260

  let metrics: { likes?: number; retweets?: number; replies?: number } = {}
  try {
    metrics = JSON.parse(item.metadata_json || '{}')
  } catch {
    metrics = {}
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className={`w-full rounded-[1.25rem] border p-4 text-left transition-all ${
          selected
            ? 'border-accent/20 bg-accent-soft/[0.82] shadow-float ring-1 ring-accent/10'
            : item.is_read
              ? 'border-bd bg-surface-elevated/[0.88] hover:border-bd-strong hover:bg-surface-elevated/[0.96]'
              : 'border-accent/15 bg-accent-soft/[0.48] hover:border-accent/20 hover:bg-accent-soft/[0.58]'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <TypeBadge type={item.item_type} />
            {item.source_name ? <SourceBadge name={item.source_name} /> : null}
            {!item.is_read ? <span className="rounded-full bg-accent px-2 py-1 text-[11px] font-medium text-white">未读</span> : null}
          </div>
          <span className="shrink-0 text-xs text-tx-faint">{formatTime(item.published_at)}</span>
        </div>

        {item.author ? <p className="mt-3 text-xs text-tx-muted">{item.author}</p> : null}
        {item.title && item.item_type !== 'tweet' ? <h3 className="mt-2 text-base font-semibold leading-6 text-tx">{item.title}</h3> : null}

        {imageUrls.length > 0 ? (
          <div className="mt-3 overflow-hidden rounded-[1rem] border border-bd bg-page/[0.45]" onClick={(event) => { event.stopPropagation(); setLightboxSrc(imageUrls[0]) }}>
            <img
              src={imageUrls[0]}
              alt=""
              loading="lazy"
              className="w-full cursor-zoom-in object-cover transition hover:opacity-90"
              style={{ maxHeight: cols === 1 ? '320px' : '210px' }}
            />
          </div>
        ) : null}

        <p className={`mt-3 text-sm leading-7 text-tx-sub ${item.item_type === 'tweet' ? 'whitespace-pre-line' : 'line-clamp-5 whitespace-normal'}`}>
          {cleanContent.length > maxLen ? `${cleanContent.slice(0, maxLen)}...` : cleanContent}
        </p>

        {item.item_type === 'tweet' && metrics.likes !== undefined ? (
          <div className="mt-3 flex items-center gap-4 text-xs text-tx-muted">
            <span>❤️ {metrics.likes?.toLocaleString()}</span>
            <span>🔁 {metrics.retweets?.toLocaleString()}</span>
            {metrics.replies !== undefined ? <span>💬 {metrics.replies?.toLocaleString()}</span> : null}
          </div>
        ) : null}

        {item.original_url ? (
          <a
            href={item.original_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex text-xs font-medium text-accent transition hover:text-accent-strong"
            onClick={(event) => event.stopPropagation()}
          >
            查看原文
          </a>
        ) : null}
      </button>

      {lightboxSrc ? <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} /> : null}
    </>
  )
}

function DigestView({
  digest,
  title,
  description,
  emptyLabel,
  emptyDescription,
  actionLabel,
  onGenerate,
}: {
  digest: NewsDigestData | null
  title: string
  description: string
  emptyLabel: string
  emptyDescription: string
  actionLabel: string
  onGenerate: () => void
}) {
  if (!digest) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <div className={`${sectionCardClass} w-full max-w-2xl px-8 py-12 text-center`}>
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Digest Workspace</div>
          <div className="mt-5 text-5xl">🧭</div>
          <h3 className="mt-5 text-xl font-semibold tracking-[-0.03em] text-tx">{emptyLabel}</h3>
          <p className="mt-3 text-sm leading-7 text-tx-faint">{emptyDescription}</p>
          <button onClick={onGenerate} className={`${primaryButtonClass} mt-6 px-5 py-3 text-sm`}>
            {actionLabel}
          </button>
        </div>
      </div>
    )
  }

  if (digest.status === 'generating') {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <div className={`${sectionCardClass} w-full max-w-2xl px-8 py-12 text-center`}>
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <h3 className="mt-5 text-xl font-semibold tracking-[-0.03em] text-tx">{title}</h3>
          <p className="mt-3 text-sm leading-7 text-tx-faint">正在生成摘要内容，稍后会自动刷新为最新版本。</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-0 space-y-4">
      <div className={`${sectionCardClass} p-5`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Digest Workspace</div>
            <h3 className="mt-2 text-[1.55rem] font-semibold tracking-[-0.04em] text-tx">{digest.title || title}</h3>
            <p className="mt-2 text-sm leading-6 text-tx-muted">{description}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusPill status={digest.status} />
            <button onClick={onGenerate} className={secondaryButtonClass}>{actionLabel}</button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-tx-muted">
          <span className="rounded-full border border-bd bg-page/[0.7] px-3 py-1">{digest.date}</span>
          <span className="rounded-full border border-bd bg-page/[0.7] px-3 py-1">{digest.item_count} 条资讯</span>
          <span className="rounded-full border border-bd bg-page/[0.7] px-3 py-1">{formatDigestStamp(digest.generated_at)}</span>
        </div>
        {digest.status === 'failed' ? <div className="mt-4"><InlineNotice message={digest.content || '摘要生成失败，请稍后重试。'} actionLabel={actionLabel} onAction={onGenerate} /></div> : null}
      </div>

      {digest.status === 'ready' ? (
        <div className={`${sectionCardClass} min-h-[420px] p-6 lg:p-8`}>
          <div className={proseClass}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{digest.content.replace(/^[·•]\s*/gm, '- ')}</ReactMarkdown>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function DigestHistory({
  digests,
  selectedId,
  onSelect,
}: {
  digests: NewsDigestData[]
  selectedId: number | null
  onSelect: (digest: NewsDigestData) => void
}) {
  if (!digests.length) return null

  return (
    <div className="space-y-2">
      {digests.map((digest) => {
        const selected = digest.id === selectedId
        return (
          <button
            key={digest.id}
            onClick={() => onSelect(digest)}
            className={`w-full rounded-[1rem] border px-3 py-3 text-left transition ${
              selected
                ? 'border-accent/20 bg-accent-soft/[0.82] shadow-float ring-1 ring-accent/10'
                : 'border-bd bg-surface-elevated/[0.88] hover:border-bd-strong hover:bg-surface-elevated/[0.96]'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-tx-sub">{digest.date}</span>
              <StatusPill status={digest.status} />
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-tx-muted">
              <span>{digest.item_count} 条</span>
              {!digest.is_read && digest.status === 'ready' ? <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-white">未读</span> : null}
            </div>
          </button>
        )
      })}
    </div>
  )
}

function NewsDetailPanel({
  item,
  onOpenImage,
  onOpenFallback,
}: {
  item: NewsItemData | null
  onOpenImage: (src: string) => void
  onOpenFallback: () => void
}) {
  if (!item) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className={`${sectionCardClass} w-full max-w-xl px-8 py-12 text-center`}>
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Reading Pane</div>
          <div className="mt-5 text-5xl">🗞️</div>
          <div className="mt-5 text-xl font-medium text-tx-sub">选择一条资讯查看详情</div>
          <p className="mt-3 text-sm leading-7 text-tx-faint">右侧会显示摘要、原文片段、时间和图片。你也可以直接从这里跳到原始链接。</p>
          <button onClick={onOpenFallback} className={`${primaryButtonClass} mt-6 px-5 py-3 text-sm`}>
            打开首条资讯
          </button>
        </div>
      </div>
    )
  }

  const imageUrls = extractImageUrls(item.content)
  const plainContent = stripImageUrls(item.content)
  const previewContent = plainContent.length > 5000 ? `${plainContent.slice(0, 5000)}\n\n...(内容过长已截断)` : plainContent

  return (
    <>
      <div className="border-b border-bd/70 px-5 py-5">
        <div className="flex flex-col gap-4">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Reading Pane</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <TypeBadge type={item.item_type} />
              {item.source_name ? <SourceBadge name={item.source_name} /> : null}
            </div>
            {item.title && item.item_type !== 'tweet' ? <h3 className="mt-3 text-[1.45rem] font-semibold tracking-[-0.04em] text-tx">{item.title}</h3> : null}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-tx-muted">
              {item.author ? <span className="rounded-full border border-bd bg-page/[0.7] px-3 py-1">{item.author}</span> : null}
              {item.published_at ? <span className="rounded-full border border-bd bg-page/[0.7] px-3 py-1">{new Date(item.published_at).toLocaleString('zh-CN')}</span> : null}
              {!item.is_read ? <span className="rounded-full bg-accent px-3 py-1 font-medium text-white">未读</span> : null}
            </div>
          </div>

          {item.original_url ? (
            <a href={item.original_url} target="_blank" rel="noopener noreferrer" className="inline-flex text-sm font-medium text-accent transition hover:text-accent-strong">
              查看原文
            </a>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-page/[0.28] p-5">
        <div className="space-y-4">
          {item.summary ? (
            <div className={`${sectionCardClass} p-5`}>
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">AI Summary</div>
              <p className="mt-3 whitespace-pre-line text-sm leading-7 text-tx-sub">{item.summary}</p>
            </div>
          ) : null}

          {imageUrls.length > 0 ? (
            <div className={`${sectionCardClass} p-4`}>
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Media</div>
              <div className="mt-3 grid gap-3">
                {imageUrls.map((imageUrl, index) => (
                  <button key={`${imageUrl}-${index}`} type="button" className="overflow-hidden rounded-[1rem] border border-bd bg-page/[0.45] text-left" onClick={() => onOpenImage(imageUrl)}>
                    <img src={imageUrl} alt="" loading="lazy" className="max-h-80 w-full object-cover transition hover:opacity-90" />
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className={`${sectionCardClass} p-5`}>
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Source Content</div>
            <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-7 text-tx-sub">{previewContent}</pre>
          </div>
        </div>
      </div>
    </>
  )
}

export default function NewsPage() {
  const [tab, setTab] = useState<'cards' | 'today' | 'daily'>('cards')
  const [cols, setCols] = useState<1 | 2 | 3>(2)
  const [items, setItems] = useState<NewsItemData[]>([])
  const [loading, setLoading] = useState(false)
  const [filterType, setFilterType] = useState('')
  const [filterDate, setFilterDate] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [modalLightboxSrc, setModalLightboxSrc] = useState<string | null>(null)
  const [currentDigest, setCurrentDigest] = useState<NewsDigestData | null>(null)
  const [todayDigest, setTodayDigest] = useState<NewsDigestData | null>(null)
  const [allDailyDigests, setAllDailyDigests] = useState<NewsDigestData[]>([])
  const [fetching, setFetching] = useState(false)
  const [selectedItem, setSelectedItem] = useState<NewsItemData | null>(null)
  const [itemsError, setItemsError] = useState<string | null>(null)
  const [digestError, setDigestError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const dailyPollRef = useRef<number | null>(null)
  const todayPollRef = useRef<number | null>(null)

  const clearDailyPoll = () => {
    if (dailyPollRef.current !== null) {
      window.clearInterval(dailyPollRef.current)
      dailyPollRef.current = null
    }
  }

  const clearTodayPoll = () => {
    if (todayPollRef.current !== null) {
      window.clearInterval(todayPollRef.current)
      todayPollRef.current = null
    }
  }

  const loadItems = useCallback(async () => {
    setLoading(true)
    setItemsError(null)
    try {
      const data = await getNewsItems({
        item_type: filterType || undefined,
        date: filterDate || undefined,
        page_size: 100,
      })
      setItems(data)
      setSelectedItem((previous) => {
        if (!previous) return previous
        return data.find((item) => item.id === previous.id) || null
      })
    } catch (error) {
      setItemsError(getErrorMessage(error, '资讯流暂时无法刷新。'))
    } finally {
      setLoading(false)
    }
  }, [filterDate, filterType])

  const loadDigests = useCallback(async () => {
    setDigestError(null)
    try {
      const [latestDaily, latestToday, dailyList] = await Promise.all([
        getLatestDigest('daily'),
        getLatestDigest('today'),
        getNewsDigests(30, 'daily'),
      ])
      setCurrentDigest(latestDaily)
      setTodayDigest(latestToday)
      setAllDailyDigests(dailyList)
    } catch (error) {
      setDigestError(getErrorMessage(error, '摘要工作区暂时无法刷新。'))
    }
  }, [])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  useEffect(() => {
    if (tab === 'today' || tab === 'daily') {
      void loadDigests()
    }
  }, [loadDigests, tab])

  useEffect(() => {
    return () => {
      clearDailyPoll()
      clearTodayPoll()
    }
  }, [])

  useEffect(() => {
    if (tab !== 'daily' || !currentDigest || currentDigest.is_read || currentDigest.status !== 'ready') return

    markDigestRead(currentDigest.id)
      .then(() => {
        setCurrentDigest((previous) => (previous ? { ...previous, is_read: true } : previous))
        setAllDailyDigests((previous) => previous.map((digest) => (digest.id === currentDigest.id ? { ...digest, is_read: true } : digest)))
      })
      .catch(() => {})
  }, [currentDigest, tab])

  const handleFetch = async () => {
    setActionError(null)
    setFetching(true)
    try {
      await triggerNewsFetch()
      window.setTimeout(() => {
        void loadItems()
        setFetching(false)
      }, 3000)
    } catch (error) {
      setActionError(getErrorMessage(error, '立即抓取失败。'))
      setFetching(false)
    }
  }

  const handleGenerateDigest = async () => {
    setActionError(null)
    clearDailyPoll()
    setCurrentDigest((previous) =>
      previous
        ? { ...previous, status: 'generating' }
        : {
            id: 0,
            date: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
            digest_type: 'daily',
            title: '',
            content: '',
            status: 'generating',
            item_count: 0,
            is_read: false,
            generated_at: null,
            created_at: new Date().toISOString(),
          },
    )

    try {
      await triggerDigestGeneration()
      dailyPollRef.current = window.setInterval(async () => {
        try {
          const digest = await getLatestDigest('daily')
          if (digest) {
            setCurrentDigest(digest)
            if (digest.status === 'ready' || digest.status === 'failed') {
              clearDailyPoll()
              await loadDigests()
            }
          }
        } catch {
          clearDailyPoll()
        }
      }, 3000)
    } catch (error) {
      setActionError(getErrorMessage(error, '触发每日日报生成失败。'))
      setCurrentDigest((previous) => (previous ? { ...previous, status: 'failed', content: '触发生成失败，请重试。' } : previous))
    }
  }

  const handleGenerateTodayDigest = async () => {
    setActionError(null)
    clearTodayPoll()
    setTodayDigest((previous) =>
      previous
        ? { ...previous, status: 'generating' }
        : {
            id: 0,
            date: new Date().toISOString().slice(0, 10),
            digest_type: 'today',
            title: '',
            content: '',
            status: 'generating',
            item_count: 0,
            is_read: false,
            generated_at: null,
            created_at: new Date().toISOString(),
          },
    )

    try {
      await triggerTodayDigestGeneration()
      todayPollRef.current = window.setInterval(async () => {
        try {
          const digest = await getLatestDigest('today')
          if (digest) {
            setTodayDigest(digest)
            if (digest.status === 'ready' || digest.status === 'failed') {
              clearTodayPoll()
            }
          }
        } catch {
          clearTodayPoll()
        }
      }, 3000)
    } catch (error) {
      setActionError(getErrorMessage(error, '触发今日速览生成失败。'))
      setTodayDigest((previous) => (previous ? { ...previous, status: 'failed', content: '触发生成失败，请重试。' } : previous))
    }
  }

  const handleCardClick = async (item: NewsItemData) => {
    setActionError(null)
    setSelectedItem(item)
    if (item.is_read) return
    try {
      await markNewsItemRead(item.id)
      setItems((previous) => previous.map((entry) => (entry.id === item.id ? { ...entry, is_read: true } : entry)))
      setSelectedItem((previous) => (previous && previous.id === item.id ? { ...previous, is_read: true } : previous))
    } catch (error) {
      setActionError(getErrorMessage(error, '标记资讯已读失败。'))
    }
  }

  const handleSelectDigest = async (digest: NewsDigestData) => {
    setActionError(null)
    setCurrentDigest(digest)
    if (digest.is_read || digest.status !== 'ready') return
    try {
      await markDigestRead(digest.id)
      setCurrentDigest((previous) => (previous ? { ...previous, is_read: true } : previous))
      setAllDailyDigests((previous) => previous.map((entry) => (entry.id === digest.id ? { ...entry, is_read: true } : entry)))
    } catch (error) {
      setActionError(getErrorMessage(error, '更新日报已读状态失败。'))
    }
  }

  const unreadCount = items.filter((item) => !item.is_read).length
  const sourceCount = new Set(items.map((item) => item.source_name).filter(Boolean)).size
  const activeDigest = tab === 'today' ? todayDigest : currentDigest
  const firstUnreadItem = items.find((item) => !item.is_read) || items[0] || null

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6 xl:grid xl:grid-cols-[310px_minmax(0,1.15fr)_minmax(320px,0.9fr)]" onClick={() => setActionError(null)}>
      {actionError ? (
        <div className="xl:col-span-3" onClick={(event) => event.stopPropagation()}>
          <InlineNotice message={actionError} actionLabel="关闭" onAction={() => setActionError(null)} />
        </div>
      ) : null}

      <section className={`flex min-h-[360px] flex-col overflow-hidden ${shellPanelClass}`}>
        <div className="border-b border-bd/70 px-5 py-5">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">News Desk</div>
          <h2 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-tx">新闻工作区</h2>
          <p className="mt-2 text-sm leading-6 text-tx-muted">把资讯抓取、每日摘要和阅读动线收进同一条信息流主线上。</p>
        </div>

        <div className="space-y-4 p-4">
          <div className={`${sectionCardClass} p-4`}>
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Controls</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={() => void handleFetch()} disabled={fetching} className={`${primaryButtonClass} text-sm`}>
                {fetching ? '抓取中...' : '立即抓取'}
              </button>
              <button onClick={() => setSettingsOpen(true)} className={`${secondaryButtonClass} text-sm`}>
                设置
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <StatCard label="资讯总数" value={`${items.length}`} detail="当前筛选条件下的返回结果。" />
            <StatCard label="未读资讯" value={`${unreadCount}`} detail="点击卡片后会自动进入已读。" />
            <StatCard label="来源数量" value={`${sourceCount}`} detail="帮助判断信息流覆盖面。" />
            <StatCard
              label="摘要状态"
              value={activeDigest?.status === 'ready' ? '就绪' : activeDigest?.status === 'generating' ? '生成中' : activeDigest?.status === 'failed' ? '失败' : '空'}
              detail={tab === 'today' ? '当前查看的是今日速览。' : '当前查看的是每日日报。'}
            />
          </div>

          <div className={`${sectionCardClass} p-3`}>
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Modes</div>
            <div className="mt-3 grid gap-2">
              {[
                { id: 'cards', label: '卡片浏览', detail: '快速扫读资讯流' },
                { id: 'today', label: '今日速览', detail: '聚焦当天更新' },
                { id: 'daily', label: '每日日报', detail: '查看沉淀摘要' },
              ].map((entry) => {
                const active = tab === entry.id
                return (
                  <button
                    key={entry.id}
                    onClick={() => setTab(entry.id as 'cards' | 'today' | 'daily')}
                    className={`rounded-[1rem] border px-3 py-3 text-left transition ${
                      active
                        ? 'border-accent/20 bg-accent-soft/[0.82] shadow-float ring-1 ring-accent/10'
                        : 'border-bd bg-surface-elevated/[0.88] hover:border-bd-strong hover:bg-surface-elevated/[0.96]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-tx-sub">{entry.label}</div>
                        <div className="mt-1 text-xs text-tx-muted">{entry.detail}</div>
                      </div>
                      {entry.id === 'daily' && currentDigest && !currentDigest.is_read && currentDigest.status === 'ready' ? <span className="rounded-full bg-accent px-2 py-1 text-[10px] font-medium text-white">新</span> : null}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className={`${sectionCardClass} p-4`}>
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Filters</div>
            <div className="mt-3 space-y-3">
              <input type="date" value={filterDate} onChange={(event) => setFilterDate(event.target.value)} className={fieldClass} />
              <select value={filterType} onChange={(event) => setFilterType(event.target.value)} className={fieldClass}>
                <option value="">全部类型</option>
                <option value="tweet">X/Twitter</option>
                <option value="blog_post">博客</option>
                <option value="podcast">播客</option>
                <option value="article">文章</option>
              </select>
              {tab === 'cards' ? (
                <div className="grid grid-cols-3 gap-2">
                  {([1, 2, 3] as const).map((value) => (
                    <button
                      key={value}
                      onClick={() => setCols(value)}
                      className={cols === value ? primaryButtonClass : secondaryButtonClass}
                    >
                      {value} 列
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs leading-6 text-tx-muted">摘要模式会继续沿用这里的资讯筛选作为阅读上下文，但主要内容来自摘要任务。</p>
              )}
            </div>
          </div>

          {tab === 'daily' && allDailyDigests.length > 1 ? (
            <div className={`${sectionCardClass} p-3`}>
              <div className="px-1 pb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Archive</div>
              <DigestHistory digests={allDailyDigests} selectedId={currentDigest?.id ?? null} onSelect={(digest) => void handleSelectDigest(digest)} />
            </div>
          ) : null}
        </div>
      </section>

      <section className={`flex min-h-[420px] min-w-0 flex-col overflow-hidden ${shellPanelClass}`}>
        <div className="border-b border-bd/70 px-5 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Workspace</div>
              <h2 className="mt-2 text-[1.55rem] font-semibold tracking-[-0.04em] text-tx">
                {tab === 'cards' ? '资讯流' : tab === 'today' ? '今日速览' : '每日日报'}
              </h2>
              <p className="mt-2 text-sm leading-6 text-tx-muted">
                {tab === 'cards'
                  ? '在中间浏览资讯卡片，右侧阅读细节。'
                  : tab === 'today'
                    ? '围绕今天的新资讯生成即时摘要。'
                    : '聚合昨天的重要信息，形成稳定的日报视图。'}
              </p>
            </div>

            {tab === 'today' ? (
              <button onClick={() => void handleGenerateTodayDigest()} disabled={todayDigest?.status === 'generating'} className={primaryButtonClass}>
                {todayDigest?.status === 'generating' ? '生成中...' : '生成今日速览'}
              </button>
            ) : tab === 'daily' ? (
              <button onClick={() => void handleGenerateDigest()} disabled={currentDigest?.status === 'generating'} className={secondaryButtonClass}>
                {currentDigest?.status === 'generating' ? '生成中...' : '重新生成日报'}
              </button>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 pb-4 pt-3">
          {tab === 'cards' ? (
            <div className="space-y-4">
              {itemsError ? <InlineNotice message={`资讯流刷新失败：${itemsError}`} actionLabel="重试" onAction={() => void loadItems()} /> : null}
              {loading ? (
                <div className="rounded-[1.2rem] border border-bd bg-page/[0.55] px-4 py-8 text-center text-sm text-tx-muted">加载中...</div>
              ) : items.length === 0 ? (
                <div className="rounded-[1.2rem] border border-dashed border-bd px-4 py-10 text-center text-sm leading-6 text-tx-faint">
                  当前筛选下还没有资讯结果。可以先抓取一次，或者放宽日期与类型过滤。
                </div>
              ) : (
                <div
                  className={`grid gap-4 ${
                    cols === 1
                      ? 'grid-cols-1'
                      : cols === 2
                        ? 'grid-cols-1 2xl:grid-cols-2'
                        : 'grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3'
                  }`}
                >
                  {items.map((item) => (
                    <NewsCard
                      key={item.id}
                      item={item}
                      cols={cols}
                      selected={selectedItem?.id === item.id}
                      onClick={() => void handleCardClick(item)}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {digestError ? <InlineNotice message={`摘要刷新失败：${digestError}`} actionLabel="重试" onAction={() => void loadDigests()} /> : null}
              <DigestView
                digest={tab === 'today' ? todayDigest : currentDigest}
                title={tab === 'today' ? '今日速览' : '每日日报'}
                description={tab === 'today' ? '把当天抓到的新资讯收束成一段即时阅读摘要。' : '把前一天的重要信号压缩成日报，方便集中阅读。'}
                emptyLabel={tab === 'today' ? '还没有今日速览' : '还没有每日日报'}
                emptyDescription={tab === 'today' ? '点击下方按钮抓取最新消息并生成今天的速览。' : '点击下方按钮生成昨日日报，形成稳定的沉淀视图。'}
                actionLabel={tab === 'today' ? '生成今日速览' : '生成每日日报'}
                onGenerate={tab === 'today' ? () => void handleGenerateTodayDigest() : () => void handleGenerateDigest()}
              />
            </div>
          )}
        </div>
      </section>

      <section className={`flex min-h-[420px] min-w-0 flex-col overflow-hidden ${shellPanelClass}`}>
        {tab === 'cards' ? (
          <NewsDetailPanel
            item={selectedItem}
            onOpenImage={(src) => setModalLightboxSrc(src)}
            onOpenFallback={() => {
              if (firstUnreadItem) {
                void handleCardClick(firstUnreadItem)
              }
            }}
          />
        ) : (
          <>
            <div className="border-b border-bd/70 px-5 py-5">
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Side Notes</div>
              <h3 className="mt-2 text-[1.45rem] font-semibold tracking-[-0.04em] text-tx">{tab === 'today' ? '摘要侧栏' : '日报侧栏'}</h3>
              <p className="mt-2 text-sm leading-6 text-tx-muted">这里保留生成状态、补充说明以及历史摘要切换，不占用主阅读区。</p>
            </div>

            <div className="min-h-0 flex-1 overflow-auto bg-page/[0.28] p-5">
              <div className="space-y-4">
                <div className={`${sectionCardClass} p-5`}>
                  <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Digest Status</div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <StatusPill status={activeDigest?.status || 'idle'} />
                    {activeDigest?.generated_at ? <span className="rounded-full border border-bd bg-page/[0.7] px-3 py-1 text-xs text-tx-muted">{formatDigestStamp(activeDigest.generated_at)}</span> : null}
                  </div>
                  <p className="mt-3 text-sm leading-7 text-tx-muted">
                    {tab === 'today'
                      ? '今日速览适合在抓取后快速扫读最新信息，然后再回到卡片流查看原文。'
                      : '每日日报更适合做完整复盘，切换左侧归档可以比较不同日期的沉淀内容。'}
                  </p>
                </div>

                <div className={`${sectionCardClass} p-5`}>
                  <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Quick Actions</div>
                  <div className="mt-3 grid gap-2">
                    <button onClick={tab === 'today' ? () => void handleGenerateTodayDigest() : () => void handleGenerateDigest()} className={primaryButtonClass}>
                      {tab === 'today' ? '重新生成今日速览' : '重新生成每日日报'}
                    </button>
                    <button onClick={() => setTab('cards')} className={secondaryButtonClass}>返回卡片浏览</button>
                    <button onClick={() => setSettingsOpen(true)} className={secondaryButtonClass}>打开设置</button>
                  </div>
                </div>

                {tab === 'daily' && allDailyDigests.length > 0 ? (
                  <div className={`${sectionCardClass} p-4`}>
                    <div className="pb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">History</div>
                    <DigestHistory digests={allDailyDigests} selectedId={currentDigest?.id ?? null} onSelect={(digest) => void handleSelectDigest(digest)} />
                  </div>
                ) : null}

                {tab === 'today' ? (
                  <div className={`${sectionCardClass} p-4`}>
                    <div className="pb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Latest Signals</div>
                    <div className="space-y-3">
                      {items.slice(0, 3).map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setTab('cards')
                            void handleCardClick(item)
                          }}
                          className="w-full rounded-[1rem] border border-bd bg-surface-elevated/[0.88] px-3 py-3 text-left transition hover:border-bd-strong hover:bg-surface-elevated/[0.96]"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="truncate text-sm font-medium text-tx-sub">{item.title || item.author || '(无标题)'}</span>
                            <span className="shrink-0 text-xs text-tx-faint">{formatTime(item.published_at)}</span>
                          </div>
                          <p className="mt-2 line-clamp-2 text-xs leading-6 text-tx-muted">{(item.summary || stripImageUrls(item.content)).trim()}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </>
        )}
      </section>

      {modalLightboxSrc ? <ImageLightbox src={modalLightboxSrc} onClose={() => setModalLightboxSrc(null)} /> : null}

      {settingsOpen ? <NewsSettingsDialog onClose={() => { setSettingsOpen(false); void loadItems(); void loadDigests() }} /> : null}
    </div>
  )
}