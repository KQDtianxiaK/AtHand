const BASE = ''

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...options.headers,
    },
  })
  if (res.status === 401) {
    localStorage.removeItem('token')
    window.location.href = '/login'
    throw new Error('Unauthorized')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `HTTP ${res.status}`)
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T
  }
  return res.json()
}

// ---- Auth ----
export async function login(password: string) {
  const data = await request<{ access_token: string }>('/api/auth/login/json', {
    method: 'POST',
    body: JSON.stringify({ password }),
  })
  localStorage.setItem('token', data.access_token)
  return data
}

// ---- Machines ----
export interface Machine {
  id: string
  name: string
  machine_type: string
  os_info: string | null
  is_online: boolean
  last_heartbeat: string | null
}

export function getMachines() {
  return request<Machine[]>('/api/agents/machines')
}

// ---- Tasks ----
export interface Task {
  id: number
  machine_id: string
  prompt: string
  work_dir: string | null
  mode: string
  status: string
  exit_code: number | null
  session_id: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export interface TaskMessage {
  id: number
  task_id: number
  role: string
  content: string | null
  tool_calls: string | null
  tool_call_id: string | null
  created_at: string
}

export function createTask(body: { machine_id: string; prompt: string; work_dir?: string; mode?: string; session_id?: string }) {
  return request<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(body) })
}

export function getTasks(params?: { machine_id?: string; status?: string; limit?: number }) {
  const sp = new URLSearchParams()
  if (params?.machine_id) sp.set('machine_id', params.machine_id)
  if (params?.status) sp.set('status', params.status)
  if (params?.limit) sp.set('limit', String(params.limit))
  return request<Task[]>(`/api/tasks?${sp}`)
}

export function getTaskMessages(taskId: number) {
  return request<TaskMessage[]>(`/api/tasks/${taskId}/messages`)
}

export function getSessionMessages(sessionId: string) {
  return request<TaskMessage[]>(`/api/tasks/session/${sessionId}/messages`)
}

export function deleteTask(taskId: number) {
  return request<{ ok: boolean }>(`/api/tasks/${taskId}`, { method: 'DELETE' })
}

export function deleteSession(sessionId: string) {
  return request<{ ok: boolean }>(`/api/tasks/session/${sessionId}`, { method: 'DELETE' })
}

export function killOrphanKimi(machineId: string) {
  return request<{ killed_count: number; killed_pids: number[]; tracked_count: number }>(
    `/api/tasks/kill-orphan-kimi?machine_id=${encodeURIComponent(machineId)}`,
    { method: 'POST' }
  )
}

// ---- AI Control Bridge ----
export interface AiControlMachine {
  id: string
  name: string
  machine_type: string
  os_info: string | null
  is_online: boolean
  daemon_reachable: boolean
  daemon_url: string | null
  runtime_kind: string
  last_heartbeat: string | null
  last_daemon_seen_at: string | null
}

export interface AiControlProviderMode {
  id: string
  label: string
  description: string | null
  icon: string | null
  color_tier: string | null
}

export interface AiControlProviderModel {
  id: string
  label: string
  description: string | null
  is_default: boolean
}

export interface AiControlSelectOption {
  id: string
  label: string
  description: string | null
  is_default: boolean
}

export type AiControlFeature =
  | {
      type: 'toggle'
      id: string
      label: string
      description: string | null
      value: boolean
    }
  | {
      type: 'select'
      id: string
      label: string
      description: string | null
      value: string | null
      options: AiControlSelectOption[]
    }

export interface AiControlProvider {
  id: string
  label: string
  description: string | null
  status: 'ready' | 'loading' | 'error' | 'unavailable'
  default_mode_id: string | null
  modes: AiControlProviderMode[]
  models: AiControlProviderModel[]
  features: AiControlFeature[]
  error: string | null
  fetched_at: string | null
}

export interface AiControlProvidersResponse {
  machine: AiControlMachine
  providers: AiControlProvider[]
  snapshot_version: string | null
  fetched_at: string
}

export interface AiControlPersistenceHandle {
  provider: string
  session_id: string
  native_handle?: string | null
  metadata?: Record<string, unknown>
}

