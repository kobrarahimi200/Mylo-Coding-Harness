# Mylo workspace redesign and verification

Verified on macOS arm64, 2026-10-27. Branch:
`fix/mylo-harness-acceptance-20261027`. No commit, push, merge or publication.

This report supplements [the earlier implementation report](mylo-implementation-report.md).
The existing Modus desktop, Electron/preload IPC, Pi SDK runtime, native resource
loader, approval broker, terminal and Monaco integration remain in use. There is
no second agent engine and no additional UI dependency. The visual design uses
the requested navy/purple palette and existing fonts/icons. No reference image
was supplied with this request.

## Implemented behavior

- Workspace header displays the imported project, actual Git branch where
  available, configured model, actual task phase, Stop and Settings. Initial
  model publication now waits for the native registry refresh. Empty startup
  retains Open Project; task inputs stay disabled until a project exists.
- The collapsible project sidebar includes existing recent projects, import,
  rename/removal controls and session history, plus lazy file exploration,
  bounded repository filename search, actual Git status and discovered skills.
  The embedded editor tree stays available without duplicating the sidebar by
  default. Existing browser, calculator and other working application areas remain.
- Chat, Code, Diff, Plan, Timeline and Skills tabs connect to existing services.
  Monaco file tabs retain separate saved/draft contents, show unsaved indicators
  and preserve drafts across tab, panel and project switching during the process.
  Save rejects a changed disk baseline instead of overwriting it. Reload asks
  before discarding a draft. Markdown has editable source and optional preview.
- Agent Workspace contains an editable task and optional acceptance criteria,
  editable generated plan, Approve, Reject and Re-plan, actual tools, validation
  commands/exit codes, bounded correction attempts, pending approvals and task
  skill manifest. Run Harness is explicit plan approval. Re-plan rejects the old
  proposal and returns its text to the task specification for revision.
- Pi's native `mylo_step` metadata tool reports actual step status after approval.
  The interface never fabricates completion for steps the agent has not reported.
  Persisted task markers retain validation history across correction subturns;
  terminal harness phases take precedence over an assistant subturn completing.
  Resuming an interrupted task reports cancellation instead of remaining busy.
- Terminal, Tests, Problems and Agent Logs show native process output and events.
  Sidebar, Agent Workspace and bottom console are resizable; dimensions persist.
  On narrow windows Agent Workspace becomes a collapsible overlay. The native
  window minimum is now 820×600, allowing the compact layout to be reached.
- Approvals show operation category, project/cwd, proposed command or real diff,
  impact and explicit decisions. Existing sandbox and trust checks remain active.
- Skill management exposes description, source, scope, path and enabled state,
  existing local-folder registration and native resource refresh. Resource changes
  are disabled during an active task. The task stores its discovered-skill list.
  The README retains the custom `SKILL.md` installation instructions.
- Rollback captures the first pre-agent contents and latest approved output for
  native Pi write/edit proposals. Native IPC requires an idle session, current
  preview token and explicit confirmation. The preview shows diffs and conflicts;
  later manual changes block restoration. Unrelated files and the pre-existing
  dirty baseline are preserved. Restoring a file writes a temporary file before
  replacement; newly agent-created files are removed individually. No Git reset.

## Runtime fixes uncovered during verification

TypeScript editing exposed an existing Monaco worker routing defect: every
language request went to the generic editor worker. TypeScript, JSON, CSS and HTML
now receive their own bundled workers. Missing diagnostic/inlay-hint handlers no
longer produce renderer errors. Short-lived diff editors disable occurrence
searches, whose pending Monaco Delayer otherwise rejects during disposal; actual
diff computation still settles before releasing models. No global error filter,
`preventDefault` handler or fabricated success was added.

File IPC now resolves existing ancestors to reject escaping/dangling symlinks.
Checkpoint tests also cover paths that coincide with JavaScript object properties.
Git porcelain parsing preserves leading status columns and rename records.

## Verification

| Command | Result |
| --- | --- |
| `npm run check` | Passed; 16 existing warnings, 1 informational diagnostic |
| `npm run test` | 365 passed, 3 skipped; 70 test files passed, 2 optional files skipped |
| `npm --workspace @modus/desktop run typecheck` | Passed |
| `npm --workspace @modus/desktop run build` | Passed; Electron main/preload/renderer and native PTY built |
| `cargo test --workspace` | 4 passed; existing unused-mut warning |
| `npm --workspace @modus/desktop run test:acceptance` | Passed: full local Pi workflow, real validation/correction, editor/drafts/save, rollback conflict and actual 900/1440 px layouts; zero renderer errors |
| `npm --workspace @modus/desktop run test:smoke` | Passed: startup/import/edit/removal, real PTY, full-process restore and closed-window reopen |
| `git diff --check` | Passed |

