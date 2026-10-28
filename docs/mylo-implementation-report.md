# Mylo implementation and acceptance report

For the subsequent workspace redesign, updated **365-test** verification and
current limitations, see [Mylo workspace redesign report](mylo-workspace-redesign-report.md).
The results below describe the earlier stabilization milestone.

Verified locally on **macOS arm64, 2026-10-27 (Europe/Berlin)**.
Branch: `fix/mylo-harness-acceptance-20261027`.

Work uses the existing Modus application, Electron/preload bridge, native Pi
sessions, tools, skills, resource loader and history. No second engine or new
application was created. Changes already present at the beginning of this task
were preserved. Nothing was committed, pushed, merged or published.

## Root causes and corrections

1. **Workspace receiver:** the original `.workspace` exception refers to a missing
   `window.modus` preload API, not to a valid null project selection. The original
   production stack was not supplied. The source-traced reproduction is:

   ```text
   Sidebar Open Project / Import project
     → App.onOpenWorkspace
     → useWorkspaceSessions.openWorkspace
     → window.modus.workspace.open()
     → TypeError: Cannot read properties of undefined (reading 'workspace')
   ```

   Desktop bridge validation occurs before workspace components mount. A missing
   preload shows a connection diagnostic; the Electron process logs preload
   errors. A clean desktop startup shows Open Project with dependent actions
   disabled. IPC independently verifies imported project/session boundaries.

2. **Partial startup failure:** `Promise.all` discarded usable project state when
   session discovery failed, and the cause was only logged to the console.
   Initial hydration now preserves independently successful data and surfaces
   actual errors in the interface. Deleted project folders are excluded from
   selectable recents; archived records remain available for history discovery.

3. **Invisible restored conversation:** smoke diagnostics proved that saved
   events and DOM text were intact, but the conversation wrapper was stuck at
   `opacity: 0`. It now mounts visible (`initial={false}`). The smoke test checks
   restored DOM content, geometry and opacity, rather than trusting body.innerText
   for content-visibility:auto sections. Two complete post-fix smoke cycles passed.

4. **Approval depended on animation:** approval IPC was sent only from the dialog
   closing-animation callback. It now sends immediately after the explicit user
   action, with a synchronous duplicate-submission guard and actionable IPC errors.
   Acceptance deliberately delays closing transitions for an hour; execution must
   still advance. File acceptance is disabled until the actual Monaco diff is ready.

5. **Monaco cancellation during disposal:** closing a diff before its asynchronous
   computation settled produced an unhandled Canceled rejection. The supported
   diff view-model API now waits before disposal. Initialization failures are
   displayed; they are not globally filtered or suppressed.

6. **Validation semantics/discovery:** missing scripts previously shared SKIPPED
   with a user's explicit skip, and an independent check script was omitted when
   lint/typecheck existed. Outcomes now distinguish PASSED, FAILED, SKIPPED and
   NOT CONFIGURED. Final acceptance explicitly states when no validation passed.
   Every configured npm test/lint/typecheck/check and supported Cargo test/check
   command is retained. Actual stdout/stderr, exit codes and bounded logs persist.

7. **Execution stability:** task locks cover planning through final review, blocking
   competing normal prompts. Provider errors stop execution/correction before
   additional validation attempts and retain the real cause. Correction remains
   bounded to three retries after the first failed validation run.

8. **Command execution:** macOS Node/npm could not lstat the `/opt` ancestor of
   Homebrew executables. Only required ancestor metadata and shell-selection
   reads were added. A real regression verifies external workspace files remain
   unreadable. Windows now probes dependencies and actual namespace creation,
   converts paths as argv, clears sandbox environment, and cancels the identified
   Linux process group rather than merely terminating the Windows WSL client.

9. **Approval path race:** a target directory could change into an escaping symlink
   while a user reviewed a proposal. Write/edit paths are rechecked after approval
   and at the final tool boundary. Both race cases have regression tests. Disallowed
   sensitive commands remain blocked, with an accurate policy explanation.