export interface AiControlCapabilities {
  supports_streaming: boolean
  supports_session_persistence: boolean
  supports_dynamic_modes: boolean
  supports_mcp_servers: boolean
  supports_reasoning_stream: boolean
  supports_tool_invocations: boolean
}

export interface AiControlSession {
  agent_id: string
  machine_id: string
  provider: string
  cwd: string
  title: string | null
  status: string
  mode_id: string | null
  model: string | null
  created_at: string
  updated_at: string
  attention: boolean
  persistence_handle: AiControlPersistenceHandle | null
  capabilities: AiControlCapabilities | null
}

export interface AiControlTimelineItem {
  id: string
  kind: string
  created_at: string
  seq?: number | null
  role?: string | null
  text?: string | null
  status?: string | null
  provider?: string | null
  tool_name?: string | null
  tool_call_id?: string | null
  arguments?: Record<string, unknown> | null
  result?: Record<string, unknown> | null
  usage?: Record<string, unknown> | null
  metadata: Record<string, unknown>
}

export interface AiControlTimelinePage {
  items: AiControlTimelineItem[]
  next_cursor: string | null
  prev_cursor: string | null
  has_more_before: boolean
  has_more_after: boolean
}

export interface AiControlTimelineResponse {
  session: AiControlSession
  page: AiControlTimelinePage
}

export interface AiControlHistoryItem {
  agent_id: string
  machine_id: string
  provider: string
  title: string | null
  cwd: string
  status: string
  created_at: string
  updated_at: string
  last_message_preview: string | null
  attention: boolean
  persistence_handle: AiControlPersistenceHandle | null
}

export interface AiControlHistoryResponse {
  items: AiControlHistoryItem[]
  next_cursor: string | null
}

export interface AiControlPermissionResponseBody {
  behavior: 'allow' | 'deny'
  selected_action_id?: string
  message?: string
  interrupt?: boolean
  updated_input?: Record<string, unknown>
  updated_permissions?: Record<string, unknown>[]
}

export interface AiControlPermissionResponseResult {
  ok: boolean
  resolved: {
    request_id: string
    agent_id: string
    behavior: 'allow' | 'deny'
    selected_action_id: string | null
  } | null
}

export function getAiControlMachines() {
  return request<AiControlMachine[]>('/api/ai-control/machines')
}

export function getAiControlProviders(machineId: string, cwd?: string) {
  const sp = new URLSearchParams({ machine_id: machineId })
  if (cwd) sp.set('cwd', cwd)
  return request<AiControlProvidersResponse>(`/api/ai-control/providers?${sp}`)
}

export function createAiControlSession(body: {
  machine_id: string
  provider: string
  cwd: string
  initial_prompt: string
  mode_id?: string
  model?: string
  thinking_option_id?: string
  title?: string
  labels?: Record<string, string>
  feature_values?: Record<string, unknown>
  approval_policy?: string
  sandbox_mode?: string
  network_access?: boolean
  web_search?: boolean
  mcp_servers?: Record<string, Record<string, unknown>>
}) {
  return request<AiControlSession>('/api/ai-control/sessions', { method: 'POST', body: JSON.stringify(body) })
}

export function getAiControlSession(agentId: string, machineId?: string) {
  const sp = new URLSearchParams()
  if (machineId) sp.set('machine_id', machineId)
  const suffix = sp.toString() ? `?${sp}` : ''
  return request<AiControlSession>(`/api/ai-control/sessions/${encodeURIComponent(agentId)}${suffix}`)
}

export function sendAiControlMessage(agentId: string, body: {
  text: string
  client_message_id?: string
  attachments?: Record<string, unknown>[]
  images?: { mimeType: string; data: string }[]
}, machineId?: string) {
  const sp = new URLSearchParams()
  if (machineId) sp.set('machine_id', machineId)
  const suffix = sp.toString() ? `?${sp}` : ''
  return request<{ accepted: boolean; requestId: string; agentId: string }>(
    `/api/ai-control/sessions/${encodeURIComponent(agentId)}/messages${suffix}`,
    { method: 'POST', body: JSON.stringify(body) }
  )
}

