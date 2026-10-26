# Mylo implementation and verification report

Verified locally on macOS arm64, 2026-10-26 (Europe/Berlin).

## Crash diagnosis and startup behavior

The `.workspace` receiver in renderer code is the Electron preload API,
`window.modus`, not the selected `WorkspaceInfo`. A null selected project is valid.
The error shown in the request can be reproduced by calling the project-open
handler without a preload bridge:

```text
Sidebar Open Project / Import project
  → App.onOpenWorkspace
  → useWorkspaceSessions.openWorkspace
  → window.modus.workspace.open()
  → TypeError: Cannot read properties of undefined (reading 'workspace')
```

The handler catches that error and stores its message in `sessionCreateError`,
which App renders. Initial hydration also depends on `api.workspace.list()`,
although its existing effect already checks for a missing bridge. The original
user's runtime stack was not provided; the path above is the source-traced
reproduction, not a recovered production stack. The exception did not reproduce
in the isolated Electron process with a working preload.

The renderer now validates its desktop API before mounting workspace-dependent
components. A browser-only renderer or failed preload shows an explicit desktop
connection diagnostic, never an invented workspace API. The Electron window logs
`preload-error` with the path and stack. The real Electron launch path, bundled
preload, and clean installation were tested. No selected project shows Open
Project, with project operations disabled. IPC session creation independently
checks that the imported project exists and matches the requested working folder.
The selected model now reaches the existing Pi runtime through IPC.

Session discovery finishes before the initial recent-project read. Saved project
and session IDs are restored only if they still match an imported project.
Removing a project leaves its files and chats on disk and prevents rediscovery
from making it reappear until it is imported again.

## Harness implementation

- The existing `PiSdkRuntime`, native Pi sessions, tools, resource loader,
  extension system, and session history remain the agent engine.
- Pi receives the request in a read-only planning phase. Only read/list/find/grep
  tools are active, and the approval extension also blocks mutations during this
  phase. Pi returns a structured repository-specific plan; there is no generic
  fallback execution plan. Users can edit the goal and steps and reject execution.
- Approved execution uses the existing Pi tools. Shell commands and file mutations
  require individual approval. Unknown extension tools without a confinement
  policy and isolation-sensitive commands fail closed.
- Proposed code changes use editable Monaco diffs. Reviewed proposals, native edit
  diffs, tool results, phases, plans, and validation events feed the interface.
  Final acceptance includes reviewed file changes. Keeping a task for manual
  review preserves approved edits rather than rolling files back.
- Validation discovers npm test/lint/typecheck/check scripts and Cargo test/check
  commands. It captures real output and exit codes. Vitest watch scripts receive
  a one-shot flag. Missing, skipped, launch-failed, passed, and failed checks remain
  distinct. Output is bounded and commands have a timeout.
- Validation failures feed the same Pi session, with three corrections maximum
  after the initial validation run. The tests verify four failing validation
  runs exhaust this bound. Cancellation resolves pending approvals, aborts Pi,
  and signals the validation subprocess group.
- Harness events persist as custom entries in Pi's own session file and replay
  into Plan, Timeline, Diff, Tests, and status views.
- Skills use Pi's resource loader. Enable/disable preferences filter actual skills
  and slash-command availability; this is not just a UI checkbox. Trusted folders
  can be added, and README documents project `SKILL.md` files. Existing extensions
  keep Pi's project trust flow. Stop a running task before changing skill resources.
- The existing dark styling, Monaco, file explorer, chat, terminal, browser,
  settings, and resizing infrastructure are retained. New workspace views and
  output/status panels use live events and actual IPC operations. No activity or
  successful validation is fabricated. The harness event listener does not consume
  chat's prepared-event queue or retain every streamed token in another buffer.

## Commands actually run