The initial restricted-shell test attempt failed because it could not bind the
local fixture port or launch real sandbox subprocesses. The same suite passed
with host execution authorized; no failing tests were skipped to obtain a pass.

The first strengthened resize assertion exposed the old native 1120-pixel minimum
width. After reducing it to 820 pixels, the final fixture reached and verified
both 900- and 1440-pixel viewports. The final build passed the restart smoke test
again. The updated application was opened using the existing local state;
read-only DevTools checks confirmed its real preload API, workspace header,
Agent Workspace and mounted React root. No user task was submitted automatically.

The final synthetic-workspace screenshot was inspected visually and is available
at `output/playwright/mylo-workspace.png` (generated, ignored by Git).

The desktop acceptance fixture uses a temporary Vue project and localhost model
responses through the actual Pi SDK. It exercises startup/import, model selection,
plan editing/approval, real file proposals/diffs, actual failing `npm test`, Pi's
correction and successful tests/typecheck, final acceptance, multi-file editing,
draft retention, real saving, rollback conflict protection and window resizing.
The editor driver uses Monaco's public edit API on its real model; it is not a
manual keyboard/IME test. Renderer exceptions and unhandled rejections fail it.
It does not call ChatGPT or transmit the user's repository. Native unit tests
cover command rejection, skill discovery/enable/disable, stop/cancellation,
rollback restoration, stale previews, path changes and interrupted session state.

## Remaining limits

- Windows NSIS/WSL configuration is preserved. Windows installation and actual
  WSL sandbox behavior were not verified on this macOS host; optional Windows
  and live-credential integration tests remain skipped by default.
- This redesign run used deterministic local inference. It does not establish
  current availability or quota of a live ChatGPT account. The earlier report
  records the separate live sign-in verification; it was not repeated here.
- Rollback covers reviewed Pi write/edit operations in the latest file-changing
  task. Arbitrary terminal-generated changes are not reverted automatically.
  Checkpoints are limited to 4 MiB per file and 32 MiB serialized total. Content
  is checked before restoring; external-process races are not a filesystem-wide
  transaction. Partial I/O failures are returned as conflicts.
- Unsaved editor drafts are kept in memory, not recovered after process exit.
  Monaco provides standalone language services; this change does not implement
  a repository-wide TypeScript/LSP server resolving every installed dependency.
- Repository filename search is bounded to 150 folders/200 results. Full text
  search inside the current file uses Monaco's existing Find command.
- The UI acceptance does not exercise every human rejection/skill-management
  click path; those policies have native automated coverage. A complete Windows
  manual acceptance pass remains required before releasing an installer.

## Changed-file inventory

These 88 files include the accumulated working-tree changes from this
conversation, including earlier stabilization work preserved by this task.