export function resumeAiControlSession(agentId: string, body: {
  machine_id: string
  handle: AiControlPersistenceHandle
  overrides?: Record<string, unknown>
}) {
  return request<AiControlSession>(
    `/api/ai-control/sessions/${encodeURIComponent(agentId)}/resume`,
    { method: 'POST', body: JSON.stringify(body) }
  )
}

export function getAiControlTimeline(
  agentId: string,
  params?: {
    cursor?: string
    direction?: 'backward' | 'forward'
    limit?: number
    projection?: 'full' | 'messages' | 'summary'
    machine_id?: string
  }
) {
  const sp = new URLSearchParams()
  if (params?.machine_id) sp.set('machine_id', params.machine_id)
  if (params?.cursor) sp.set('cursor', params.cursor)
  if (params?.direction) sp.set('direction', params.direction)
  if (params?.limit) sp.set('limit', String(params.limit))
  if (params?.projection) sp.set('projection', params.projection)
  const suffix = sp.toString() ? `?${sp}` : ''
  return request<AiControlTimelineResponse>(`/api/ai-control/sessions/${encodeURIComponent(agentId)}/timeline${suffix}`)
}

export function getAiControlHistory(params?: {
  machine_id?: string
  provider?: string
  status?: string
  cursor?: string
  limit?: number
}) {
  const sp = new URLSearchParams()
  if (params?.machine_id) sp.set('machine_id', params.machine_id)
  if (params?.provider) sp.set('provider', params.provider)
  if (params?.status) sp.set('status', params.status)
  if (params?.cursor) sp.set('cursor', params.cursor)
  if (params?.limit) sp.set('limit', String(params.limit))
  return request<AiControlHistoryResponse>(`/api/ai-control/history?${sp}`)
}

export function respondAiControlPermission(
  agentId: string,
  requestId: string,
  body: AiControlPermissionResponseBody,
  machineId?: string,
) {
  const sp = new URLSearchParams()
  if (machineId) sp.set('machine_id', machineId)
  const suffix = sp.toString() ? `?${sp}` : ''
  return request<AiControlPermissionResponseResult>(
    `/api/ai-control/permissions/${encodeURIComponent(agentId)}/${encodeURIComponent(requestId)}${suffix}`,
    { method: 'POST', body: JSON.stringify(body) }
  )
}

// ---- Memos ----
export interface Memo {
  id: number
  title: string
  content: string
  tags: string
  is_pinned: boolean
  is_archived: boolean
  created_at: string
  updated_at: string
}

export function getMemos(archived = false, search?: string) {
  const sp = new URLSearchParams({ archived: String(archived) })
  if (search) sp.set('search', search)
  return request<Memo[]>(`/api/memos?${sp}`)
}

export function createMemo(body: { title?: string; content?: string; tags?: string }) {
  return request<Memo>('/api/memos', { method: 'POST', body: JSON.stringify(body) })
}

export function updateMemo(id: number, body: Partial<Memo>) {
  return request<Memo>(`/api/memos/${id}`, { method: 'PUT', body: JSON.stringify(body) })
}

export function deleteMemo(id: number) {
  return request<{ ok: boolean }>(`/api/memos/${id}`, { method: 'DELETE' })
}

// ---- Todos ----
export interface Todo {
  id: number
  title: string
  description: string
  priority: number
  tags: string
  due_date: string | null
  is_done: boolean
  done_at: string | null
  is_important: boolean
  my_day_date: string | null
  sort_order: number
  list_id: number | null
  recurrence: string | null
  created_at: string
  updated_at: string
}

export interface TodoList {
  id: number
  name: string
  emoji: string
  sort_order: number
  created_at: string
}

export function getTodos(params?: { view?: string; isDone?: boolean }) {
  const sp = new URLSearchParams()
  if (params?.view) sp.set('view', params.view)
  if (params?.isDone !== undefined) sp.set('is_done', String(params.isDone))
  return request<Todo[]>(`/api/todos?${sp}`)
}

export function createTodo(body: {
  title: string
  description?: string
  priority?: number
  due_date?: string
  is_important?: boolean
  my_day?: boolean
  list_id?: number
}) {
  return request<Todo>('/api/todos', { method: 'POST', body: JSON.stringify(body) })
}

