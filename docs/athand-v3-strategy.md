# AtHand V3 阶段开发方案：个人 AI 工作台的调度、注意力与跨设备控制层

## 0. 文档定位

这份文档是在前一版 V3 复盘基础上的重写版。前一版已经确认：AtHand 不应该继续扩张成“带 AI 的个人办公套件”，而应该收束为面向高杠杆个体的个人 AI 运营系统。

新的判断是：V3 的核心不只是“统一管理 AI 会话”，而是要成为用户与多个 coding agent、多个设备、多个任务流之间的控制层。

AtHand V3 要优先解决三件事：

1. 多 agent 协作：让 Claude Code、Codex、Kimi Code 等 agent 可以被统一派发、对照、审查和接力。
2. 注意力管理：当多个 agent 同时运行时，只把关键节点、风险动作和需要判断的分歧推到用户面前。
3. 跨设备远控：让用户在手机、浏览器或任意设备上访问会话、继续下令、查看状态和处理审批。

---

## 1. V3 的一句话定义

**AtHand V3 是面向高杠杆个体的个人 AI 工作台，用于调度多个 coding agent、管理注意力、远程控制会话，并沉淀长期工作记忆。**

它不是要替代 Claude Code、Codex、Kimi Code，也不是重新发明一个通用 agent。它更像一个外部协调层：

- 不抢 agent 的核心执行能力。
- 不强迫用户放弃原有工具。
- 通过 bridge、session adapter、timeline、approval 和 memory，把多个独立 agent 组织成一个可运营系统。

V3 的关键问题不再是“AtHand 自己能不能完成任务”，而是：

**当我同时让多个 AI 干活时，AtHand 能不能帮我更稳定地发任务、看进度、处理分歧、做决策、继续会话和沉淀经验？**

---

## 2. 目标用户与非目标用户

### 目标用户

V3 优先服务这类用户：

- 高频使用 Claude Code、Codex、Kimi Code、paseo、VS Code、终端和浏览器 AI 工具的人。
- 同时推进多个项目、多个分支、多个实验任务的独立开发者、技术型创业者、小团队负责人。
- 已经在用多个 agent 并行写代码、修 bug、做 research、审 PR，但注意力开始不够用的人。
- 希望在手机上远程查看和操控 coding agent 会话的人。

### 非目标用户

V3 不优先服务：

- 只需要一个聊天机器人或普通待办工具的人。
- 希望 AtHand 替代成熟邮箱、日历、文档、IM 全家桶的人。
- 需要标准企业 SaaS、复杂组织权限和多人审批流的大团队。
- 不愿意让 AtHand 接触 AI 会话、代码上下文或执行状态的人。

---

## 3. 核心产品主张

### 3.1 多 agent 协作，而不是单 agent 包办

直接自己调用 API 开发一套 agent 调度系统，长期看很有价值，但短期成本高，而且会绕开用户已经在使用的 Claude Code、Codex、Kimi Code 等工具。

AtHand V3 更务实的路线是：

- 先接入现有 coding agent 的外部会话与运行状态。
- 为不同 agent 建立 session adapter，把它们的输入、输出、timeline、文件变更、审批请求统一成 AtHand 内部对象。
- 支持把一个 agent 的 session 摘要、关键上下文、审查意见插入另一个 agent 的 session。
- 支持同一 Mission 下的并行执行、竞争式执行、审查式执行和接力式执行。

典型工作流：

- Claude Code 执行实现，Codex 审查风险和测试缺口。
- Codex 提出方案，Kimi Code 做中文产品文档和交互说明。
- 三个 agent 并行完成同一 bugfix，AtHand 汇总差异、测试结果和推荐方案。
- 一个 agent 卡住后，AtHand 把失败上下文整理给另一个 agent 接手。

这里的重点不是让 agent 互相“聊天”，而是让它们围绕同一个 Mission 共享必要上下文、产出可比较结果，并由 AtHand 管理交接、审查和仲裁。

### 3.2 注意力管理，而不是更多通知