| Command | Local result |
| --- | --- |
| `npm run check` | Passed; TypeScript passed. Biome reports 16 non-blocking warnings and 1 informational diagnostic. |
| `npm test` | Passed: 61 files, 307 tests. Includes the actual Pi engine with a deterministic provider fixture, approval/rejection, file tools, skills, retries, cancellation, and provider-error preservation. |
| `cargo test --workspace` | Passed: 4 Rust tests, including a spawned PTY process. |
| `npm run build` | Passed: Rust release PTY helper and Electron main/preload/renderer build. |
| `npm --workspace @modus/desktop run test:smoke` | Passed: real Electron/preload, empty startup, import, file save, rename, removal, actual PTY output, and project/session restoration in a second process. The folder chooser returns an isolated fixture directory. |
| `npm --workspace @modus/desktop run package:win -- --x64 --publish never` | Failed as expected on this macOS host: no Windows native PTY executable. No Windows installer is claimed. |
| `env -u ELECTRON_RUN_AS_NODE npm run dev` | Started the real Electron application; the inherited tool environment's Node-only flag must be removed for Electron GUI execution. |

Playwright attached over CDP to an isolated real Electron window. It verified the
empty state and disabled navigation, imported a fixture project, opened the
Monaco editor, typed a change, saved with Cmd+S, and read the saved bytes back via
IPC. Screenshot: `output/playwright/mylo-editor.png` (ignored local artifact).

## Requested scenario coverage

| Scenario | Evidence / limit |
| --- | --- |
| 1. Startup without a project | Electron smoke + Playwright + startup/selection regression tests. |
| 2. Import a local project | Electron IPC and UI import; only the native chooser is supplied a fixture path. |
| 3. Coding task generates a plan | Actual Pi session with deterministic model responses; read-only phase and structured output. External provider success is not claimed. |
| 4. Approve plan, execute | Pi integration test writes a real fixture file after approval; rejection starts no tools. |
| 5. File modification shows a diff | Pi write approval emits before/after data; editable Monaco diff and native edit diff views use actual events. Monaco file editing/saving was verified in Electron. |
| 6. Actual test results | Real sandboxed commands produce output and exit codes 0 and 7; npm and Cargo suites also run locally. |
| 7. Failing test triggers correction | Pi integration tests inject failing validation results, verify a correction through the same session, then success; another test exhausts all three retries. |
| 8. Reject an unsafe command | Pi command rejection leaves a sentinel file absent; policy tests reject isolation-sensitive commands and escaped paths. |
| 9. Add a custom skill | Real project `SKILL.md` discovery through Pi, disable/re-enable, and persisted preference assertions. Folder addition uses Pi settings and reload. |
| 10. Restart preserves project/session | Two independent Electron processes restore the saved project and native Pi session; selection tests reject stale/mismatched IDs. |

## Remaining external limitations

The running user's saved Pi assistant errors report: **You have no credits
remaining.** That prevents live planning with the selected OpenAI model. Mylo now
preserves and displays the underlying provider error instead of replacing it with
"could not generate a task plan." Fixing provider balance/credentials or selecting
another working provider is outside a repository code change. No account settings
or credentials were changed. Live external model completion has not been claimed.

Windows packaging is prepared with a target-specific native helper, an executable
preflight, NSIS settings, and a Windows CI build/test/smoke/package workflow.
That workflow was edited locally, not executed or published here. Windows agent
shell execution still requires WSL + bubblewrap and a Linux project toolchain;
its interactive terminal uses the native Windows PTY helper. No signing or
Windows installation test was performed.

The source tree already contained uncommitted modifications when this request
started. They were preserved. The inventory below is the complete final working
tree delta against HEAD, including carried-over files, so it does not attribute
all prior changes to this request. Generated build files, logs, screenshots, and
Playwright snapshots are ignored and are not source changes.

## Complete changed-file inventory