10. **Native terminal errors:** spawn failures and malformed sidecar output could
    become unhandled main-process errors; late callbacks could affect a replacement
    host. Errors now reach the terminal, affected sessions exit, and stale host
    callbacks cannot reset the replacement.

## Real workflow and acceptance evidence

`test:acceptance` launches isolated real Electron/preload and imports a minimal
Vue + TypeScript project through the Open Project UI. A loopback HTTP server
provides **deterministic model responses only** to the existing Pi engine.
No user credentials or private repositories are used.

The test selects its configured fixture model, submits “Fix the failing unit
test.” in the actual composer, performs read-only file exploration, waits for
editable plan approval, reviews native writes, runs actual npm tests/typecheck,
observes a deliberate assertion failure with exit 1, feeds it back through Pi,
reviews the correction, observes passing checks with exit 0, and waits for explicit
final acceptance. It then checks Diff and Tests panels and requires zero renderer
errors. Slow closing-animation regression is included. Native integration tests
separately hold final review, reject a destructive `rm -f` command, reject an
editable proposal, cancel execution, and discover/disable/re-enable a custom skill.

The fixture uses actual Vue reactivity, Vue SFC compilation and TypeScript.
Dependencies are copied inside the approved temporary project; host node_modules
symlinks would violate confinement. The deliberately broken source fixture remains
broken in this repository; only temporary copies are corrected during acceptance.

## Commands and results

| Command | Verified result |
| --- | --- |
| `npm run check` | Passed; TypeScript passed. 16 non-blocking Biome warnings and 1 informational diagnostic remain. |
| `npm run test` | Passed: **345 tests**, 66 files; **3 tests skipped** across 2 opt-in suites. |
| `npm --workspace @modus/desktop run typecheck` | Passed without TypeScript suppression. |
| `npm --workspace @modus/desktop run build` | Passed: Rust native PTY helper, Electron main/preload and renderer. |
| `cargo test --workspace` | Passed: 4 Rust tests, including actual PTY output. |
| `npm --workspace @modus/desktop run test:smoke` | Passed after the visibility fix; empty startup, import, save, remove, actual terminal output, process restart and macOS window reopening. Two complete consecutive cycles verified the diagnosed rendering regression. |
| `npm --workspace @modus/desktop run test:acceptance` | Passed on the final build with actual Vue tests/typecheck, one correction, diff readiness, final review, deliberately stalled closing animations and zero renderer errors. Inference is deterministic; UI/tools/commands are real. |
| `npm --workspace @modus/desktop run package:win -- --x64 --publish never` | **Failed at preflight on macOS:** no Windows-native PTY executable. No installer was produced or verified. |

The three skipped tests are one credential-dependent live Pi/ChatGPT test and
two real Windows/WSL integration tests. They are not counted as passes. Windows
contracts/setup failures/quoting/cancellation are tested with mocked subprocesses.
A prior native ChatGPT synthetic round trip passed on 2026-10-26 with exit codes
1 → 0 and one correction; that live-model test was not rerun on 2026-10-27.

During implementation the smoke test reproduced the opacity defect, and desktop
acceptance reproduced approval stalls and Monaco cancellation. Those failures were
investigated and the affected scenarios passed after correction. Intermediate
formatting/type errors were fixed and checks rerun; they are not reported as passes.

## Sandbox, Windows installer and remaining limits

- No unrestricted host-shell fallback is used for agent commands. Windows requires
  a configured default WSL 2 distribution, Bubblewrap/util-linux and system-visible
  Linux toolchains. The interactive terminal remains the native user-operated PTY.
- WSL commands mount only the approved project at `/workspace`, system toolchain
  directories read-only, a private temporary filesystem and proc/dev. Networking
  and other Windows drive mounts are not made available to project commands.
  Provider credentials are not forwarded into the clean sandbox environment.