多 agent 并行之后，用户真正缺的不是输出，而是注意力。AtHand 的价值应该体现在过滤噪音：

- 普通日志不打扰用户，只进入 timeline。
- 可自动恢复的失败不打扰用户，只记录修复尝试。
- 需要用户补充目标、选择方案、批准写文件、发邮件、部署、删除、提交代码等动作时，才形成显式审批。
- 多 agent 结论冲突时，AtHand 先做摘要和差异对照，再推给用户判断。
- 长时间运行任务只在状态变化、卡住、完成、风险升级时提示。

V3 应该把注意力当作一级资源建模，而不是把所有事件平铺到消息流里。

### 3.3 跨设备远控，而不是只在桌面旁边看

基于当前 coding agent 正在向跨设备登录和会话延续演进的趋势，AtHand 必须把“手机远控”作为 V3 基础能力，而不是附加适配。

手机端最重要的不是完整开发体验，而是：

- 查看所有 Mission 和 Run 的当前状态。
- 打开某个 agent 会话的摘要、timeline 和最新输出。
- 继续会话：追加一句指令、补充约束、要求重试或暂停。
- 处理审批：允许、拒绝、修改后允许。
- 在外出时快速捕获新任务，并派给合适 agent。

移动端界面应该围绕“关键决策卡片”和“会话续命”设计，而不是缩小版桌面工作台。

---

## 4. V3 核心对象模型

V3 需要从当前的 todo、memo、email、news、session，升级到更适合 AI 运营的对象模型。

| 对象 | 含义 | 示例 |
| --- | --- | --- |
| Mission | 一个目标或阶段性任务 | “重构邮箱工作区加载逻辑” |
| Run | 一次 agent 执行 | “Claude Code 实现方案 A” |
| Agent Session | 外部 agent 的真实会话 | Claude Code/Codex/Kimi Code session |
| Context Packet | 可跨 agent 传递的上下文包 | 需求、文件列表、失败日志、审查意见 |
| Artifact | 执行产物 | patch、总结、测试报告、PR 描述 |
| Review | 审查结果 | Codex 对 Claude 输出的风险分析 |
| Approval | 需要用户拍板的动作 | 写文件、提交、部署、发送邮件 |
| Attention Event | 值得打断用户的事件 | 卡住、冲突、完成、风险升级 |
| Memory Entry | 长期记忆 | 偏好、规则、模板、项目经验 |

核心关系：

- 一个 Mission 可以包含多个 Run。
- 一个 Run 绑定一个或多个 Agent Session。
- 多个 Run 可以并行竞争，也可以形成“执行 -> 审查 -> 修正”的链条。
- Context Packet 是跨 agent 协作的最小传递单位。
- Approval 和 Attention Event 决定用户是否需要介入。
- Memory Entry 把反复出现的偏好和经验写回系统。

---

## 5. 多 agent 调度模式

V3 初期不需要做复杂的全自动规划器，但需要支持几种稳定、可解释的调度模式。

### 5.1 单 agent 执行

最基础模式。用户选择一个 agent 执行任务，AtHand 负责创建 Run、记录 timeline、展示状态、支持继续会话。

### 5.2 执行 + 审查

一个 agent 负责实现，另一个 agent 负责审查：

1. Claude Code 完成实现。
2. AtHand 提取 diff、日志、测试结果，形成 Context Packet。
3. Codex 审查 correctness、edge cases、test gaps、security risks。
4. AtHand 把审查结论推回 Claude Code 或提交给用户。

这是 V3 最应该优先落地的协作模式，因为它直接提升任务质量。

### 5.3 并行竞争

同一个 Mission 分配给多个 agent 并行执行。AtHand 负责：

- 保持相同任务输入。
- 记录各自执行路径。
- 汇总产物差异。
- 对照测试结果和风险。
- 给出推荐方案，但保留用户最终选择权。

适合高不确定性任务、方案探索、bugfix 和架构设计。

### 5.4 接力执行

一个 agent 卡住或完成阶段性产物后，AtHand 把上下文整理给另一个 agent：

