import { useCallback, useEffect, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import type { EmailAccount, EmailBrief, EmailContact, EmailDetail, EmailFolder } from '../api/client'
import {
  createEmailContact,
  createEmailFolder,
  deleteEmail,
  deleteEmailContact,
  deleteEmailFolder,
  getEmailAccounts,
  getEmailContacts,
  getEmailDetail,
  getEmailFolders,
  getEmails,
  markEmailRead,
  markEmailStar,
  markFolderReadAll,
  moveEmail,
  muteEmailFolder,
  renameEmailFolder,
  triggerEmailSync,
  updateEmailContact,
} from '../api/client'
import EmailAccountDialog from '../components/EmailAccountDialog'
import EmailComposer from '../components/EmailComposer'

const shellPanelClass = 'rounded-[1.75rem] border border-bd bg-surface/[0.88] shadow-ambient backdrop-blur-xl'
const sectionCardClass = 'rounded-[1.35rem] border border-bd bg-page/[0.52]'
const insetCardClass = 'rounded-[1.1rem] border border-bd bg-page/[0.4]'
const fieldClass = 'w-full rounded-[1.05rem] border border-bd-strong bg-surface-elevated/[0.9] px-3 py-2.5 text-sm text-tx shadow-inset outline-none transition placeholder:text-tx-faint focus:border-accent/40 focus:ring-2 focus:ring-accent/10'
const secondaryButtonClass = 'rounded-[1rem] border border-bd bg-page/[0.55] px-3 py-2 text-xs font-medium text-tx-muted transition hover:border-bd-strong hover:bg-surface-elevated/[0.92] hover:text-tx-sub disabled:opacity-50'
const primaryButtonClass = 'rounded-[1rem] bg-accent px-3 py-2 text-xs font-medium text-white transition hover:bg-accent-strong disabled:opacity-50'
const menuClass = 'fixed z-50 min-w-[180px] rounded-[1.1rem] border border-bd bg-surface/[0.98] py-1 shadow-float backdrop-blur-xl'
const proseClass = 'prose prose-sm max-w-none prose-headings:text-tx prose-headings:tracking-[-0.03em] prose-p:text-tx prose-p:leading-7 prose-strong:text-tx-sub prose-em:text-tx-muted prose-code:text-accent prose-code:bg-page/[0.65] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-[0.55rem] prose-code:text-xs prose-code:before:content-none prose-code:after:content-none prose-pre:bg-surface-elevated/[0.92] prose-pre:border prose-pre:border-bd prose-pre:rounded-[1rem] prose-blockquote:border-accent prose-blockquote:text-tx-muted prose-a:text-accent prose-a:no-underline hover:prose-a:underline prose-ul:text-tx prose-ol:text-tx prose-li:text-tx prose-hr:border-bd prose-table:text-tx prose-th:text-tx prose-td:text-tx'

const FOLDER_ICONS: Record<string, string> = {
  inbox: '📥',
  sent: '📤',
  drafts: '📝',
  trash: '🗑️',
  spam: '⚠️',
  custom: '📁',
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

function formatDate(d: string | null) {
  if (!d) return ''
  const date = new Date(d)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

export default function EmailPage() {
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [activeAccountId, setActiveAccountId] = useState<number | null>(null)
  const [folders, setFolders] = useState<EmailFolder[]>([])
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null)
  const [emails, setEmails] = useState<EmailBrief[]>([])
  const [selectedEmail, setSelectedEmail] = useState<EmailDetail | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const [showAccountDialog, setShowAccountDialog] = useState(false)
  const [editingAccount, setEditingAccount] = useState<EmailAccount | null>(null)
  const [composing, setComposing] = useState(false)
  const [replyTo, setReplyTo] = useState<EmailDetail | null>(null)
  const [showContacts, setShowContacts] = useState(false)

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; folder: EmailFolder } | null>(null)
  const [showCreateFolder, setShowCreateFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [renamingFolderId, setRenamingFolderId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const [showMoveMenu, setShowMoveMenu] = useState(false)
  const [emailCtxMenu, setEmailCtxMenu] = useState<{ x: number; y: number; email: EmailBrief } | null>(null)
  const [emailCtxMoveOpen, setEmailCtxMoveOpen] = useState(false)

  const listRef = useRef<HTMLDivElement>(null)

  const activeAccount = accounts.find((account) => account.id === activeAccountId) || null
  const activeFolder = folders.find((folder) => folder.id === activeFolderId) || null
  const unreadTotal = folders.reduce((total, folder) => total + (folder.is_muted ? 0 : folder.unread_count), 0)
  const customFolderCount = folders.filter((folder) => folder.folder_type === 'custom').length

  const closeFloatingMenus = () => {
    setShowMoveMenu(false)
    setCtxMenu(null)
    setEmailCtxMenu(null)
    setEmailCtxMoveOpen(false)
  }

  const loadAccounts = useCallback(async (selectNewest = false) => {
    try {
      const nextAccounts = await getEmailAccounts()
      setAccounts(nextAccounts)
      if (nextAccounts.length && !activeAccountId) {
        setActiveAccountId(nextAccounts[0].id)
      } else if (selectNewest && nextAccounts.length) {
        setActiveAccountId(nextAccounts[nextAccounts.length - 1].id)
      }
    } catch (error) {
      console.error('加载邮箱账号失败:', error)
    }
  }, [activeAccountId])

  const loadFolders = useCallback(async () => {
    if (!activeAccountId) return
    const nextFolders = await getEmailFolders(activeAccountId)
    setFolders(nextFolders)
    if (nextFolders.length && !activeFolderId) {
      const inbox = nextFolders.find((folder) => folder.folder_type === 'inbox')
      setActiveFolderId(inbox?.id || nextFolders[0].id)
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

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts])

  useEffect(() => {
    if (!activeAccountId) return
    setFolders([])
    setActiveFolderId(null)
    setEmails([])
    setSelectedEmail(null)
    void loadFolders()
  }, [activeAccountId, loadFolders])

  useEffect(() => {
    if (activeAccountId) {
      void loadEmails()
    }
  }, [activeAccountId, activeFolderId, search, loadEmails])

  useEffect(() => {
    const handler = (event: Event) => {
      const tool = (event as CustomEvent).detail?.tool || ''
      if (tool.includes('email')) {
        void loadEmails()
        void loadFolders()
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
      setEmails((prev) => prev.map((email) => (email.id === brief.id ? { ...email, is_read: true } : email)))
      void loadFolders()
    }
  }

  const handleSync = async () => {
    if (!activeAccountId) return
    setSyncing(true)
    try {
      await triggerEmailSync(activeAccountId)
      window.setTimeout(async () => {
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
    setEmails((prev) => prev.filter((email) => email.id !== id))
    if (selectedEmail?.id === id) setSelectedEmail(null)
    void loadFolders()
  }

  const handleStar = async (brief: EmailBrief) => {
    await markEmailStar(brief.id, !brief.is_starred)
    setEmails((prev) => prev.map((email) => (email.id === brief.id ? { ...email, is_starred: !email.is_starred } : email)))
  }

  const handleMarkUnread = async (emailId: number) => {
    await markEmailRead(emailId, false)
    setEmails((prev) => prev.map((email) => (email.id === emailId ? { ...email, is_read: false } : email)))
    if (selectedEmail?.id === emailId) {
      setSelectedEmail((prev) => (prev ? { ...prev, is_read: false } : prev))
    }
    void loadFolders()
  }

  const handleMoveEmail = async (emailId: number, targetFolderId: number) => {
    await moveEmail(emailId, targetFolderId)
    setEmails((prev) => prev.filter((email) => email.id !== emailId))
    if (selectedEmail?.id === emailId) setSelectedEmail(null)
    setShowMoveMenu(false)
    void loadFolders()
  }

  const handleFolderReadAll = async (folderId: number) => {
    await markFolderReadAll(folderId)
    setEmails((prev) => prev.map((email) => (email.folder_id === folderId ? { ...email, is_read: true } : email)))
    setFolders((prev) => prev.map((folder) => (folder.id === folderId ? { ...folder, unread_count: 0 } : folder)))
    setCtxMenu(null)
  }

  const handleToggleMute = async (folderId: number) => {
    const result = await muteEmailFolder(folderId)
    setFolders((prev) => prev.map((folder) => (folder.id === folderId ? { ...folder, is_muted: result.is_muted } : folder)))
    setCtxMenu(null)
  }

  const handleRenameFolder = async (folderId: number) => {
    const name = renameValue.trim()
    if (!name) return
    const updated = await renameEmailFolder(folderId, name)
    setFolders((prev) => prev.map((folder) => (folder.id === folderId ? updated : folder)))
    setRenamingFolderId(null)
    setCtxMenu(null)
  }

  const handleDeleteFolder = async (folder: EmailFolder) => {
    if (!confirm(`确定删除文件夹「${folder.name}」吗？其中的邮件也将一并删除。`)) return
    await deleteEmailFolder(folder.id)
    setFolders((prev) => prev.filter((item) => item.id !== folder.id))
    if (activeFolderId === folder.id) {
      const inbox = folders.find((item) => item.folder_type === 'inbox')
      setActiveFolderId(inbox?.id || null)
    }
    setCtxMenu(null)
  }

  const handleCreateFolder = async () => {
    if (!activeAccountId || !newFolderName.trim()) return
    setCreatingFolder(true)
    try {
      const folder = await createEmailFolder(activeAccountId, newFolderName.trim())
      setFolders((prev) => [...prev, folder])
      setNewFolderName('')
      setShowCreateFolder(false)
    } finally {
      setCreatingFolder(false)
    }
    setCtxMenu(null)
  }

  if (composing && activeAccount) {
    return (
      <EmailComposer
        account={activeAccount}
        replyTo={replyTo}
        onSent={() => {
          setComposing(false)
          setReplyTo(null)
          void loadEmails()
        }}
        onClose={() => {
          setComposing(false)
          setReplyTo(null)
        }}
      />
    )
  }

  if (!accounts.length) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className={`${shellPanelClass} w-full max-w-xl px-8 py-10 text-center`}>
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Mail Hub</div>
          <div className="mt-4 text-6xl">📧</div>
          <h2 className="mt-5 text-[1.9rem] font-semibold tracking-[-0.04em] text-tx">开始使用邮箱</h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-tx-muted">添加第一个邮箱账号之后，这里会变成你的邮件工作流：文件夹管理、同步收件、快速回复和联系人维护都在同一处完成。</p>
          <button onClick={() => setShowAccountDialog(true)} className={`${primaryButtonClass} mt-7 px-5 py-3 text-sm`}>
            添加邮箱账号
          </button>
        </div>
        <EmailAccountDialog
          open={showAccountDialog}
          onClose={() => setShowAccountDialog(false)}
          onSaved={() => void loadAccounts(true)}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6 xl:grid xl:grid-cols-[310px_360px_minmax(0,1fr)]" onClick={closeFloatingMenus}>
      <section className={`flex min-h-[360px] flex-col overflow-hidden ${shellPanelClass}`}>
        <div className="border-b border-bd/70 px-5 py-5">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Mail Hub</div>
          <h2 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-tx">邮箱工作区</h2>
          <p className="mt-2 text-sm leading-6 text-tx-muted">把账号、文件夹、收件同步和联系人管理收进同一条邮件控制主线里。</p>
        </div>

        <div className="space-y-4 p-4">
          <div className={`${sectionCardClass} p-4`}>
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Account</div>
            <select
              value={activeAccountId || ''}
              onChange={(event) => setActiveAccountId(Number(event.target.value))}
              className={`${fieldClass} mt-3`}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.display_name || account.email}
                </option>
              ))}
            </select>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={(event) => {
                  event.stopPropagation()
                  setComposing(true)
                  setReplyTo(null)
                }}
                className={`${primaryButtonClass} text-sm`}
              >
                写邮件
              </button>
              <button
                onClick={(event) => {
                  event.stopPropagation()
                  void handleSync()
                }}
                disabled={syncing}
                className={`${secondaryButtonClass} text-sm`}
                title="同步"
              >
                {syncing ? '同步中...' : '同步邮箱'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <StatCard label="未读总数" value={`${unreadTotal}`} detail="静音文件夹不会计入这里。" />
            <StatCard label="自定义文件夹" value={`${customFolderCount}`} detail="常用分类会保留在左侧。" />
          </div>

          <div className={`${sectionCardClass} min-h-0 flex-1 p-3`}>
            <div className="flex items-center justify-between px-1 pb-3">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Folders</div>
                <div className="mt-1 text-sm font-medium text-tx-sub">文件夹导航</div>
              </div>
              <button
                onClick={(event) => {
                  event.stopPropagation()
                  setShowCreateFolder(true)
                }}
                className={secondaryButtonClass}
              >
                新建
              </button>
            </div>

            <nav className="space-y-2 overflow-auto">
              {folders.map((folder) => {
                const active = activeFolderId === folder.id
                return (
                  <button
                    key={folder.id}
                    onClick={(event) => {
                      event.stopPropagation()
                      setActiveFolderId(folder.id)
                      setSelectedEmail(null)
                      setCtxMenu(null)
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setCtxMenu({ x: event.clientX, y: event.clientY, folder })
                    }}
                    className={`w-full rounded-[1.15rem] border px-3 py-3 text-left transition-all ${
                      active
                        ? 'border-accent/20 bg-accent-soft/[0.8] shadow-float ring-1 ring-accent/10'
                        : 'border-bd bg-surface-elevated/[0.88] hover:border-bd-strong hover:bg-surface-elevated/[0.96]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-bd bg-page/[0.7] text-lg">
                        {FOLDER_ICONS[folder.folder_type] || '📁'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-tx-sub">{folder.name}</div>
                        <div className="text-xs text-tx-muted">
                          {folder.is_muted ? '静音文件夹' : folder.unread_count > 0 ? `${folder.unread_count} 封未读` : `${folder.total_count} 封邮件`}
                        </div>
                      </div>
                      {folder.is_muted ? (
                        <span className="rounded-full border border-bd px-2 py-1 text-[11px] text-tx-faint">静音</span>
                      ) : folder.unread_count > 0 ? (
                        <span className="rounded-full bg-accent px-2 py-1 text-[11px] font-medium text-white">{folder.unread_count}</span>
                      ) : null}
                    </div>
                  </button>
                )
              })}
            </nav>
          </div>

          <div className={`${sectionCardClass} p-3`}>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={(event) => {
                  event.stopPropagation()
                  setShowContacts(true)
                }}
                className={secondaryButtonClass}
              >
                联系人
              </button>
              <button
                onClick={(event) => {
                  event.stopPropagation()
                  setEditingAccount(activeAccount)
                  setShowAccountDialog(true)
                }}
                className={secondaryButtonClass}
              >
                账号设置
              </button>
              <button
                onClick={(event) => {
                  event.stopPropagation()
                  setEditingAccount(null)
                  setShowAccountDialog(true)
                }}
                className="col-span-2 rounded-[1rem] border border-bd bg-page/[0.55] px-3 py-2 text-xs font-medium text-tx-sub transition hover:border-bd-strong hover:bg-surface-elevated/[0.92]"
              >
                添加账号
              </button>
            </div>
          </div>
        </div>
      </section>

      {showContacts ? (
        <ContactsPanel
          onClose={() => setShowContacts(false)}
          getEmailContacts={getEmailContacts}
          createEmailContact={createEmailContact}
          updateEmailContact={updateEmailContact}
          deleteEmailContact={deleteEmailContact}
        />
      ) : (
        <section className={`flex min-h-[360px] flex-col overflow-hidden ${shellPanelClass}`} ref={listRef}>
          <div className="border-b border-bd/70 px-5 py-5">
            <div className="flex flex-col gap-4">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Mail Queue</div>
                <h2 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-tx">{activeFolder?.name || '邮件列表'}</h2>
                <p className="mt-2 text-sm leading-6 text-tx-muted">{activeAccount?.email || '当前账号'} {activeFolder ? `中的 ${emails.length} 封结果` : '的邮件列表'}。</p>
              </div>

              <div className={`${sectionCardClass} p-3`} onClick={(event) => event.stopPropagation()}>
                <div className="flex gap-2">
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="搜索邮件主题、发件人或片段..."
                    className={fieldClass}
                  />
                  {activeFolderId && (
                    <button
                      onClick={() => void handleFolderReadAll(activeFolderId)}
                      className={secondaryButtonClass}
                      title="全部已读"
                    >
                      全部已读
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-4 pb-4 pt-3">
            {loading && <div className="rounded-[1.2rem] border border-bd bg-page/[0.55] px-4 py-8 text-center text-sm text-tx-muted">加载中...</div>}

            {!loading && !emails.length && (
              <div className="rounded-[1.2rem] border border-dashed border-bd px-4 py-10 text-center text-sm leading-6 text-tx-faint">
                这个文件夹当前没有邮件结果。
              </div>
            )}

            <div className="space-y-3">
              {emails.map((email) => {
                const selected = selectedEmail?.id === email.id
                const unread = !email.is_read

                return (
                  <div
                    key={email.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => void handleSelectEmail(email)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        void handleSelectEmail(email)
                      }
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setEmailCtxMenu({ x: event.clientX, y: event.clientY, email })
                      setEmailCtxMoveOpen(false)
                    }}
                    className={`cursor-pointer rounded-[1.2rem] border px-4 py-3.5 transition-all outline-none ${
                      selected
                        ? 'border-accent/20 bg-accent-soft/[0.8] shadow-float ring-1 ring-accent/10'
                        : unread
                          ? 'border-accent/15 bg-accent-soft/[0.45] hover:border-accent/20 hover:bg-accent-soft/[0.58]'
                          : 'border-bd bg-surface-elevated/[0.88] hover:border-bd-strong hover:bg-surface-elevated/[0.96]'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          void handleStar(email)
                        }}
                        className="mt-0.5 shrink-0 rounded-full border border-transparent px-2 py-1 text-sm transition hover:border-warning/20 hover:bg-warning/10"
                        aria-label={email.is_starred ? '取消星标' : '加星'}
                      >
                        {email.is_starred ? '⭐' : '☆'}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`flex-1 truncate text-sm ${unread ? 'font-semibold text-tx' : 'text-tx-sub'}`}>
                            {email.from_name || email.from_addr}
                          </span>
                          <span className="shrink-0 text-xs text-tx-faint">{formatDate(email.date)}</span>
                        </div>
                        <div className={`mt-1 truncate text-sm ${unread ? 'font-medium text-tx-sub' : 'text-tx-muted'}`}>
                          {email.subject || '(无主题)'}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-tx-muted">
                          <span className="truncate">{email.snippet}</span>
                          {email.has_attachments && <span className="shrink-0">📎</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      )}

      <section className={`flex min-h-[420px] min-w-0 flex-col overflow-hidden ${shellPanelClass}`}>
        {selectedEmail ? (
          <>
            <div className="border-b border-bd/70 px-5 py-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Message Detail</div>
                  <h2 className="mt-2 text-[1.65rem] font-semibold tracking-[-0.04em] text-tx">{selectedEmail.subject || '(无主题)'}</h2>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-tx-muted">
                    <span className="rounded-full border border-bd bg-page/[0.55] px-3 py-1 text-tx-sub">
                      {selectedEmail.from_name || selectedEmail.from_addr}
                    </span>
                    <span className="rounded-full border border-bd bg-page/[0.55] px-3 py-1">{selectedEmail.from_addr}</span>
                    <span className="rounded-full border border-bd bg-page/[0.55] px-3 py-1">
                      {selectedEmail.date ? new Date(selectedEmail.date).toLocaleString('zh-CN') : ''}
                    </span>
                  </div>
                  {selectedEmail.to_addrs.length > 0 && (
                    <div className="mt-3 text-xs leading-6 text-tx-muted">
                      收件人：{selectedEmail.to_addrs.map((address) => (address.name ? `${address.name} <${address.addr}>` : address.addr)).join(', ')}
                    </div>
                  )}
                  {selectedEmail.cc_addrs.length > 0 && (
                    <div className="text-xs leading-6 text-tx-muted">
                      抄送：{selectedEmail.cc_addrs.map((address) => (address.name ? `${address.name} <${address.addr}>` : address.addr)).join(', ')}
                    </div>
                  )}
                  {selectedEmail.attachments_meta.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {selectedEmail.attachments_meta.map((attachment, index) => (
                        <span key={index} className="rounded-full border border-bd bg-page/[0.55] px-3 py-1 text-xs text-tx-muted">
                          📎 {attachment.filename} ({(attachment.size / 1024).toFixed(1)}KB)
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>
                  <button
                    onClick={() => {
                      setReplyTo(selectedEmail)
                      setComposing(true)
                    }}
                    className={secondaryButtonClass}
                  >
                    回复
                  </button>
                  <button
                    onClick={() => {
                      setReplyTo(null)
                      setComposing(true)
                    }}
                    className={secondaryButtonClass}
                  >
                    转发
                  </button>
                  <button onClick={() => void handleMarkUnread(selectedEmail.id)} className={secondaryButtonClass}>
                    标记未读
                  </button>
                  <div className="relative">
                    <button
                      onClick={(event) => {
                        event.stopPropagation()
                        setShowMoveMenu((value) => !value)
                      }}
                      className={secondaryButtonClass}
                    >
                      移动到
                    </button>
                    {showMoveMenu && (
                      <div className="absolute left-0 top-full z-20 mt-2 min-w-[180px] rounded-[1rem] border border-bd bg-surface/[0.98] p-1 shadow-float" onClick={(event) => event.stopPropagation()}>
                        {folders.filter((folder) => folder.id !== selectedEmail.folder_id).map((folder) => (
                          <button
                            key={folder.id}
                            onClick={() => void handleMoveEmail(selectedEmail.id, folder.id)}
                            className="w-full rounded-[0.9rem] px-3 py-2 text-left text-sm text-tx-sub transition hover:bg-page/[0.7]"
                          >
                            {FOLDER_ICONS[folder.folder_type] || '📁'} {folder.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => void handleDelete(selectedEmail.id)}
                    className="rounded-[1rem] border border-danger/25 bg-danger/10 px-3 py-2 text-xs font-medium text-danger transition hover:bg-danger/15"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto bg-page/[0.28] p-5">
              <div className={`${sectionCardClass} min-h-full p-6 lg:p-8`}>
                {selectedEmail.body_html ? (
                  <div
                    className={proseClass}
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(selectedEmail.body_html, {
                        ADD_TAGS: ['img'],
                        ADD_ATTR: ['src', 'alt', 'width', 'height', 'style'],
                        ALLOW_DATA_ATTR: false,
                        ALLOWED_URI_REGEXP: /^(?:(?:https?|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
                      }),
                    }}
                  />
                ) : (
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-tx">{selectedEmail.body_text}</pre>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            <div className={`${sectionCardClass} w-full max-w-2xl px-8 py-12 text-center`}>
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Message Detail</div>
              <div className="mt-5 text-5xl">📬</div>
              <div className="mt-5 text-xl font-medium text-tx-sub">选择一封邮件查看详情</div>
              <p className="mt-3 text-sm leading-7 text-tx-faint">中间列表负责筛选和切换，右侧专注阅读正文、附件与后续动作；需要发信时，也可以直接新建邮件。</p>
              <button
                onClick={(event) => {
                  event.stopPropagation()
                  setComposing(true)
                  setReplyTo(null)
                }}
                className={`${primaryButtonClass} mt-6 px-5 py-3 text-sm`}
              >
                写新邮件
              </button>
            </div>
          </div>
        )}
      </section>

      <EmailAccountDialog
        open={showAccountDialog}
        onClose={() => {
          setShowAccountDialog(false)
          setEditingAccount(null)
        }}
        onSaved={() => {
          void loadAccounts(!editingAccount)
          void loadFolders()
        }}
        account={editingAccount}
      />

      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCtxMenu(null)} />
          <div className={menuClass} style={{ left: ctxMenu.x, top: ctxMenu.y }} onClick={(event) => event.stopPropagation()}>
            <button onClick={() => void handleFolderReadAll(ctxMenu.folder.id)} className="w-full rounded-[0.9rem] px-4 py-2 text-left text-sm text-tx-sub transition hover:bg-page/[0.7]">
              全部已读
            </button>
            <button onClick={() => void handleToggleMute(ctxMenu.folder.id)} className="w-full rounded-[0.9rem] px-4 py-2 text-left text-sm text-tx-sub transition hover:bg-page/[0.7]">
              {ctxMenu.folder.is_muted ? '取消静音' : '静音（不显示未读）'}
            </button>
            {ctxMenu.folder.folder_type === 'custom' && (
              <>
                <div className="my-1 border-t border-bd/60" />
                <button
                  onClick={() => {
                    setRenamingFolderId(ctxMenu.folder.id)
                    setRenameValue(ctxMenu.folder.name)
                    setCtxMenu(null)
                  }}
                  className="w-full rounded-[0.9rem] px-4 py-2 text-left text-sm text-tx-sub transition hover:bg-page/[0.7]"
                >
                  重命名
                </button>
                <button onClick={() => void handleDeleteFolder(ctxMenu.folder)} className="w-full rounded-[0.9rem] px-4 py-2 text-left text-sm text-danger transition hover:bg-danger/10">
                  删除文件夹
                </button>
              </>
            )}
            <div className="my-1 border-t border-bd/60" />
            <button
              onClick={() => {
                setCtxMenu(null)
                setShowCreateFolder(true)
              }}
              className="w-full rounded-[0.9rem] px-4 py-2 text-left text-sm text-tx-sub transition hover:bg-page/[0.7]"
            >
              新建文件夹
            </button>
          </div>
        </>
      )}

      {emailCtxMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setEmailCtxMenu(null); setEmailCtxMoveOpen(false) }} />
          <div className={menuClass} style={{ left: emailCtxMenu.x, top: emailCtxMenu.y }} onClick={(event) => event.stopPropagation()}>
            <button
              onClick={async () => {
                const isRead = !emailCtxMenu.email.is_read
                await markEmailRead(emailCtxMenu.email.id, isRead)
                setEmails((prev) => prev.map((email) => (email.id === emailCtxMenu.email.id ? { ...email, is_read: isRead } : email)))
                if (selectedEmail?.id === emailCtxMenu.email.id) {
                  setSelectedEmail((prev) => (prev ? { ...prev, is_read: isRead } : prev))
                }
                void loadFolders()
                setEmailCtxMenu(null)
              }}
              className="w-full rounded-[0.9rem] px-4 py-2 text-left text-sm text-tx-sub transition hover:bg-page/[0.7]"
            >
              {emailCtxMenu.email.is_read ? '标记未读' : '标记已读'}
            </button>
            <button
              onClick={async () => {
                const isStarred = !emailCtxMenu.email.is_starred
                await markEmailStar(emailCtxMenu.email.id, isStarred)
                setEmails((prev) => prev.map((email) => (email.id === emailCtxMenu.email.id ? { ...email, is_starred: isStarred } : email)))
                setEmailCtxMenu(null)
              }}
              className="w-full rounded-[0.9rem] px-4 py-2 text-left text-sm text-tx-sub transition hover:bg-page/[0.7]"
            >
              {emailCtxMenu.email.is_starred ? '取消星标' : '加星'}
            </button>
            <div className="my-1 border-t border-bd/60" />
            <button
              onClick={async () => {
                const detail = await getEmailDetail(emailCtxMenu.email.id)
                setReplyTo(detail)
                setComposing(true)
                setEmailCtxMenu(null)
              }}
              className="w-full rounded-[0.9rem] px-4 py-2 text-left text-sm text-tx-sub transition hover:bg-page/[0.7]"
            >
              回复
            </button>
            <button
              onClick={() => setEmailCtxMoveOpen((value) => !value)}
              className="flex w-full items-center justify-between rounded-[0.9rem] px-4 py-2 text-left text-sm text-tx-sub transition hover:bg-page/[0.7]"
            >
              <span>移动到</span>
              <span className="text-xs opacity-50">{emailCtxMoveOpen ? '▲' : '▼'}</span>
            </button>
            {emailCtxMoveOpen && (
              <div className="max-h-48 overflow-auto border-t border-bd/60 pt-1">
                {folders.filter((folder) => folder.id !== emailCtxMenu.email.folder_id).map((folder) => (
                  <button
                    key={folder.id}
                    onClick={async () => {
                      await moveEmail(emailCtxMenu.email.id, folder.id)
                      setEmails((prev) => prev.filter((email) => email.id !== emailCtxMenu.email.id))
                      if (selectedEmail?.id === emailCtxMenu.email.id) setSelectedEmail(null)
                      void loadFolders()
                      setEmailCtxMenu(null)
                    }}
                    className="w-full rounded-[0.9rem] pl-6 pr-4 py-1.5 text-left text-sm text-tx-sub transition hover:bg-page/[0.7]"
                  >
                    {FOLDER_ICONS[folder.folder_type] || '📁'} {folder.name}
                  </button>
                ))}
              </div>
            )}
            <div className="my-1 border-t border-bd/60" />
            <button
              onClick={async () => {
                await handleDelete(emailCtxMenu.email.id)
                setEmailCtxMenu(null)
              }}
              className="w-full rounded-[0.9rem] px-4 py-2 text-left text-sm text-danger transition hover:bg-danger/10"
            >
              删除
            </button>
          </div>
        </>
      )}

      {renamingFolderId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => setRenamingFolderId(null)}>
          <div className="w-full max-w-sm rounded-[1.4rem] border border-bd bg-surface/[0.98] p-6 shadow-float" onClick={(event) => event.stopPropagation()}>
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Rename Folder</div>
            <h3 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-tx">重命名文件夹</h3>
            <input
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void handleRenameFolder(renamingFolderId)
                }
              }}
              placeholder="新文件夹名称"
              className={`${fieldClass} mt-5`}
            />
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setRenamingFolderId(null)} className={secondaryButtonClass}>取消</button>
              <button onClick={() => void handleRenameFolder(renamingFolderId)} disabled={!renameValue.trim()} className={primaryButtonClass}>确定</button>
            </div>
          </div>
        </div>
      )}

      {showCreateFolder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => setShowCreateFolder(false)}>
          <div className="w-full max-w-sm rounded-[1.4rem] border border-bd bg-surface/[0.98] p-6 shadow-float" onClick={(event) => event.stopPropagation()}>
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Create Folder</div>
            <h3 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-tx">新建文件夹</h3>
            <input
              autoFocus
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void handleCreateFolder()
                }
              }}
              placeholder="文件夹名称"
              className={`${fieldClass} mt-5`}
            />
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setShowCreateFolder(false)} className={secondaryButtonClass}>取消</button>
              <button onClick={() => void handleCreateFolder()} disabled={creatingFolder || !newFolderName.trim()} className={primaryButtonClass}>
                {creatingFolder ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface ContactsPanelProps {
  onClose: () => void
  getEmailContacts: (q?: string) => Promise<EmailContact[]>
  createEmailContact: (body: { email: string; name?: string; notes?: string }) => Promise<EmailContact>
  updateEmailContact: (id: number, body: { name?: string; notes?: string }) => Promise<EmailContact>
  deleteEmailContact: (id: number) => Promise<void>
}

function ContactsPanel({ onClose, getEmailContacts, createEmailContact, updateEmailContact, deleteEmailContact }: ContactsPanelProps) {
  const [contacts, setContacts] = useState<EmailContact[]>([])
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [adding, setAdding] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)

  const load = async (query?: string) => {
    const data = await getEmailContacts(query || undefined)
    setContacts(data)
  }

  useEffect(() => {
    void load(search)
  }, [search])

  const startEdit = (contact: EmailContact) => {
    setEditingId(contact.id)
    setEditName(contact.name)
    setEditNotes(contact.notes)
  }

  const saveEdit = async (id: number) => {
    setSaving(true)
    try {
      const updated = await updateEmailContact(id, { name: editName, notes: editNotes })
      setContacts((prev) => prev.map((contact) => (contact.id === id ? updated : contact)))
      setEditingId(null)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除该联系人？')) return
    await deleteEmailContact(id)
    setContacts((prev) => prev.filter((contact) => contact.id !== id))
  }

  const handleAdd = async () => {
    if (!newEmail.trim()) return
    setSaving(true)
    try {
      const contact = await createEmailContact({ email: newEmail.trim(), name: newName.trim() || undefined })
      setContacts((prev) => [contact, ...prev])
      setAdding(false)
      setNewEmail('')
      setNewName('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={`flex min-h-[360px] flex-col overflow-hidden ${shellPanelClass}`} onClick={(event) => event.stopPropagation()}>
      <div className="border-b border-bd/70 px-5 py-5">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className={secondaryButtonClass}>返回</button>
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">Contacts</div>
            <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-tx">联系人</h2>
          </div>
          <button onClick={() => setAdding((value) => !value)} className={`ml-auto ${primaryButtonClass}`}>
            {adding ? '收起' : '添加'}
          </button>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className={`${sectionCardClass} p-3`}>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索联系人..."
            className={fieldClass}
          />
        </div>

        {adding && (
          <div className={`${sectionCardClass} space-y-3 p-4`}>
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tx-faint">New Contact</div>
            <input
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              placeholder="邮箱地址 *"
              className={fieldClass}
            />
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="显示名称（可选）"
              className={fieldClass}
            />
            <div className="flex gap-2">
              <button onClick={() => void handleAdd()} disabled={saving || !newEmail.trim()} className={`${primaryButtonClass} flex-1`}>
                {saving ? '保存中...' : '保存'}
              </button>
              <button onClick={() => setAdding(false)} className={`${secondaryButtonClass} flex-1`}>
                取消
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        {contacts.length === 0 && <div className="rounded-[1.2rem] border border-dashed border-bd px-4 py-10 text-center text-sm text-tx-faint">暂无联系人</div>}

        <div className="space-y-3">
          {contacts.map((contact) => (
            <div key={contact.id} className={`${sectionCardClass} p-4`}>
              {editingId === contact.id ? (
                <div className="space-y-3">
                  <input value={editName} onChange={(event) => setEditName(event.target.value)} placeholder="显示名称" className={fieldClass} />
                  <input value={editNotes} onChange={(event) => setEditNotes(event.target.value)} placeholder="备注" className={fieldClass} />
                  <div className="flex gap-2">
                    <button onClick={() => void saveEdit(contact.id)} disabled={saving} className={`${primaryButtonClass} flex-1`}>保存</button>
                    <button onClick={() => setEditingId(null)} className={`${secondaryButtonClass} flex-1`}>取消</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-accent/25 bg-accent-soft/[0.8] text-sm font-semibold text-accent">
                    {(contact.name || contact.email)[0].toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-tx-sub">{contact.name || contact.email}</span>
                      {contact.is_auto && <span className="rounded-full border border-bd px-2 py-0.5 text-[11px] text-tx-faint">自动</span>}
                    </div>
                    {contact.name && <div className="mt-1 truncate text-xs text-tx-muted">{contact.email}</div>}
                    {contact.send_count > 0 && <div className="mt-1 text-[11px] text-tx-faint">已发 {contact.send_count} 次</div>}
                    {contact.notes && <div className="mt-2 text-xs leading-6 text-tx-muted">{contact.notes}</div>}
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    <button onClick={() => startEdit(contact)} className={secondaryButtonClass}>编辑</button>
                    <button onClick={() => void handleDelete(contact.id)} className="rounded-[1rem] border border-danger/25 bg-danger/10 px-3 py-2 text-xs font-medium text-danger transition hover:bg-danger/15">删除</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