export function updateTodo(id: number, body: Partial<Todo>) {
  return request<Todo>(`/api/todos/${id}`, { method: 'PUT', body: JSON.stringify(body) })
}

export function toggleImportant(id: number) {
  return request<Todo>(`/api/todos/${id}/toggle-important`, { method: 'PUT' })
}

export function toggleMyDay(id: number) {
  return request<Todo>(`/api/todos/${id}/toggle-myday`, { method: 'PUT' })
}

export function deleteTodo(id: number) {
  return request<{ ok: boolean }>(`/api/todos/${id}`, { method: 'DELETE' })
}

// ---- Todo Lists ----
export function getTodoLists() {
  return request<TodoList[]>('/api/todos/lists')
}

export function createTodoList(body: { name: string; emoji?: string }) {
  return request<TodoList>('/api/todos/lists', { method: 'POST', body: JSON.stringify(body) })
}

export function updateTodoList(id: number, body: Partial<TodoList>) {
  return request<TodoList>(`/api/todos/lists/${id}`, { method: 'PUT', body: JSON.stringify(body) })
}

export function deleteTodoList(id: number) {
  return request<{ ok: boolean }>(`/api/todos/lists/${id}`, { method: 'DELETE' })
}

// ---- Clock ----
export type ClockPeriod = 'morning' | 'afternoon' | 'evening'

export interface ClockRecord {
  id: number
  clock_in: string
  clock_out: string | null
  note: string
  period: ClockPeriod
  created_at: string
}

export function clockIn(period: ClockPeriod, note = '', clockTime?: string) {
  return request<ClockRecord>('/api/clock/in', { method: 'POST', body: JSON.stringify({ note, period, clock_time: clockTime ?? null }) })
}

export function clockOut(period: ClockPeriod, clockTime?: string) {
  return request<ClockRecord>('/api/clock/out', { method: 'POST', body: JSON.stringify({ period, clock_time: clockTime ?? null }) })
}

export function getCurrentClock() {
  return request<ClockRecord[]>('/api/clock/current')
}

export function getClockRecords(days = 30) {
  return request<ClockRecord[]>(`/api/clock/records?days=${days}`)
}

export function deleteClockRecord(id: number) {
  return request<void>(`/api/clock/records/${id}`, { method: 'DELETE' })
}

export function clearAllClockRecords() {
  return request<void>('/api/clock/records', { method: 'DELETE' })
}

// ---- Stats ----
export interface DailyWorkHours {
  day: string
  morning: number
  afternoon: number
  evening: number
  total: number
}

export interface StatsOverview {
  total_tasks: number
  done_tasks: number
  failed_tasks: number
  success_rate: number
  daily_tasks: { day: string; count: number }[]
  machine_tasks: { machine_id: string; count: number }[]
  total_work_hours: number
  daily_work_hours: DailyWorkHours[]
}

export function getStats(days = 7) {
  return request<StatsOverview>(`/api/stats/overview?days=${days}`)
}

// ---- WebSocket ----
export function connectDashboardWS(onMessage: (data: any) => void): WebSocket {
  const token = localStorage.getItem('token') || ''
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(`${proto}//${window.location.host}/ws/dashboard?token=${token}`)
  ws.onmessage = (ev) => {
    try {
      onMessage(JSON.parse(ev.data))
    } catch {}
  }
  return ws
}

// ---- Kimi Local Sessions ----
export interface KimiSession {
  session_id: string
  title: string
  has_data: boolean
  archived: boolean
  mtime: number
}

export interface KimiWorkDir {
  work_dir: string
  dir_hash: string
  sessions: KimiSession[]
}

export interface KimiSessionMessage {
  role: string
  content: string | null
  tool_calls?: string | null
  tool_call_id?: string | null
  timestamp?: number | null
}

export function getKimiWorkDirs() {
  return request<KimiWorkDir[]>('/api/kimi-sessions')
}

export function getKimiSessionMessages(dirHash: string, sessionId: string) {
  return request<{ session_id: string; title: string; work_dir: string | null; messages: KimiSessionMessage[] }>(
    `/api/kimi-sessions/${dirHash}/${sessionId}/messages`
  )
}

export function resolveKimiSession(sessionId: string) {
  return request<{ session_id: string; title: string; messages: KimiSessionMessage[] }>(
    `/api/kimi-sessions/resolve/${sessionId}`
  )
}