| File | Role |
| --- | --- |
| [`.gitignore`](../.gitignore) | Ignore local Playwright evidence and output artifacts. |
| [`README.md`](../README.md) | Mylo workflow, custom skill instructions, verification, and Windows build documentation. |
| [`apps/desktop/electron-builder.config.ts`](../apps/desktop/electron-builder.config.ts) | Mylo installer metadata and target-specific native terminal resources. |
| [`apps/desktop/package.json`](../apps/desktop/package.json) | Smoke-test runner and Windows native-binary preflight scripts; existing dependencies retained. |
| [`apps/desktop/src/main/agent/agent-history.ts`](../apps/desktop/src/main/agent/agent-history.ts) | Replay persisted harness custom entries from native Pi history. |
| [`apps/desktop/src/main/agent/agent-resources.test.ts`](../apps/desktop/src/main/agent/agent-resources.test.ts) | Resource-discovery fixture preferences for skill filtering. |
| [`apps/desktop/src/main/agent/agent-resources.ts`](../apps/desktop/src/main/agent/agent-resources.ts) | Filter enabled skills through Pi resource discovery. |
| [`apps/desktop/src/main/agent/agent-store.test.ts`](../apps/desktop/src/main/agent/agent-store.test.ts) | Carried-over working-tree change preserved (including project recents, platform Git tests, branding, or calculator support). |
| [`apps/desktop/src/main/agent/agent-store.ts`](../apps/desktop/src/main/agent/agent-store.ts) | Carried-over working-tree change preserved (including project recents, platform Git tests, branding, or calculator support). |
| [`apps/desktop/src/main/agent/pi-sdk-runtime.test.ts`](../apps/desktop/src/main/agent/pi-sdk-runtime.test.ts) | Native Pi workflow, mutations, rejection, retry limit, skills, cancellation, and provider-error regressions. |
| [`apps/desktop/src/main/agent/pi-sdk-runtime.ts`](../apps/desktop/src/main/agent/pi-sdk-runtime.ts) | Read-only Pi planning, approvals, validation/correction, cancellation, diffs, and provider errors. |
| [`apps/desktop/src/main/git/git-repo.test.ts`](../apps/desktop/src/main/git/git-repo.test.ts) | Carried-over working-tree change preserved (including project recents, platform Git tests, branding, or calculator support). |
| [`apps/desktop/src/main/git/git-service.test.ts`](../apps/desktop/src/main/git/git-service.test.ts) | Carried-over working-tree change preserved (including project recents, platform Git tests, branding, or calculator support). |
| [`apps/desktop/src/main/interaction/question-broker.test.ts`](../apps/desktop/src/main/interaction/question-broker.test.ts) | Synchronous-response regression alongside existing question tests. |
| [`apps/desktop/src/main/interaction/question-broker.ts`](../apps/desktop/src/main/interaction/question-broker.ts) | Register approval requests before emitting them to avoid losing immediate responses. |
| [`apps/desktop/src/main/ipc/register-app-ipc.ts`](../apps/desktop/src/main/ipc/register-app-ipc.ts) | Validate project/session creation and selected model; expose skill enable/disable. |
| [`apps/desktop/src/main/preferences/desktop-preferences.ts`](../apps/desktop/src/main/preferences/desktop-preferences.ts) | Skill preferences and defaults for older preference files; hidden projects retained. |
| [`apps/desktop/src/main/skills/skills-service.ts`](../apps/desktop/src/main/skills/skills-service.ts) | List, enable/disable, reload, and manage trusted skill folders. |
| [`apps/desktop/src/main/windows/main-window.ts`](../apps/desktop/src/main/windows/main-window.ts) | Mylo window title and preload-error diagnostics. |
| [`apps/desktop/src/main/workspace/workspace-store.ts`](../apps/desktop/src/main/workspace/workspace-store.ts) | Carried-over working-tree change preserved (including project recents, platform Git tests, branding, or calculator support). |
| [`apps/desktop/src/preload/index.ts`](../apps/desktop/src/preload/index.ts) | Expose typed skill enable/disable IPC; retain existing bridge. |
| [`apps/desktop/src/preload/types.ts`](../apps/desktop/src/preload/types.ts) | Typed API for skill manager and existing desktop operations. |
| [`apps/desktop/src/renderer/index.html`](../apps/desktop/src/renderer/index.html) | Carried-over working-tree change preserved (including project recents, platform Git tests, branding, or calculator support). |
| [`apps/desktop/src/renderer/src/app/App.tsx`](../apps/desktop/src/renderer/src/app/App.tsx) | Functional workspace tabs, empty state, output panel, and agent status integration. |
| [`apps/desktop/src/renderer/src/app/WorkspaceHeaderActions.tsx`](../apps/desktop/src/renderer/src/app/WorkspaceHeaderActions.tsx) | Disable project-dependent header controls without a project. |
| [`apps/desktop/src/renderer/src/app/initial-hydration.test.ts`](../apps/desktop/src/renderer/src/app/initial-hydration.test.ts) | Startup dependency ordering and empty result regressions. |
| [`apps/desktop/src/renderer/src/app/initial-hydration.ts`](../apps/desktop/src/renderer/src/app/initial-hydration.ts) | Read recents after native session discovery. |
| [`apps/desktop/src/renderer/src/app/useInitialHydration.ts`](../apps/desktop/src/renderer/src/app/useInitialHydration.ts) | Restore matched workspace/session selections. |
| [`apps/desktop/src/renderer/src/app/useWorkspaceSessions.ts`](../apps/desktop/src/renderer/src/app/useWorkspaceSessions.ts) | Validate selections, preserve selection IDs, display project-operation errors. |
| [`apps/desktop/src/renderer/src/components/Sidebar.tsx`](../apps/desktop/src/renderer/src/components/Sidebar.tsx) | Project selection and visible import/edit/remove actions; Mylo label. |
| [`apps/desktop/src/renderer/src/components/layout/NavigationRail.tsx`](../apps/desktop/src/renderer/src/components/layout/NavigationRail.tsx) | Projects, files, skills, tests, history, and settings navigation. |
| [`apps/desktop/src/renderer/src/components/ui/WindowTitleBar.tsx`](../apps/desktop/src/renderer/src/components/ui/WindowTitleBar.tsx) | Carried-over working-tree change preserved (including project recents, platform Git tests, branding, or calculator support). |
| [`apps/desktop/src/renderer/src/features/agent/ExtensionDialog.tsx`](../apps/desktop/src/renderer/src/features/agent/ExtensionDialog.tsx) | Editable plan fields, code diff review, and final acceptance diffs. |
| [`apps/desktop/src/renderer/src/features/composer/Composer.tsx`](../apps/desktop/src/renderer/src/features/composer/Composer.tsx) | Block file attachment/drop operations without a project. |
| [`apps/desktop/src/renderer/src/features/settings/SkillsSettingsPanel.tsx`](../apps/desktop/src/renderer/src/features/settings/SkillsSettingsPanel.tsx) | Real skill toggles and trusted folder management. |
| [`apps/desktop/src/renderer/src/main.tsx`](../apps/desktop/src/renderer/src/main.tsx) | Validate desktop bridge before mounting workspace-dependent components. |
| [`apps/desktop/src/renderer/src/styles/app.css`](../apps/desktop/src/renderer/src/styles/app.css) | Load harness styles through the existing CSS pipeline. |
| [`apps/desktop/src/shared/contracts.ts`](../apps/desktop/src/shared/contracts.ts) | Typed plan/diff approval data, harness events, and skill state. |
| [`package-lock.json`](../package-lock.json) | Pre-existing dependency lockfile changes preserved. |
| [`.github/workflows/windows.yml`](../.github/workflows/windows.yml) | Windows build, regression, Electron smoke, NSIS packaging, and artifact workflow. |
| [`apps/desktop/scripts/check-windows-package.mjs`](../apps/desktop/scripts/check-windows-package.mjs) | Reject Windows packaging without a genuine Windows native helper. |
| [`apps/desktop/scripts/smoke-runner.mjs`](../apps/desktop/scripts/smoke-runner.mjs) | Launch two isolated Electron processes and clean their shared temporary state. |
| [`apps/desktop/scripts/smoke.mjs`](../apps/desktop/scripts/smoke.mjs) | Real Electron startup, project/terminal operations, and session restoration fixtures. |
| [`apps/desktop/src/main/harness/approval-policy.test.ts`](../apps/desktop/src/main/harness/approval-policy.test.ts) | Retained harness audit, confinement, or bounded-retry module/test from the initial working tree. |
| [`apps/desktop/src/main/harness/approval-policy.ts`](../apps/desktop/src/main/harness/approval-policy.ts) | Read-only planning, scoped tool approvals, and proposed change snapshots. |
| [`apps/desktop/src/main/harness/audit-log.ts`](../apps/desktop/src/main/harness/audit-log.ts) | Retained harness audit, confinement, or bounded-retry module/test from the initial working tree. |
| [`apps/desktop/src/main/harness/planning.test.ts`](../apps/desktop/src/main/harness/planning.test.ts) | Generated-plan parsing and normalization regressions. |
| [`apps/desktop/src/main/harness/planning.ts`](../apps/desktop/src/main/harness/planning.ts) | Parse and normalize Pi-generated plans; editable approval workflow. |
| [`apps/desktop/src/main/harness/retry-policy.test.ts`](../apps/desktop/src/main/harness/retry-policy.test.ts) | Retained harness audit, confinement, or bounded-retry module/test from the initial working tree. |
| [`apps/desktop/src/main/harness/retry-policy.ts`](../apps/desktop/src/main/harness/retry-policy.ts) | Retained harness audit, confinement, or bounded-retry module/test from the initial working tree. |
| [`apps/desktop/src/main/harness/sandbox.test.ts`](../apps/desktop/src/main/harness/sandbox.test.ts) | Retained harness audit, confinement, or bounded-retry module/test from the initial working tree. |
| [`apps/desktop/src/main/harness/sandbox.ts`](../apps/desktop/src/main/harness/sandbox.ts) | OS-isolated command execution and cancellation; CI environment for checks. |
| [`apps/desktop/src/main/harness/validation.test.ts`](../apps/desktop/src/main/harness/validation.test.ts) | Discovery, launch failure, actual sandboxed exit/output regressions. |
| [`apps/desktop/src/main/harness/validation.ts`](../apps/desktop/src/main/harness/validation.ts) | Discover and execute project checks with output, exit codes, timeout, and abort signal. |
| [`apps/desktop/src/main/skills/skill-preferences.ts`](../apps/desktop/src/main/skills/skill-preferences.ts) | Persisted skill filtering and disabled-skill catalog. |
| [`apps/desktop/src/renderer/src/app/desktop-bridge.test.ts`](../apps/desktop/src/renderer/src/app/desktop-bridge.test.ts) | Preload API validation or missing-bridge regression coverage. |
| [`apps/desktop/src/renderer/src/app/desktop-bridge.ts`](../apps/desktop/src/renderer/src/app/desktop-bridge.ts) | Preload API validation or missing-bridge regression coverage. |
| [`apps/desktop/src/renderer/src/app/workspace-selection.test.ts`](../apps/desktop/src/renderer/src/app/workspace-selection.test.ts) | Pure validated selection restoration or empty/stale-state regression coverage. |
| [`apps/desktop/src/renderer/src/app/workspace-selection.ts`](../apps/desktop/src/renderer/src/app/workspace-selection.ts) | Pure validated selection restoration or empty/stale-state regression coverage. |
| [`apps/desktop/src/renderer/src/components/code/CodeDiff.tsx`](../apps/desktop/src/renderer/src/components/code/CodeDiff.tsx) | Editable Monaco diff editor with model/subscription disposal. |
| [`apps/desktop/src/renderer/src/features/calculator/Calculator.tsx`](../apps/desktop/src/renderer/src/features/calculator/Calculator.tsx) | Carried-over working-tree change preserved (including project recents, platform Git tests, branding, or calculator support). |
| [`apps/desktop/src/renderer/src/features/harness/BottomPanel.tsx`](../apps/desktop/src/renderer/src/features/harness/BottomPanel.tsx) | Real terminal, validation, log, and problem views with output resizing. |
| [`apps/desktop/src/renderer/src/features/harness/HarnessPanels.tsx`](../apps/desktop/src/renderer/src/features/harness/HarnessPanels.tsx) | Plan, timeline, validation, native/proposed diff, status, and approval views. |
| [`apps/desktop/src/renderer/src/features/harness/useHarnessEvents.ts`](../apps/desktop/src/renderer/src/features/harness/useHarnessEvents.ts) | Load and stream harness events without consuming chat preparation buffers. |
| [`apps/desktop/src/renderer/src/styles/harness.css`](../apps/desktop/src/renderer/src/styles/harness.css) | Dark workspace tabs, status panel, and resizable output panel. |
| [`apps/desktop/src/shared/harness.ts`](../apps/desktop/src/shared/harness.ts) | Shared harness phases, plans, validation, and change-event contracts. |
| [`docs/mylo-implementation-report.md`](../docs/mylo-implementation-report.md) | This diagnosis, evidence, limits, and full file inventory. |
