# AtHand V3 Phase Development Plan

This file is the running execution plan for AtHand V3. It should be updated after each development conversation so future work can resume from the current phase state without relying on chat history.

Source strategy: [athand-v3-strategy.md](athand-v3-strategy.md)

## Operating Rules

- After each completed conversation round, update the relevant `Progress` subsection below with what changed, what was verified, and what remains open.
- After context compaction or resume, read this file first, then continue from the current phase and open items.
- Keep entries concise and factual. Prefer dated bullets in `YYYY-MM-DD` format.

## Current Focus

- Current phase: Phase 1, unified Run and Timeline preparation.
- Current objective: review current AI Control navigation/data models, then start mapping sessions/history/timeline into a Run abstraction.
- Last updated: 2026-05-31.

## Phase 0: Strategic Convergence

### Goals

- Freeze expansion of new standalone office-style pages.
- Confirm the V3 product spine: multi-agent scheduling, attention management, and cross-device remote control.
- Keep Email, News, Todos, and Memos, but reframe them as inputs, derived views, or memory surfaces.

### Tasks

- Maintain the V3 strategy document as the product direction reference.
- Create this phase plan as the operational tracking document.
- Add repository instructions requiring agents to update this plan and reload it after context compaction.

### Progress

- 2026-05-31: Drafted `docs/athand-v3-new.md` as the updated V3 strategy centered on multiple coding agents, attention routing, and mobile remote control.
- 2026-05-31: Created this phase plan to track implementation progress across conversations.
- 2026-05-31: Added `AGENTS.md` instructions requiring future agents to update this phase plan after each completed conversation round and reload it after context compaction or resume.
- 2026-05-31: Promoted the new V3 strategy into `docs/athand-v3-strategy.md` as the canonical strategy document and removed the temporary `docs/athand-v3-new.md` draft.
- 2026-05-31: Reviewed current navigation and data models before Phase 1. The sidebar is still application-oriented (`Dashboard`, `AI 管控`, `Todos`, `Memos`, `Clock`, `Email`, `News`), backend persistence is still domain-module oriented, and AI Control already exposes session, history, timeline, message, resume, and permission schemas suitable for the first Run abstraction.
- 2026-05-31: Verified Phase 0 changes with `git diff --check`, `npm run build` in `athand-hub/frontend`, and focused backend compilation via `python3 -m compileall -q backend/api backend/services backend/ws backend/config.py backend/database.py backend/main.py backend/models.py`.

### Open Items

- None. Phase 0 is complete; proceed to Phase 1.

## Phase 1: Unified Run and Timeline

### Goals

- Convert current AI Control sessions, history, and timeline concepts into a stable `Run` model.
- Give each agent execution a stable ID, status, summary, and latest event.
- Support fast continuation from Today and Runs.
- Prepare lightweight mobile APIs for mission list, run detail, append command, and approval action.

### Tasks

- Inspect current AI Control backend and frontend models.
- Define initial `Mission`, `Run`, and timeline event schemas.
- Map existing paseo bridge session data into the new Run abstraction.
- Add API boundaries without breaking the existing AI Control UI.

### Progress

- Not started.

### Open Items

- Confirm whether Phase 1 should begin with backend schema changes or frontend state normalization.

## Phase 2: Context Packet and Review Mode

### Goals

- Define `Context Packet` as the cross-agent transfer unit.
- Generate summaries, diffs, logs, failure reasons, and test results from a Run.
- Implement the first review chain: one agent executes, another reviews.
- Show review conclusions, risks, and suggested fixes in Reviews.

### Tasks

- Design the Context Packet structure.
- Identify available sources for diff, command output, and test results.
- Add a review artifact model.
- Build the first review workflow around the existing agent bridge.

### Progress

- Not started.

### Open Items

- Choose the first practical agent pair for execution and review.

## Phase 3: Attention Router

### Goals

- Classify events as `Log`, `Update`, `Notice`, `Decision`, `Approval`, or `Alert`.
- Keep Today focused on Notice-level and higher events.
- Route risky or irreversible actions through Approval cards.
- Prepare cross-device pending-action queues.

### Tasks

- Define event severity rules.
- Create Approval state transitions: `pending`, `approved`, `rejected`, `modified`, `expired`, `executed`, `failed`.
- Update Today to display decisions and approvals instead of raw activity.
- Add backend queries for pending attention events.

### Progress

- Not started.

### Open Items

- Identify existing confirmation flows that can be migrated first.

## Phase 4: Parallel Competition and Result Arbitration

### Goals

- Allow multiple Runs under the same Mission.
- Compare outputs, tests, and risks from competing agents.
- Generate recommendation summaries while keeping user choice explicit.
- Continue from a selected result or ask another agent to revise it.

### Tasks

- Add Mission-level grouping to Runs.
- Build comparison views for artifacts and review results.
- Add recommendation summaries.
- Support continuation from a selected Run.

### Progress

- Not started.

### Open Items

- Define the minimum useful comparison format for code tasks.

## Phase 5: Cross-Device Experience

### Goals

- Prioritize mobile web over native apps.
- Make Today, Missions, Run Detail, and Approval usable on phones.
- Support appending commands, pausing/continuing Runs, and handling approvals remotely.
- Summarize long output first, with full output available on demand.

### Tasks

- Audit current responsive layout.
- Define the mobile command and approval flows.
- Add mobile-friendly API responses if needed.
- Test key flows on narrow viewports.

### Progress

- Not started.

### Open Items

- Decide whether mobile UI work should start after Phase 1 APIs or in parallel.

## Phase 6: Memory and Long-Term Optimization

### Goals

- Extract durable preferences, project rules, common prompts, and lessons from repeated work.
- Inject relevant memories when creating Missions or Context Packets.
- Let users review, edit, disable, and delete memory entries.

### Tasks

- Define `Memory Entry` schema and source metadata.
- Add user confirmation before durable memory writes.
- Connect memory retrieval to Mission creation and Context Packet generation.
- Build memory management UI.

### Progress

- Not started.

### Open Items

- Decide what counts as safe automatic memory suggestion versus requiring explicit user confirmation.