// ---- AI Assistant ----
export interface AISettings {
  api_base: string
  api_key_masked: string
  api_key_set: boolean
  model: string
}

export function getAISettings() {
  return request<AISettings>('/api/assistant/settings')
}

export function updateAISettings(body: { api_base?: string; api_key?: string; model?: string }) {
  return request<{ ok: boolean }>('/api/assistant/settings', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export interface AssistantSSEEvent {
  type: 'meta' | 'text' | 'tool_call' | 'tool_result' | 'done' | 'error' | 'email_confirm_required'
  conversation_id?: string
  content?: string
  name?: string
  arguments?: string
  result?: string
  message?: string
}

export async function sendAssistantMessage(
  message: string,
  conversationId: string | undefined,
  onEvent: (event: AssistantSSEEvent) => void,
) {
  const res = await fetch('/api/assistant/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ message, conversation_id: conversationId }),
  })

  if (res.status === 401) {
    localStorage.removeItem('token')
    window.location.href = '/login'
    return
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    onEvent({ type: 'error', message: body.detail || `HTTP ${res.status}` })
    return
  }

  const reader = res.body?.getReader()
  if (!reader) return

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const event = JSON.parse(line.slice(6)) as AssistantSSEEvent
          onEvent(event)
        } catch {}
      }
    }
  }
}

export function clearAssistantConversation(conversationId: string) {
  return request<{ ok: boolean }>('/api/assistant/clear', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: conversationId }),
  })
}

// ---- Email ----
export interface EmailAccount {
  id: number
  email: string
  display_name: string
  protocol: string  // 'imap' | 'pop3'
  imap_host: string
  imap_port: number
  pop3_host: string
  pop3_port: number
  smtp_host: string
  smtp_port: number
  username: string
  use_ssl: boolean
  sync_interval_minutes: number
  last_sync_at: string | null
  is_active: boolean
  created_at: string
}

export interface EmailFolder {
  id: number
  account_id: number
  name: string
  remote_name: string
  folder_type: string
  unread_count: number
  total_count: number
  sort_order: number
  is_muted: boolean
}

export interface EmailBrief {
  id: number
  account_id: number
  folder_id: number
  subject: string
  from_addr: string
  from_name: string
  date: string | null
  snippet: string
  is_read: boolean
  is_starred: boolean
  has_attachments: boolean
}

export interface EmailDetail {
  id: number
  account_id: number
  folder_id: number
  message_id: string
  subject: string
  from_addr: string
  from_name: string
  to_addrs: { name: string; addr: string }[]
  cc_addrs: { name: string; addr: string }[]
  bcc_addrs: { name: string; addr: string }[]
  date: string | null
  body_text: string
  body_html: string
  attachments_meta: { filename: string; size: number; content_type: string }[]
  is_read: boolean
  is_starred: boolean
  is_draft: boolean
  in_reply_to: string | null
  references_header: string | null
  created_at: string
}

export function getEmailAccounts() {
  return request<EmailAccount[]>('/api/email/accounts')
}

export function createEmailAccount(body: {
  email: string; display_name?: string
  protocol?: string
  imap_host?: string; imap_port?: number
  pop3_host?: string; pop3_port?: number
  smtp_host: string; smtp_port?: number
  username: string; password: string
  use_ssl?: boolean; sync_interval_minutes?: number
}) {
  return request<EmailAccount>('/api/email/accounts', { method: 'POST', body: JSON.stringify(body) })
}

export function updateEmailAccount(id: number, body: Record<string, unknown>) {
  return request<EmailAccount>(`/api/email/accounts/${id}`, { method: 'PUT', body: JSON.stringify(body) })
}

export function deleteEmailAccount(id: number) {
  return request<{ ok: boolean }>(`/api/email/accounts/${id}`, { method: 'DELETE' })
}

export function testEmailConnection(body: {
  protocol?: string
  imap_host?: string; imap_port?: number
  pop3_host?: string; pop3_port?: number
  smtp_host: string; smtp_port: number
  username: string; password: string; use_ssl: boolean
}) {
  return request<Record<string, string>>('/api/email/accounts/test', { method: 'POST', body: JSON.stringify(body) })
}

