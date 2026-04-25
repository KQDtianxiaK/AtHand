import { useEffect, useState, useCallback, useRef } from 'react'
import DOMPurify from 'dompurify'
import type { EmailAccount, EmailBrief, EmailDetail, EmailFolder, EmailContact } from '../api/client'
import {
  getEmailAccounts, getEmailFolders, getEmails, getEmailDetail,
  markEmailRead, markEmailStar, deleteEmail, triggerEmailSync,
  moveEmail, markFolderReadAll, muteEmailFolder, createEmailFolder,
  renameEmailFolder, deleteEmailFolder,
  getEmailContacts, createEmailContact, updateEmailContact, deleteEmailContact,
} from '../api/client'
import EmailAccountDialog from '../components/EmailAccountDialog'
import EmailComposer from '../components/EmailComposer'

const FOLDER_ICONS: Record<string, string> = {
  inbox: '📥', sent: '📤', drafts: '📝', trash: '🗑️', spam: '⚠️', custom: '📁',
}

export default function EmailPage() {
  // ---- state ----
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [activeAccountId, setActiveAccountId] = useState<number | null>(null)
  const [folders, setFolders] = useState<EmailFolder[]>([])
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null)
  const [emails, setEmails] = useState<EmailBrief[]>([])
  const [selectedEmail, setSelectedEmail] = useState<EmailDetail | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)

  // dialogs
  const [showAccountDialog, setShowAccountDialog] = useState(false)
  const [editingAccount, setEditingAccount] = useState<EmailAccount | null>(null)
  const [composing, setComposing] = useState(false)
  const [replyTo, setReplyTo] = useState<EmailDetail | null>(null)
  const [showContacts, setShowContacts] = useState(false)

  // folder context menu
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; folder: EmailFolder } | null>(null)
  const [showCreateFolder, setShowCreateFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  // folder rename
  const [renamingFolderId, setRenamingFolderId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // move email popup
  const [showMoveMenu, setShowMoveMenu] = useState(false)

  // email context menu
  const [emailCtxMenu, setEmailCtxMenu] = useState<{ x: number; y: number; email: EmailBrief } | null>(null)
  const [emailCtxMoveOpen, setEmailCtxMoveOpen] = useState(false)

  const listRef = useRef<HTMLDivElement>(null)

  const activeAccount = accounts.find(a => a.id === activeAccountId) || null

  // ---- data loading ----
  const loadAccounts = useCallback(async (selectNewest = false) => {
    try {
      const accs = await getEmailAccounts()
      setAccounts(accs)
      if (accs.length && !activeAccountId) {
        setActiveAccountId(accs[0].id)
      } else if (selectNewest && accs.length) {
        // 创建新账号后自动切换过去
        setActiveAccountId(accs[accs.length - 1].id)
      }
    } catch (e) {
      console.error('加载邮箱账号失败:', e)
    }
  }, [activeAccountId])

  const loadFolders = useCallback(async () => {
    if (!activeAccountId) return
    const flds = await getEmailFolders(activeAccountId)
    setFolders(flds)
    if (flds.length && !activeFolderId) {
      const inbox = flds.find(f => f.folder_type === 'inbox')
      setActiveFolderId(inbox?.id || flds[0].id)
    }
  }, [activeAccountId, activeFolderId])

  const loadEmails = useCallback(async () => {
    if (!activeAccountId) return
    setLoading(true)
    try {
      const list = await getEmails(activeAccountId, activeFolderId || undefined, search || undefined)
      setEmails(list)
    } finally {
      setLoading(false)
    }
  }, [activeAccountId, activeFolderId, search])

  useEffect(() => { loadAccounts() }, [])
  useEffect(() => {
    if (activeAccountId) {
      setFolders([])
      setActiveFolderId(null)
      setEmails([])
      setSelectedEmail(null)
      loadFolders()
    }
  }, [activeAccountId])
  useEffect(() => {
    if (activeAccountId) loadEmails()
  }, [activeAccountId, activeFolderId, search])

  // listen for AI assistant data changes
  useEffect(() => {
    const handler = (e: Event) => {
      const tool = (e as CustomEvent).detail?.tool || ''
      if (tool.includes('email')) {
        loadEmails()
        loadFolders()
      }
    }
    window.addEventListener('athand:data-changed', handler)
    return () => window.removeEventListener('athand:data-changed', handler)
  }, [loadEmails, loadFolders])

  const handleSelectEmail = async (brief: EmailBrief) => {
    const detail = await getEmailDetail(brief.id)
    setSelectedEmail(detail)
    if (!brief.is_read) {
      await markEmailRead(brief.id, true)
      setEmails(prev => prev.map(e => e.id === brief.id ? { ...e, is_read: true } : e))
      loadFolders()
    }
  }

  const handleSync = async () => {
    if (!activeAccountId) return
    setSyncing(true)
    try {
      await triggerEmailSync(activeAccountId)
      // 等一会让后台同步完
      setTimeout(async () => {
        await loadFolders()
        await loadEmails()
        setSyncing(false)
      }, 3000)
    } catch {
      setSyncing(false)
    }
  }

  const handleDelete = async (id: number) => {
    await deleteEmail(id)
    setEmails(prev => prev.filter(e => e.id !== id))
    if (selectedEmail?.id === id) setSelectedEmail(null)
    loadFolders()
  }

  const handleStar = async (brief: EmailBrief) => {
    await markEmailStar(brief.id, !brief.is_starred)
    setEmails(prev => prev.map(e => e.id === brief.id ? { ...e, is_starred: !e.is_starred } : e))
  }

  const handleMarkUnread = async (emailId: number) => {
    await markEmailRead(emailId, false)
    setEmails(prev => prev.map(e => e.id === emailId ? { ...e, is_read: false } : e))
    if (selectedEmail?.id === emailId) setSelectedEmail(prev => prev ? { ...prev, is_read: false } : prev)
    loadFolders()
  }

  const handleMoveEmail = async (emailId: number, targetFolderId: number) => {
    await moveEmail(emailId, targetFolderId)
    setEmails(prev => prev.filter(e => e.id !== emailId))
    if (selectedEmail?.id === emailId) setSelectedEmail(null)
    setShowMoveMenu(false)
    loadFolders()
  }

  const handleFolderReadAll = async (folderId: number) => {
    await markFolderReadAll(folderId)
    setEmails(prev => prev.map(e => e.folder_id === folderId ? { ...e, is_read: true } : e))
    setFolders(prev => prev.map(f => f.id === folderId ? { ...f, unread_count: 0 } : f))
    setCtxMenu(null)
  }

  const handleToggleMute = async (folderId: number) => {
    const res = await muteEmailFolder(folderId)
    setFolders(prev => prev.map(f => f.id === folderId ? { ...f, is_muted: res.is_muted } : f))
    setCtxMenu(null)
  }

  const handleRenameFolder = async (folderId: number) => {
    const name = renameValue.trim()
    if (!name) return
    const updated = await renameEmailFolder(folderId, name)
    setFolders(prev => prev.map(f => f.id === folderId ? updated : f))
    setRenamingFolderId(null)
    setCtxMenu(null)
  }

  const handleDeleteFolder = async (folder: EmailFolder) => {
    if (!confirm(`确定删除文件夹「${folder.name}」吗？其中的邮件也将一并删除。`)) return
    await deleteEmailFolder(folder.id)
    setFolders(prev => prev.filter(f => f.id !== folder.id))
    if (activeFolderId === folder.id) {
      const inbox = folders.find(f => f.folder_type === 'inbox')
      setActiveFolderId(inbox?.id || null)
    }
    setCtxMenu(null)
  }

  const handleCreateFolder = async () => {
    if (!activeAccountId || !newFolderName.trim()) return
    setCreatingFolder(true)
    try {
      const folder = await createEmailFolder(activeAccountId, newFolderName.trim())
      setFolders(prev => [...prev, folder])
      setNewFolderName('')
      setShowCreateFolder(false)
    } finally {
      setCreatingFolder(false)
    }
    setCtxMenu(null)
  }

  const formatDate = (d: string | null) => {
    if (!d) return ''
    const date = new Date(d)
    const now = new Date()
    if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  }

  // ---- composing ----
  if (composing && activeAccount) {
    return (
      <EmailComposer
        account={activeAccount}
        replyTo={replyTo}
        onSent={() => { setComposing(false); setReplyTo(null); loadEmails() }}
        onClose={() => { setComposing(false); setReplyTo(null) }}
      />
    )
  }

  // ---- no accounts ----
  if (!accounts.length) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-4">
          <div className="text-6xl">📧</div>
          <h2 className="text-xl text-tx font-semibold">开始使用邮箱</h2>
          <p className="text-tx-sub">添加你的第一个邮箱账号来开始收发邮件</p>
          <button onClick={() => setShowAccountDialog(true)} className="px-6 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700">
            添加邮箱账号
          </button>
        </div>
        <EmailAccountDialog open={showAccountDialog} onClose={() => setShowAccountDialog(false)} onSaved={() => loadAccounts(true)} />
      </div>
    )
  }

  return (
    <div className="flex h-full" onClick={() => { setShowMoveMenu(false); setCtxMenu(null); setEmailCtxMenu(null) }}>
      {/* 左栏：文件夹列表 */}
      <div className="w-56 shrink-0 border-r border-bd flex flex-col bg-surface">
        {/* 账号选择器 */}
        <div className="p-3 border-b border-bd">
          <select
            value={activeAccountId || ''}
            onChange={e => setActiveAccountId(Number(e.target.value))}
            className="w-full px-2 py-1.5 rounded-lg bg-raised border border-bd text-tx text-sm"
          >
            {accounts.map(a => <option key={a.id} value={a.id}>{a.display_name || a.email}</option>)}
          </select>
        </div>

        {/* 操作按钮 */}
        <div className="p-2 flex gap-2">
          <button onClick={() => { setComposing(true); setReplyTo(null) }} className="flex-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700">
            ✏️ 写邮件
          </button>
          <button onClick={handleSync} disabled={syncing} className="px-3 py-1.5 rounded-lg bg-raised border border-bd text-tx-sub text-sm hover:bg-blue-600/20 disabled:opacity-50" title="同步">
            {syncing ? '⏳' : '🔄'}
          </button>
        </div>

        {/* 文件夹 */}
        <nav className="flex-1 overflow-auto p-2 space-y-0.5">
          {folders.map(f => (
            <button
              key={f.id}
              onClick={() => { setActiveFolderId(f.id); setSelectedEmail(null); setCtxMenu(null) }}
              onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, folder: f }) }}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                activeFolderId === f.id ? 'bg-blue-600/20 text-blue-400' : 'text-tx-sub hover:bg-raised'
              }`}
            >
              <span>{FOLDER_ICONS[f.folder_type] || '📁'}</span>
              <span className="flex-1 text-left truncate">{f.name}</span>
              {f.is_muted
                ? f.total_count > 0 && <span className="text-xs text-tx-sub opacity-50">{f.total_count}</span>
                : f.unread_count > 0 && (
                    <span className="text-xs bg-blue-600 text-white rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                      {f.unread_count}
                    </span>
                  )
              }
            </button>
          ))}
        </nav>

        {/* 底部：管理按钮 */}
        <div className="p-2 border-t border-bd space-y-1">
          <button
            onClick={() => setShowCreateFolder(true)}
            className="w-full px-3 py-1.5 rounded-lg text-xs text-tx-sub hover:bg-raised"
          >✚ 新建文件夹</button>
          <button
            onClick={() => setShowContacts(true)}
            className="w-full px-3 py-1.5 rounded-lg text-xs text-tx-sub hover:bg-raised"
          >👥 联系人</button>
          <button
            onClick={() => { setEditingAccount(activeAccount); setShowAccountDialog(true) }}
            className="w-full px-3 py-1.5 rounded-lg text-xs text-tx-sub hover:bg-raised"
          >⚙️ 账号设置</button>
          <button
            onClick={() => { setEditingAccount(null); setShowAccountDialog(true) }}
            className="w-full px-3 py-1.5 rounded-lg text-xs text-tx-sub hover:bg-raised"
          >＋ 添加账号</button>
        </div>
      </div>

      {/* 联系人面板 */}
      {showContacts && (
        <ContactsPanel
          onClose={() => setShowContacts(false)}
          getEmailContacts={getEmailContacts}
          createEmailContact={createEmailContact}
          updateEmailContact={updateEmailContact}
          deleteEmailContact={deleteEmailContact}
        />
      )}

      {/* 中栏：邮件列表 */}
      {!showContacts && <div className="w-80 shrink-0 border-r border-bd flex flex-col bg-surface" ref={listRef}>
        {/* 搜索 + 全部已读 */}
        <div className="p-2 border-b border-bd flex gap-2 items-center">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索邮件..."
            className="flex-1 px-3 py-1.5 rounded-lg bg-raised border border-bd text-tx text-sm focus:outline-none focus:border-blue-500"
          />
          {activeFolderId && (
            <button
              onClick={() => handleFolderReadAll(activeFolderId)}
              className="shrink-0 px-2 py-1.5 rounded-lg bg-raised border border-bd text-tx-sub text-xs hover:bg-blue-600/20"
              title="全部已读"
            >✔ 已读</button>
          )}
        </div>

        {/* 列表 */}
        <div className="flex-1 overflow-auto">
          {loading && <div className="p-4 text-center text-tx-sub text-sm">加载中...</div>}
          {!loading && !emails.length && (
            <div className="p-4 text-center text-tx-sub text-sm">暂无邮件</div>
          )}
          {emails.map(e => (
            <button
              key={e.id}
              onClick={() => handleSelectEmail(e)}
              onContextMenu={ev => {
                ev.preventDefault()
                ev.stopPropagation()
                setEmailCtxMenu({ x: ev.clientX, y: ev.clientY, email: e })
                setEmailCtxMoveOpen(false)
              }}
              className={`w-full text-left px-3 py-2.5 border-b border-bd transition-colors ${
                selectedEmail?.id === e.id ? 'bg-blue-600/10' : 'hover:bg-raised'
              } ${!e.is_read ? 'bg-blue-600/5' : ''}`}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <button
                  onClick={ev => { ev.stopPropagation(); handleStar(e) }}
                  className="text-sm shrink-0"
                >{e.is_starred ? '⭐' : '☆'}</button>
                <span className={`flex-1 text-sm truncate ${!e.is_read ? 'font-semibold text-tx' : 'text-tx-sub'}`}>
                  {e.from_name || e.from_addr}
                </span>
                <span className="text-xs text-tx-sub shrink-0">{formatDate(e.date)}</span>
              </div>
              <div className={`text-sm truncate ${!e.is_read ? 'text-tx' : 'text-tx-sub'}`}>{e.subject || '(无主题)'}</div>
              <div className="text-xs text-tx-sub truncate mt-0.5">{e.snippet}</div>
              {e.has_attachments && <span className="text-xs text-tx-sub">📎</span>}
            </button>
          ))}
        </div>
      </div>}

      {/* 右栏：邮件详情 */}
      <div className="flex-1 flex flex-col min-w-0 bg-surface">
        {selectedEmail ? (
          <>
            <div className="px-6 py-4 border-b border-bd">
              <h2 className="text-lg font-semibold text-tx mb-2">{selectedEmail.subject || '(无主题)'}</h2>
              <div className="flex items-center gap-3 text-sm text-tx-sub">
                <span className="font-medium text-tx">{selectedEmail.from_name || selectedEmail.from_addr}</span>
                <span>&lt;{selectedEmail.from_addr}&gt;</span>
                <span className="flex-1" />
                <span>{selectedEmail.date ? new Date(selectedEmail.date).toLocaleString('zh-CN') : ''}</span>
              </div>
              {selectedEmail.to_addrs.length > 0 && (
                <div className="text-xs text-tx-sub mt-1">
                  收件人：{selectedEmail.to_addrs.map(a => a.name ? `${a.name} <${a.addr}>` : a.addr).join(', ')}
                </div>
              )}
              {selectedEmail.cc_addrs.length > 0 && (
                <div className="text-xs text-tx-sub">
                  抄送：{selectedEmail.cc_addrs.map(a => a.name ? `${a.name} <${a.addr}>` : a.addr).join(', ')}
                </div>
              )}
              {selectedEmail.attachments_meta.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {selectedEmail.attachments_meta.map((att, i) => (
                    <span key={i} className="text-xs px-2 py-1 rounded bg-raised border border-bd text-tx-sub">
                      📎 {att.filename} ({(att.size / 1024).toFixed(1)}KB)
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* 操作栏 */}
            <div className="px-6 py-2 border-b border-bd flex gap-2 flex-wrap">
              <button onClick={() => { setReplyTo(selectedEmail); setComposing(true) }} className="px-3 py-1 rounded-lg text-sm bg-raised border border-bd text-tx-sub hover:bg-blue-600/20">↩️ 回复</button>
              <button onClick={() => { setReplyTo(null); setComposing(true) }} className="px-3 py-1 rounded-lg text-sm bg-raised border border-bd text-tx-sub hover:bg-blue-600/20">✏️ 转发</button>
              <button onClick={() => handleMarkUnread(selectedEmail.id)} className="px-3 py-1 rounded-lg text-sm bg-raised border border-bd text-tx-sub hover:bg-blue-600/20">👁 标记未读</button>
              <div className="relative">
                <button onClick={() => setShowMoveMenu(m => !m)} className="px-3 py-1 rounded-lg text-sm bg-raised border border-bd text-tx-sub hover:bg-blue-600/20">📂 移动到▾</button>
                {showMoveMenu && (
                  <div className="absolute left-0 top-full mt-1 bg-surface border border-bd rounded-lg shadow-lg z-50 min-w-[160px] max-h-60 overflow-auto">
                    {folders.filter(f => f.id !== selectedEmail.folder_id).map(f => (
                      <button key={f.id} onClick={() => handleMoveEmail(selectedEmail.id, f.id)}
                        className="w-full text-left px-3 py-2 text-sm text-tx-sub hover:bg-raised">
                        {FOLDER_ICONS[f.folder_type] || '📁'} {f.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={() => handleDelete(selectedEmail.id)} className="px-3 py-1 rounded-lg text-sm bg-raised border border-bd text-red-400 hover:bg-red-600/20">🗑️ 删除</button>
            </div>

            {/* 邮件正文 */}
            <div className="flex-1 overflow-auto px-6 py-4">
              {selectedEmail.body_html ? (
                <div
                  className="prose prose-sm dark:prose-invert max-w-none"
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(selectedEmail.body_html, {
                    ADD_TAGS: ['img'],
                    ADD_ATTR: ['src', 'alt', 'width', 'height', 'style'],
                    ALLOW_DATA_ATTR: false,
                    // 允许 data: URI（内嵌图片）和 http(s) 外链图片
                    ALLOWED_URI_REGEXP: /^(?:(?:https?|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
                  }) }}
                />
              ) : (
                <pre className="text-sm text-tx whitespace-pre-wrap font-sans">{selectedEmail.body_text}</pre>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-tx-sub">
            <div className="text-center">
              <div className="text-4xl mb-2">📬</div>
              <p>选择一封邮件查看详情</p>
            </div>
          </div>
        )}
      </div>

      {/* 弹窗 */}
      <EmailAccountDialog
        open={showAccountDialog}
        onClose={() => { setShowAccountDialog(false); setEditingAccount(null) }}
        onSaved={() => { loadAccounts(!editingAccount); loadFolders() }}
        account={editingAccount}
      />

      {/* 文件夹右键菜单 */}
      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCtxMenu(null)} />
          <div
            className="fixed z-50 bg-surface border border-bd rounded-lg shadow-lg py-1 min-w-[160px]"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            <button onClick={() => handleFolderReadAll(ctxMenu.folder.id)}
              className="w-full text-left px-4 py-2 text-sm text-tx-sub hover:bg-raised">
              ✔ 全部已读
            </button>
            <button onClick={() => handleToggleMute(ctxMenu.folder.id)}
              className="w-full text-left px-4 py-2 text-sm text-tx-sub hover:bg-raised">
              {ctxMenu.folder.is_muted ? '🔔 取消静音' : '🔕 静音（不显示未读）'}
            </button>
            {ctxMenu.folder.folder_type === 'custom' && (
              <>
                <div className="border-t border-bd/60 my-1" />
                <button
                  onClick={() => {
                    setRenamingFolderId(ctxMenu.folder.id)
                    setRenameValue(ctxMenu.folder.name)
                    setCtxMenu(null)
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-tx-sub hover:bg-raised">
                  ✏️ 重命名
                </button>
                <button onClick={() => handleDeleteFolder(ctxMenu.folder)}
                  className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-red-600/10">
                  🗑️ 删除文件夹
                </button>
              </>
            )}
            <div className="border-t border-bd/60 my-1" />
            <button
              onClick={() => { setCtxMenu(null); setShowCreateFolder(true) }}
              className="w-full text-left px-4 py-2 text-sm text-tx-sub hover:bg-raised">
              ✨ 新建文件夹
            </button>
          </div>
        </>
      )}

      {/* 邮件右键菜单 */}
      {emailCtxMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setEmailCtxMenu(null); setEmailCtxMoveOpen(false) }} />
          <div
            className="fixed z-50 bg-surface border border-bd rounded-lg shadow-lg py-1 min-w-[180px]"
            style={{ left: emailCtxMenu.x, top: emailCtxMenu.y }}
            onClick={e => e.stopPropagation()}
          >
            {/* 已读/未读 */}
            <button
              onClick={async () => {
                const isRead = !emailCtxMenu.email.is_read
                await markEmailRead(emailCtxMenu.email.id, isRead)
                setEmails(prev => prev.map(e => e.id === emailCtxMenu.email.id ? { ...e, is_read: isRead } : e))
                if (selectedEmail?.id === emailCtxMenu.email.id) setSelectedEmail(prev => prev ? { ...prev, is_read: isRead } : prev)
                loadFolders()
                setEmailCtxMenu(null)
              }}
              className="w-full text-left px-4 py-2 text-sm text-tx-sub hover:bg-raised"
            >
              {emailCtxMenu.email.is_read ? '✉️ 标记未读' : '✔️ 标记已读'}
            </button>
            {/* 就 */}
            <button
              onClick={async () => {
                const isStarred = !emailCtxMenu.email.is_starred
                await markEmailStar(emailCtxMenu.email.id, isStarred)
                setEmails(prev => prev.map(e => e.id === emailCtxMenu.email.id ? { ...e, is_starred: isStarred } : e))
                setEmailCtxMenu(null)
              }}
              className="w-full text-left px-4 py-2 text-sm text-tx-sub hover:bg-raised"
            >
              {emailCtxMenu.email.is_starred ? '☆ 取消星标' : '⭐ 加星'}
            </button>
            <div className="border-t border-bd/60 my-1" />
            {/* 回复 */}
            <button
              onClick={async () => {
                const detail = await getEmailDetail(emailCtxMenu.email.id)
                setReplyTo(detail)
                setComposing(true)
                setEmailCtxMenu(null)
              }}
              className="w-full text-left px-4 py-2 text-sm text-tx-sub hover:bg-raised"
            >
              ↩️ 回复
            </button>
            {/* 移动到 */}
            <button
              onClick={() => setEmailCtxMoveOpen(v => !v)}
              className="w-full text-left px-4 py-2 text-sm text-tx-sub hover:bg-raised flex items-center justify-between"
            >
              <span>📂 移动到</span>
              <span className="text-xs opacity-50">{emailCtxMoveOpen ? '▲' : '▼'}</span>
            </button>
            {emailCtxMoveOpen && (
              <div className="border-t border-bd/60 max-h-48 overflow-auto">
                {folders.filter(f => f.id !== emailCtxMenu.email.folder_id).map(f => (
                  <button
                    key={f.id}
                    onClick={async () => {
                      await moveEmail(emailCtxMenu.email.id, f.id)
                      setEmails(prev => prev.filter(e => e.id !== emailCtxMenu.email.id))
                      if (selectedEmail?.id === emailCtxMenu.email.id) setSelectedEmail(null)
                      loadFolders()
                      setEmailCtxMenu(null)
                    }}
                    className="w-full text-left pl-6 pr-4 py-1.5 text-sm text-tx-sub hover:bg-raised"
                  >
                    {FOLDER_ICONS[f.folder_type] || '📁'} {f.name}
                  </button>
                ))}
              </div>
            )}
            <div className="border-t border-bd/60 my-1" />
            {/* 删除 */}
            <button
              onClick={async () => {
                await handleDelete(emailCtxMenu.email.id)
                setEmailCtxMenu(null)
              }}
              className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-red-600/10"
            >
              🗑️ 删除
            </button>
          </div>
        </>
      )}

      {/* 文件夹重命名对话框 */}
      {renamingFolderId !== null && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setRenamingFolderId(null)}>
          <div className="bg-surface rounded-xl border border-bd p-6 w-80" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-tx mb-4">重命名文件夹</h3>
            <input
              autoFocus
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleRenameFolder(renamingFolderId) }}
              placeholder="新文件夹名称"
              className="w-full px-3 py-2 rounded-lg bg-raised border border-bd text-tx text-sm focus:outline-none focus:border-blue-500 mb-4"
            />
            <div className="flex gap-3 justify-end">
              <button onClick={() => setRenamingFolderId(null)} className="px-4 py-2 rounded-lg bg-raised border border-bd text-tx-sub text-sm">取消</button>
              <button
                onClick={() => handleRenameFolder(renamingFolderId)}
                disabled={!renameValue.trim()}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50"
              >确定</button>
            </div>
          </div>
        </div>
      )}

      {/* 新建文件夹对话框 */}
      {showCreateFolder && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowCreateFolder(false)}>
          <div className="bg-surface rounded-xl border border-bd p-6 w-80" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-tx mb-4">新建文件夹</h3>
            <input
              autoFocus
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder() }}
              placeholder="文件夹名称"
              className="w-full px-3 py-2 rounded-lg bg-raised border border-bd text-tx text-sm focus:outline-none focus:border-blue-500 mb-4"
            />
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowCreateFolder(false)} className="px-4 py-2 rounded-lg bg-raised border border-bd text-tx-sub text-sm">取消</button>
              <button onClick={handleCreateFolder} disabled={creatingFolder || !newFolderName.trim()}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50">
                {creatingFolder ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────── ContactsPanel ─────────────────────────── */

interface ContactsPanelProps {
  onClose: () => void
  getEmailContacts: (q?: string) => Promise<import('../api/client').EmailContact[]>
  createEmailContact: (body: { email: string; name?: string; notes?: string }) => Promise<import('../api/client').EmailContact>
  updateEmailContact: (id: number, body: { name?: string; notes?: string }) => Promise<import('../api/client').EmailContact>
  deleteEmailContact: (id: number) => Promise<void>
}

function ContactsPanel({ onClose, getEmailContacts, createEmailContact, updateEmailContact, deleteEmailContact }: ContactsPanelProps) {
  const [contacts, setContacts] = useState<import('../api/client').EmailContact[]>([])
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [adding, setAdding] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)

  const load = async (q?: string) => {
    const data = await getEmailContacts(q || undefined)
    setContacts(data)
  }

  useEffect(() => { load(search) }, [search])

  const startEdit = (c: import('../api/client').EmailContact) => {
    setEditingId(c.id)
    setEditName(c.name)
    setEditNotes(c.notes)
  }

  const saveEdit = async (id: number) => {
    setSaving(true)
    try {
      const updated = await updateEmailContact(id, { name: editName, notes: editNotes })
      setContacts(cs => cs.map(c => c.id === id ? updated : c))
      setEditingId(null)
    } finally { setSaving(false) }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除该联系人？')) return
    await deleteEmailContact(id)
    setContacts(cs => cs.filter(c => c.id !== id))
  }

  const handleAdd = async () => {
    if (!newEmail.trim()) return
    setSaving(true)
    try {
      const c = await createEmailContact({ email: newEmail.trim(), name: newName.trim() || undefined })
      setContacts(cs => [c, ...cs])
      setAdding(false)
      setNewEmail('')
      setNewName('')
    } finally { setSaving(false) }
  }

  return (
    <div className="w-80 shrink-0 border-r border-bd flex flex-col bg-surface">
      {/* 顶部 */}
      <div className="p-2 border-b border-bd flex gap-2 items-center">
        <button onClick={onClose} className="text-tx-sub hover:text-tx px-1">←</button>
        <span className="font-medium text-sm text-tx flex-1">联系人</span>
        <button
          onClick={() => setAdding(a => !a)}
          className="text-xs px-2 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
        >+ 添加</button>
      </div>

      {/* 搜索 */}
      <div className="px-2 py-2 border-b border-bd">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜索联系人..."
          className="w-full px-3 py-1.5 rounded-lg bg-raised border border-bd text-tx text-sm focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* 新建 */}
      {adding && (
        <div className="px-3 py-2 border-b border-bd flex flex-col gap-1 bg-raised/50">
          <input
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            placeholder="邮箱地址 *"
            className="px-2 py-1 rounded bg-surface border border-bd text-sm text-tx focus:outline-none focus:border-blue-500"
          />
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="显示名称（可选）"
            className="px-2 py-1 rounded bg-surface border border-bd text-sm text-tx focus:outline-none focus:border-blue-500"
          />
          <div className="flex gap-1">
            <button
              onClick={handleAdd}
              disabled={saving || !newEmail.trim()}
              className="flex-1 py-1 rounded text-xs bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >{saving ? '保存...' : '保存'}</button>
            <button onClick={() => setAdding(false)} className="flex-1 py-1 rounded text-xs bg-raised border border-bd text-tx-sub hover:bg-bd">取消</button>
          </div>
        </div>
      )}

      {/* 列表 */}
      <div className="flex-1 overflow-auto">
        {contacts.length === 0 && (
          <div className="p-4 text-center text-tx-sub text-sm">暂无联系人</div>
        )}
        {contacts.map(c => (
          <div key={c.id} className="border-b border-bd/50 px-3 py-2">
            {editingId === c.id ? (
              <div className="flex flex-col gap-1">
                <input
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  placeholder="显示名称"
                  className="px-2 py-1 rounded bg-raised border border-bd text-sm text-tx focus:outline-none"
                />
                <input
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  placeholder="备注"
                  className="px-2 py-1 rounded bg-raised border border-bd text-sm text-tx focus:outline-none"
                />
                <div className="flex gap-1">
                  <button
                    onClick={() => saveEdit(c.id)}
                    disabled={saving}
                    className="flex-1 py-0.5 rounded text-xs bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >保存</button>
                  <button onClick={() => setEditingId(null)} className="flex-1 py-0.5 rounded text-xs bg-raised border border-bd text-tx-sub">取消</button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <div className="w-7 h-7 rounded-full bg-blue-600/20 text-blue-400 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                  {(c.name || c.email)[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-tx font-medium truncate">{c.name || c.email}</span>
                    {c.is_auto && <span className="text-[10px] px-1 rounded bg-raised text-tx-sub">自动</span>}
                  </div>
                  {c.name && <div className="text-xs text-tx-sub truncate">{c.email}</div>}
                  {c.send_count > 0 && <div className="text-[10px] text-tx-sub">已发 {c.send_count} 次</div>}
                  {c.notes && <div className="text-xs text-tx-sub truncate">{c.notes}</div>}
                </div>
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button onClick={() => startEdit(c)} className="text-[10px] text-tx-sub hover:text-tx">编辑</button>
                  <button onClick={() => handleDelete(c.id)} className="text-[10px] text-red-400 hover:text-red-300">删除</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