- Cancellation uses a per-run identity and Linux process group. It does not shut
  down a user's distribution or unrelated WSL processes. Missing dependencies,
  failed isolation probes and cleanup failures are surfaced.
- Native Pi file tools retain canonical path checks, including post-approval
  rechecks. This is not a claim of a formal security audit against every possible
  concurrent host-filesystem race. Unknown extension tools without a confinement
  policy and disallowed sensitive commands stay blocked.
- Dependency installation/network access must happen before confined execution.
  Automatic validation discovery currently supports npm scripts and Cargo;
  unconfigured ecosystems are explicitly NOT CONFIGURED rather than successful.
- Windows x64 NSIS and target-specific PTY/runtime assets are configured. The hosted
  workflow checks/builds/smokes/packages and uploads an installer only if produced.
  Its optional verify_wsl job needs a prepared self-hosted Windows x64 runner
  labeled mylo-wsl2. No such runner or Windows host was available in this session.
- The local branch was not pushed, so the modified Windows workflow was not run
  remotely. **Actual Windows sandbox behavior and installer generation remain
  unverified.** No unverified native Windows isolation replacement was introduced.
- 16 existing non-blocking lint warnings and one informational diagnostic remain.
  No known failing local automated check remains after the corrections above.

Design references: [Microsoft WSL commands](https://learn.microsoft.com/en-us/windows/wsl/basic-commands)
and [Bubblewrap isolation model](https://github.com/containers/bubblewrap/blob/main/README.md).

## Exact current changed-file inventory

Includes accumulated changes already present when this task began, which were
preserved. This is the current feature branch working-tree diff, not a commit.

| File | Change |
| --- | --- |
| [.github/workflows/windows.yml](../.github/workflows/windows.yml) | Hosted Windows build/test/package checks; optional prepared WSL runner job; job timeouts. |
| [README.md](../README.md) | Usage, validation outcomes, Vue acceptance, opt-in live tests, WSL setup and installer instructions. |
| [apps/desktop/electron-builder.config.ts](../apps/desktop/electron-builder.config.ts) | Explicit Windows x64 NSIS target; native helper and runtime asset configuration retained. |
| [apps/desktop/package.json](../apps/desktop/package.json) | Vue development dependency and desktop acceptance command; existing development launch script retained. |
| [apps/desktop/scripts/acceptance-runner.mjs](../apps/desktop/scripts/acceptance-runner.mjs) | Launch isolated macOS Electron acceptance with the correct GUI environment. |
| [apps/desktop/scripts/acceptance.mjs](../apps/desktop/scripts/acceptance.mjs) | Loopback deterministic model plus full real desktop Vue/Pi correction workflow; stalled closing-animation regression. |
| [apps/desktop/scripts/smoke-runner.mjs](../apps/desktop/scripts/smoke-runner.mjs) | Three isolated processes on macOS, including closed-window reopening. |
| [apps/desktop/scripts/smoke.mjs](../apps/desktop/scripts/smoke.mjs) | Visible restored-turn assertions, rendering/history diagnostics, real PTY and import/restoration checks. |
| [apps/desktop/scripts/vue-fixture.d.mts](../apps/desktop/scripts/vue-fixture.d.mts) | Type declaration for the fixture preparation helper. |
| [apps/desktop/scripts/vue-fixture.mjs](../apps/desktop/scripts/vue-fixture.mjs) | Copy a fixture and its real Vue/TypeScript dependency closure inside its confined workspace. |
| [apps/desktop/src/main/agent/agent-store.test.ts](../apps/desktop/src/main/agent/agent-store.test.ts) | Deleted-project selection/history regression; existing directory discovery fixture corrected. |
| [apps/desktop/src/main/agent/model-service.test.ts](../apps/desktop/src/main/agent/model-service.test.ts) | Account catalog filtering, provider methods and connection-error regressions. |
| [apps/desktop/src/main/agent/model-service.ts](../apps/desktop/src/main/agent/model-service.ts) | Account-specific model catalog, native provider connection tests and auth/model errors. |
| [apps/desktop/src/main/agent/pi-sdk-runtime.live.test.ts](../apps/desktop/src/main/agent/pi-sdk-runtime.live.test.ts) | Opt-in real-model test using only isolated synthetic files and native Pi credentials. |
| [apps/desktop/src/main/agent/pi-sdk-runtime.test.ts](../apps/desktop/src/main/agent/pi-sdk-runtime.test.ts) | Native Pi integration; real Vue/npm/typecheck correction, explicit final review, missing/skipped checks, rejected edits and rejected destructive commands. |
| [apps/desktop/src/main/agent/pi-sdk-runtime.ts](../apps/desktop/src/main/agent/pi-sdk-runtime.ts) | Task locks, provider-error propagation, explicit validation outcomes and bounded corrections through the original Pi session. |
| [apps/desktop/src/main/agent/provider-login.test.ts](../apps/desktop/src/main/agent/provider-login.test.ts) | Native sign-in identity regression. |
| [apps/desktop/src/main/agent/provider-login.ts](../apps/desktop/src/main/agent/provider-login.ts) | Native Pi sign-in with persisted installation identity. |
| [apps/desktop/src/main/harness/approval-path-race.test.ts](../apps/desktop/src/main/harness/approval-path-race.test.ts) | Block write/edit targets replaced by an escaping symlink while approval is pending. |
| [apps/desktop/src/main/harness/approval-policy.test.ts](../apps/desktop/src/main/harness/approval-policy.test.ts) | Policy regressions; Windows-compatible directory junction fixture. |
| [apps/desktop/src/main/harness/approval-policy.ts](../apps/desktop/src/main/harness/approval-policy.ts) | One editable approval per proposal, canonical path rechecks after approval and accurate sensitive-command policy errors. |
| [apps/desktop/src/main/harness/planning.ts](../apps/desktop/src/main/harness/planning.ts) | Structured editable plan with one explicit approval before execution. |
| [apps/desktop/src/main/harness/sandbox.test.ts](../apps/desktop/src/main/harness/sandbox.test.ts) | Isolation invocation, actual macOS timeout/cancellation and already-cancelled launch checks. |
| [apps/desktop/src/main/harness/sandbox.ts](../apps/desktop/src/main/harness/sandbox.ts) | macOS executable-parent metadata fix, explicit timeout/cancellation and Windows isolation broker integration. |
| [apps/desktop/src/main/harness/validation.test.ts](../apps/desktop/src/main/harness/validation.test.ts) | Discovery, independent check script, actual npm execution and denied external reads. |
| [apps/desktop/src/main/harness/validation.ts](../apps/desktop/src/main/harness/validation.ts) | Retain independent check scripts alongside lint/typecheck; real command output and exit collection. |
| [apps/desktop/src/main/harness/windows-sandbox.live.test.ts](../apps/desktop/src/main/harness/windows-sandbox.live.test.ts) | Opt-in real Windows/WSL path conversion, npm validation, mount confinement and descendant cancellation checks. |
| [apps/desktop/src/main/harness/windows-sandbox.test.ts](../apps/desktop/src/main/harness/windows-sandbox.test.ts) | Mocked Windows subprocess contracts, missing dependencies, cancellation, secrets and hostile path quoting. |
| [apps/desktop/src/main/harness/windows-sandbox.ts](../apps/desktop/src/main/harness/windows-sandbox.ts) | Real WSL dependency/namespace probe, argv-safe path conversion, clean environment, confined mounts and per-run Linux process-group cancellation. |
| [apps/desktop/src/main/index.ts](../apps/desktop/src/main/index.ts) | Register IPC once and reopen closed macOS windows. |
| [apps/desktop/src/main/terminal/terminal-service.test.ts](../apps/desktop/src/main/terminal/terminal-service.test.ts) | PTY launch errors, malformed host output and stale-host replacement regressions. |
| [apps/desktop/src/main/terminal/terminal-service.ts](../apps/desktop/src/main/terminal/terminal-service.ts) | Handle native host launch/protocol errors; isolate callbacks from replaced hosts. |
| [apps/desktop/src/main/workspace/workspace-store.ts](../apps/desktop/src/main/workspace/workspace-store.ts) | Omit deleted/moved project directories from selectable recents while retaining archived records. |
| [apps/desktop/src/renderer/src/app/App.tsx](../apps/desktop/src/renderer/src/app/App.tsx) | Surface hydration errors; restored conversations start visible instead of depending on an opacity animation. |
| [apps/desktop/src/renderer/src/app/initial-hydration.test.ts](../apps/desktop/src/renderer/src/app/initial-hydration.test.ts) | Project state survives a failed session discovery and reports its cause. |
| [apps/desktop/src/renderer/src/app/initial-hydration.ts](../apps/desktop/src/renderer/src/app/initial-hydration.ts) | Recover project data independently of session-discovery failure and retain actionable errors. |
| [apps/desktop/src/renderer/src/app/useInitialHydration.ts](../apps/desktop/src/renderer/src/app/useInitialHydration.ts) | Show initial project/session/model loading failures in the UI. |
| [apps/desktop/src/renderer/src/components/code/CodeDiff.tsx](../apps/desktop/src/renderer/src/components/code/CodeDiff.tsx) | Loading/error states, readiness notification and safe Monaco view-model disposal after pending diff computation. |
| [apps/desktop/src/renderer/src/features/agent/ChatPane.tsx](../apps/desktop/src/renderer/src/features/agent/ChatPane.tsx) | Retained native model selection and failed-task recovery integration. |
| [apps/desktop/src/renderer/src/features/agent/ExtensionDialog.tsx](../apps/desktop/src/renderer/src/features/agent/ExtensionDialog.tsx) | Send approvals immediately, independent of closing animations; prevent duplicate submission and wait for review diffs to be ready. |
| [apps/desktop/src/renderer/src/features/harness/HarnessPanels.tsx](../apps/desktop/src/renderer/src/features/harness/HarnessPanels.tsx) | Readable distinct validation status labels driven by actual harness events. |
| [apps/desktop/src/shared/harness.ts](../apps/desktop/src/shared/harness.ts) | NOT CONFIGURED validation state and shared status labels. |
| [apps/desktop/test-fixtures/vue-ts/.gitignore](../apps/desktop/test-fixtures/vue-ts/.gitignore) | Exclude generated test compilation and installed fixture dependencies. |
| [apps/desktop/test-fixtures/vue-ts/package.json](../apps/desktop/test-fixtures/vue-ts/package.json) | Minimal real Vue/TypeScript fixture with test and typecheck scripts. |
| [apps/desktop/test-fixtures/vue-ts/src/App.vue](../apps/desktop/test-fixtures/vue-ts/src/App.vue) | Compilable Vue component using the reactive counter. |
| [apps/desktop/test-fixtures/vue-ts/src/counter.ts](../apps/desktop/test-fixtures/vue-ts/src/counter.ts) | Deliberately broken typed Vue counter for correction acceptance. |
| [apps/desktop/test-fixtures/vue-ts/tests/counter.cjs](../apps/desktop/test-fixtures/vue-ts/tests/counter.cjs) | Actual failing/passing reactive-counter unit test and Vue SFC compilation check. |
| [apps/desktop/test-fixtures/vue-ts/tsconfig.json](../apps/desktop/test-fixtures/vue-ts/tsconfig.json) | Fixture TypeScript checking configuration. |
| [docs/mylo-implementation-report.md](../docs/mylo-implementation-report.md) | Verified results, root causes, security limits and complete current file inventory. |
| [package-lock.json](../package-lock.json) | Locked Vue/compiler development dependency graph and required transitive packages. |

Total: **50 files**. No push or merge was performed.