- 保留原始目标。
- 摘要已尝试路径。
- 列出失败原因和关键日志。
- 指明下一步要避免什么。

接力的重点是减少“重新解释一遍”的成本。

---

## 6. Session Adapter 与外部 harness 解析

AtHand 不应该假设所有 agent 都会提供标准 API。V3 要把接入层分成两档。

### 6.1 标准 API 接入

对于能稳定提供 API、WebSocket、MCP 或本地 daemon 的工具，优先走结构化接入：

- 创建/恢复会话。
- 发送用户消息。
- 读取 timeline 和状态。
- 获取文件变更与命令输出。
- 暂停、继续、取消任务。

当前 paseo bridge 可以作为这一层的基础。

### 6.2 Harness / Session 解析接入

对于 Claude Code、Codex、Kimi Code 这类已有独立 harness 的工具，V3 可以先做外部适配：

- 解析本地 session 目录、日志、transcript 或导出格式。
- 把原始消息转换成 AtHand 标准 timeline。
- 提取用户指令、agent 输出、工具调用、文件变更、错误、审批点。
- 支持把 Context Packet 转成适合目标 agent 的 prompt 片段，插入或追加到其 session。

这条路线的目标不是破解私有系统，而是在用户授权的本地环境里，为用户自己的会话建立可观察性和跨工具上下文迁移能力。

---

## 7. 注意力管理机制

AtHand V3 应该内置一套 attention router。

### 事件分级

| 等级 | 说明 | 处理方式 |
| --- | --- | --- |
| Log | 普通执行日志 | 只进 timeline |
| Update | 状态变化 | 在 Mission/Run 内更新 |
| Notice | 可能需要关注 | 汇入 Today 或 Inbox |
| Decision | 需要用户选择 | 生成决策卡 |
| Approval | 需要授权 | 显式确认后执行 |
| Alert | 高风险或阻塞 | 跨设备推送 |

### 决策卡内容

每张决策卡都应该回答：

- 发生了什么？
- 为什么需要我？
- 有哪些选项？
- 推荐选项是什么，理由是什么？
- 不处理会怎样？

这会让用户从“盯着多个 agent 输出”变成“处理少量高价值节点”。

---

## 8. 信息架构调整

V3 的一级入口建议从应用分类改成运营流：

| 一级入口 | 作用 |
| --- | --- |
| Today | 今日重点、关键审批、阻塞任务、跨设备待处理事项 |
| Inbox | 新想法、邮件、新闻、AI 生成待澄清事项、手机快速捕获 |
| Missions | 目标、计划、子任务、agent 分工、结果归档 |
| Runs | 所有 agent 会话、timeline、状态、继续控制、并行对照 |
| Reviews | 审查结果、竞争方案对比、测试与风险报告 |
| Memory | 偏好、规则、模板、项目经验、可复用上下文 |
| Connectors | agent、设备、模型、邮箱、新闻源、权限配置 |

现有模块映射：

- Dashboard -> Today。
- AI 管控 -> Runs，并升级为核心执行面。
- AssistantPanel -> 全局 Composer 和决策入口。
- Todos -> Missions 的任务拆解。
- Memos -> Memory。
- Email/News -> Inbox 信号源和 Approval 场景。
- Clock -> Today 的节奏与注意力统计。

---

## 9. 阶段开发路线

### Phase 0：战略收口

- 冻结新的独立办公功能页。
- 明确 V3 主线：多 agent 调度、注意力管理、跨设备远控。
- 保留现有 Email、News、Todos、Memos，但降低其产品叙事优先级。

### Phase 1：统一 Run 与 Timeline

- 把当前 AI Control 中的 session、history、timeline 收敛为 Run 模型。
- 为每次 agent 执行生成稳定 ID、状态、摘要和 latest event。
- 支持从 Today/Runs 快速继续会话。
- 为移动端提供轻量 API：mission list、run detail、append command、approval action。

### Phase 2：Context Packet 与审查模式