- `.github/workflows/windows.yml`
- `README.md`
- `apps/desktop/electron-builder.config.ts`
- `apps/desktop/package.json`
- `apps/desktop/scripts/smoke-runner.mjs`
- `apps/desktop/scripts/smoke.mjs`
- `apps/desktop/src/main/agent/agent-history.ts`
- `apps/desktop/src/main/agent/agent-store.test.ts`
- `apps/desktop/src/main/agent/model-service.test.ts`
- `apps/desktop/src/main/agent/model-service.ts`
- `apps/desktop/src/main/agent/pi-sdk-runtime.test.ts`
- `apps/desktop/src/main/agent/pi-sdk-runtime.ts`
- `apps/desktop/src/main/agent/provider-login.test.ts`
- `apps/desktop/src/main/agent/provider-login.ts`
- `apps/desktop/src/main/files/files-service.test.ts`
- `apps/desktop/src/main/files/files-service.ts`
- `apps/desktop/src/main/files/files-watcher.ts`
- `apps/desktop/src/main/files/path-within.ts`
- `apps/desktop/src/main/harness/approval-policy.test.ts`
- `apps/desktop/src/main/harness/approval-policy.ts`
- `apps/desktop/src/main/harness/planning.ts`
- `apps/desktop/src/main/harness/sandbox.test.ts`
- `apps/desktop/src/main/harness/sandbox.ts`
- `apps/desktop/src/main/harness/validation.test.ts`
- `apps/desktop/src/main/harness/validation.ts`
- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/main/ipc/channels.ts`
- `apps/desktop/src/main/ipc/register-app-ipc.ts`
- `apps/desktop/src/main/ipc/schemas.ts`
- `apps/desktop/src/main/terminal/terminal-service.ts`
- `apps/desktop/src/main/windows/main-window.ts`
- `apps/desktop/src/main/workspace/workspace-store.ts`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/preload/types.ts`
- `apps/desktop/src/renderer/src/app/App.tsx`
- `apps/desktop/src/renderer/src/app/initial-hydration.test.ts`
- `apps/desktop/src/renderer/src/app/initial-hydration.ts`
- `apps/desktop/src/renderer/src/app/useInitialHydration.ts`
- `apps/desktop/src/renderer/src/components/Sidebar.tsx`
- `apps/desktop/src/renderer/src/components/code/CodeDiff.tsx`
- `apps/desktop/src/renderer/src/components/code/CodeViewer.tsx`
- `apps/desktop/src/renderer/src/components/layout/usePanelLayout.ts`
- `apps/desktop/src/renderer/src/features/agent/ChatPane.tsx`
- `apps/desktop/src/renderer/src/features/agent/ExtensionDialog.tsx`
- `apps/desktop/src/renderer/src/features/files/FilesPanel.tsx`
- `apps/desktop/src/renderer/src/features/harness/BottomPanel.tsx`
- `apps/desktop/src/renderer/src/features/harness/HarnessPanels.tsx`
- `apps/desktop/src/renderer/src/features/harness/useHarnessEvents.ts`
- `apps/desktop/src/renderer/src/features/settings/SkillsSettingsPanel.tsx`
- `apps/desktop/src/renderer/src/lib/monaco.ts`
- `apps/desktop/src/renderer/src/styles/app.css`
- `apps/desktop/src/shared/harness.ts`
- `docs/mylo-implementation-report.md`
- `package-lock.json`
- `apps/desktop/scripts/acceptance-runner.mjs`
- `apps/desktop/scripts/acceptance.mjs`
- `apps/desktop/scripts/vue-fixture.d.mts`
- `apps/desktop/scripts/vue-fixture.mjs`
- `apps/desktop/src/main/agent/pi-sdk-runtime.live.test.ts`
- `apps/desktop/src/main/git/git-status.test.ts`
- `apps/desktop/src/main/git/git-status.ts`
- `apps/desktop/src/main/harness/approval-path-race.test.ts`
- `apps/desktop/src/main/harness/checkpoint-store.test.ts`
- `apps/desktop/src/main/harness/checkpoint-store.ts`
- `apps/desktop/src/main/harness/checkpoints.ts`
- `apps/desktop/src/main/harness/windows-sandbox.live.test.ts`
- `apps/desktop/src/main/harness/windows-sandbox.test.ts`
- `apps/desktop/src/main/harness/windows-sandbox.ts`
- `apps/desktop/src/main/terminal/terminal-service.test.ts`
- `apps/desktop/src/renderer/src/features/files/file-buffers.test.ts`
- `apps/desktop/src/renderer/src/features/files/file-buffers.ts`
- `apps/desktop/src/renderer/src/features/files/useFileBuffers.ts`
- `apps/desktop/src/renderer/src/features/harness/AgentWorkspace.tsx`
- `apps/desktop/src/renderer/src/features/harness/ProjectExplorer.tsx`
- `apps/desktop/src/renderer/src/features/harness/RollbackDialog.tsx`
- `apps/desktop/src/renderer/src/features/harness/WorkspaceHeader.tsx`
- `apps/desktop/src/renderer/src/features/harness/harness-state.test.ts`
- `apps/desktop/src/renderer/src/features/harness/harness-state.ts`
- `apps/desktop/src/renderer/src/features/harness/useWorkspacePanels.ts`
- `apps/desktop/src/renderer/src/styles/workspace.css`
- `apps/desktop/src/shared/checkpoint.ts`
- `apps/desktop/test-fixtures/vue-ts/.gitignore`
- `apps/desktop/test-fixtures/vue-ts/package.json`
- `apps/desktop/test-fixtures/vue-ts/src/App.vue`
- `apps/desktop/test-fixtures/vue-ts/src/counter.ts`
- `apps/desktop/test-fixtures/vue-ts/tests/counter.cjs`
- `apps/desktop/test-fixtures/vue-ts/tsconfig.json`
- `docs/mylo-workspace-redesign-report.md`