export function triggerEmailSync(accountId: number) {
  return request<{ ok: boolean }>(`/api/email/accounts/${accountId}/sync`, { method: 'POST' })
}

export function getEmailFolders(accountId: number) {
  return request<EmailFolder[]>(`/api/email/accounts/${accountId}/folders`)
}

export function createEmailFolder(accountId: number, name: string) {
  return request<EmailFolder>(`/api/email/accounts/${accountId}/folders`, { method: 'POST', body: JSON.stringify({ name }) })
}

export function renameEmailFolder(folderId: number, name: string) {
  return request<EmailFolder>(`/api/email/folders/${folderId}/rename`, { method: 'PUT', body: JSON.stringify({ name }) })
}

export function deleteEmailFolder(folderId: number) {
  return request<{ ok: boolean }>(`/api/email/folders/${folderId}`, { method: 'DELETE' })
}

export function markFolderReadAll(folderId: number) {
  return request<{ ok: boolean }>(`/api/email/folders/${folderId}/read-all`, { method: 'POST' })
}

export function muteEmailFolder(folderId: number) {
  return request<{ ok: boolean; is_muted: boolean }>(`/api/email/folders/${folderId}/mute`, { method: 'PUT' })
}

export function getEmails(accountId: number, folderId?: number, search?: string, page = 1, pageSize = 50) {
  const params = new URLSearchParams({ account_id: String(accountId), page: String(page), page_size: String(pageSize) })
  if (folderId) params.set('folder_id', String(folderId))
  if (search) params.set('search', search)
  return request<EmailBrief[]>(`/api/email/emails?${params}`)
}

export function getEmailDetail(emailId: number) {
  return request<EmailDetail>(`/api/email/emails/${emailId}`)
}

export function markEmailRead(emailId: number, isRead: boolean) {
  return request<{ ok: boolean }>(`/api/email/emails/${emailId}/read`, { method: 'PUT', body: JSON.stringify({ is_read: isRead }) })
}

export function markEmailStar(emailId: number, isStarred: boolean) {
  return request<{ ok: boolean }>(`/api/email/emails/${emailId}/star`, { method: 'PUT', body: JSON.stringify({ is_starred: isStarred }) })
}

export function moveEmail(emailId: number, targetFolderId: number) {
  return request<{ ok: boolean }>(`/api/email/emails/${emailId}/move`, { method: 'PUT', body: JSON.stringify({ target_folder_id: targetFolderId }) })
}

export function deleteEmail(emailId: number) {
  return request<{ ok: boolean }>(`/api/email/emails/${emailId}`, { method: 'DELETE' })
}

export function sendEmailApi(body: {
  account_id: number; to_addrs: string[]; subject: string; body_text: string
  body_html?: string; cc_addrs?: string[]; bcc_addrs?: string[]
  in_reply_to?: string; references?: string
}) {
  return request<{ ok: boolean; message_id: string }>('/api/email/send', { method: 'POST', body: JSON.stringify(body) })
}

// ---- Email Contacts ----
export interface EmailContact {
  id: number
  email: string
  name: string
  notes: string
  is_auto: boolean
  send_count: number
  last_sent_at: string | null
  created_at: string
}

export function getEmailContacts(q?: string) {
  const sp = q ? `?q=${encodeURIComponent(q)}` : ''
  return request<EmailContact[]>(`/api/email/contacts${sp}`)
}

export function createEmailContact(body: { email: string; name?: string; notes?: string }) {
  return request<EmailContact>('/api/email/contacts', { method: 'POST', body: JSON.stringify(body) })
}

export function updateEmailContact(id: number, body: { name?: string; notes?: string }) {
  return request<EmailContact>(`/api/email/contacts/${id}`, { method: 'PUT', body: JSON.stringify(body) })
}

export function deleteEmailContact(id: number) {
  return request<{ ok: boolean }>(`/api/email/contacts/${id}`, { method: 'DELETE' })
}

// ---- News ----
export interface NewsSource {
  id: number
  name: string
  source_type: string
  url: string
  has_api_key: boolean
  config_json: string
  category: string
  enabled: boolean
  last_fetch_at: string | null
  created_at: string
}