- 定义 Context Packet 数据结构。
- 支持从一个 Run 生成摘要、diff、日志、失败原因和测试结果。
- 实现“Claude 执行，Codex 审查”或“任一 agent 执行，另一 agent 审查”的第一条链路。
- 在 Reviews 页面展示审查结论、风险、建议修复项。

### Phase 3：Attention Router

- 建立事件分级：Log、Update、Notice、Decision、Approval、Alert。
- Today 只展示 Notice 以上事件。
- Approval 卡片统一承载写文件、提交、部署、发邮件等动作。
- 支持跨设备推送或至少移动端待处理队列。

### Phase 4：并行竞争与结果仲裁

- 支持同一 Mission 下启动多个 Run。
- 对比多个 agent 的产物、测试结果和风险。
- 生成推荐方案和差异摘要。
- 支持用户选择一个结果继续，或让另一个 agent 基于结果修正。

### Phase 5：跨设备体验

- 优先做 mobile web，而不是原生 App。
- Today、Missions、Run Detail、Approval 四个视图先适配手机。
- 支持手机追加指令、暂停/继续 Run、处理审批。
- 对长输出做摘要优先展示，原文折叠查看。

### Phase 6：Memory 与长期优化

- 从重复审批、反复修正、常见 prompt、项目规则中提取 Memory Entry。
- 在创建 Mission 或生成 Context Packet 时自动注入相关记忆。
- 允许用户编辑、禁用、确认记忆，避免系统悄悄固化错误偏好。

---

## 10. 技术实现建议

### 后端

- 在 `athand-hub/backend` 增加 mission、run、artifact、approval、memory 的核心表。
- 保留当前 `api/ai_control.py`，但逐步让它服务 Run 模型。
- 新增 adapter 层，例如 `services/agent_adapters/`，隔离 paseo、Claude Code、Codex、Kimi Code 的接入差异。
- 所有 agent 原始事件先落库为 raw event，再转换成标准 timeline event。
- Approval 必须是显式状态机：pending、approved、rejected、modified、expired、executed、failed。

### 前端

- Today 首页改成“决策与状态中心”，减少普通模块入口权重。
- Runs 页面保留看板，但增加 Mission 分组、agent 类型、并行对照和 Review 状态。
- AssistantPanel 升级为全局 Composer：新建 Mission、给 Run 追加指令、生成 Context Packet、处理审批。
- 移动端先围绕卡片流设计，避免搬运桌面复杂布局。

### 安全与边界

- 所有跨 agent 注入的内容都必须标注来源，避免上下文污染。
- 写文件、提交、部署、发邮件、删除数据等动作必须走 Approval。
- 对 session harness 的解析只处理用户本地授权目录，不上传无关隐私数据。
- Memory 写入需要可回看、可删除、可禁用。

---

## 11. 成功标准

V3 是否走对，不看页面数量，而看下面指标：

- 用户是否开始把新任务先丢进 AtHand，而不是直接打开某个 agent。
- 同一 Mission 下是否能自然出现“执行 + 审查”的工作流。
- 多 agent 并行时，用户需要看的内容是否明显减少。
- 手机端是否能完成真实的远程续聊和审批。
- AtHand 是否能把一次任务的经验沉淀到下次任务中。
- 当 Claude Code、Codex、Kimi Code 本身继续变强时，AtHand 的价值是否仍然增强，而不是被替代。

---

## 12. 最终结论

AtHand V3 的机会，不在于再做更多个人办公页面，也不在于立刻从零实现一个完整 agent 平台。

更务实、也更有护城河的路线是：

**把 AtHand 做成多个 AI coding agent 之上的个人调度层、注意力过滤层和跨设备控制层。**

在这个定义下：

- Claude Code、Codex、Kimi Code 是执行体。
- AtHand 是 mission、run、context、review、approval、memory 的组织者。
- 用户不再盯着每个 agent 的完整输出，而是在关键节点做高价值判断。
- 手机不是附属入口，而是远程控制 AI 工作流的关键终端。

如果 V3 能沿着这条路线推进，AtHand 才会从“一个集成了很多模块的工作台”，变成真正服务个人 AI 工作系统的操作层。