export interface NewsItemData {
  id: number
  source_id: number
  source_name: string
  source_type: string
  title: string
  content: string
  summary: string
  original_url: string
  author: string
  published_at: string | null
  fetched_at: string
  item_type: string
  metadata_json: string
  is_read: boolean
}

export interface NewsDigestData {
  id: number
  date: string
  digest_type: string  // 'daily' | 'today'
  title: string
  content: string
  status: string
  item_count: number
  is_read: boolean
  generated_at: string | null
  created_at: string
}

export interface NewsSettingsData {
  fetch_time: string
  digest_time: string
  lookback_hours: number
  digest_prompt: string
  digest_language: string
  notification_enabled: boolean
  follow_builders_enabled: boolean
  timezone: string
}

export interface NewsStats {
  today_count: number
  total_count: number
  source_count: number
  latest_digest: NewsDigestData | null
}

// Sources
export function getNewsSources() {
  return request<NewsSource[]>('/api/news/sources')
}

export function createNewsSource(body: {
  name: string; source_type: string; url?: string; api_key?: string
  config_json?: string; category?: string; enabled?: boolean
}) {
  return request<NewsSource>('/api/news/sources', { method: 'POST', body: JSON.stringify(body) })
}

export function updateNewsSource(id: number, body: Record<string, unknown>) {
  return request<NewsSource>(`/api/news/sources/${id}`, { method: 'PUT', body: JSON.stringify(body) })
}

export function deleteNewsSource(id: number) {
  return request<{ ok: boolean }>(`/api/news/sources/${id}`, { method: 'DELETE' })
}

export function testNewsSource(id: number) {
  return request<{ status: string; message: string }>(`/api/news/sources/${id}/test`, { method: 'POST' })
}

// Items
export function getNewsItems(params?: {
  source_type?: string; item_type?: string; category?: string
  date?: string; is_read?: boolean; page?: number; page_size?: number
}) {
  const sp = new URLSearchParams()
  if (params?.source_type) sp.set('source_type', params.source_type)
  if (params?.item_type) sp.set('item_type', params.item_type)
  if (params?.category) sp.set('category', params.category)
  if (params?.date) sp.set('date', params.date)
  if (params?.is_read !== undefined) sp.set('is_read', String(params.is_read))
  if (params?.page) sp.set('page', String(params.page))
  if (params?.page_size) sp.set('page_size', String(params.page_size))
  return request<NewsItemData[]>(`/api/news/items?${sp}`)
}

export function markNewsItemRead(id: number) {
  return request<{ ok: boolean }>(`/api/news/items/${id}/read`, { method: 'PUT' })
}

// Digests
export function getNewsDigests(limit = 30, digestType?: string) {
  const sp = new URLSearchParams({ limit: String(limit) })
  if (digestType) sp.set('digest_type', digestType)
  return request<NewsDigestData[]>(`/api/news/digests?${sp}`)
}

export function getLatestDigest(digestType = 'daily') {
  return request<NewsDigestData | null>(`/api/news/digests/latest?digest_type=${digestType}`)
}

export function getNewsDigest(id: number) {
  return request<NewsDigestData>(`/api/news/digests/${id}`)
}

export function markDigestRead(id: number) {
  return request<{ ok: boolean }>(`/api/news/digests/${id}/read`, { method: 'PUT' })
}

export function triggerDigestGeneration() {
  return request<{ ok: boolean; message: string }>('/api/news/digests/generate', { method: 'POST' })
}

export function triggerTodayDigestGeneration() {
  return request<{ ok: boolean; message: string }>('/api/news/digests/generate-today', { method: 'POST' })
}

// Fetch
export function triggerNewsFetch() {
  return request<{ ok: boolean; message: string }>('/api/news/fetch', { method: 'POST' })
}

// Settings
export function getNewsSettings() {
  return request<NewsSettingsData>('/api/news/settings')
}

export function updateNewsSettings(body: Partial<NewsSettingsData>) {
  return request<{ ok: boolean }>('/api/news/settings', { method: 'PUT', body: JSON.stringify(body) })
}

// Stats
export function getNewsStats() {
  return request<NewsStats>('/api/news/stats')
}
