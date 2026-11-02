<p align="center">
  English | <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img alt="Modus logo" src="./docs/media/modus-logo.png" width="96" height="96">
</p>

<h1 align="center">Mylo Coding Harness</h1>

<p align="center">
  Local-first desktop workspace for AI coding agents.
</p>

<p align="center">
  <a href="#getting-started">Getting started</a> ·
  <a href="#features">Features</a> ·
  <a href="./docs/architecture/desktop-security.md">Security</a>
</p>

![Modus desktop UI](./docs/media/modus-ui.png)

## About

Mylo Coding Harness (the app is still named Modus in code and some assets) is an open-source desktop app for running AI coding agents inside real local projects.

Open a workspace, connect your PI model provider, chat with PI, and inspect your project in one window.

Mylo Coding Harness is early and currently runs best from source.

**Attribution:** this project is derived from [Modus by brandlll-lee](https://github.com/brandlll-lee/modus), licensed under Apache-2.0. The original license is preserved in [LICENSE](./LICENSE).

## Features

- **Workspaces and sessions** - Open local projects, switch recent workspaces, pin projects, and keep separate agent sessions per repo.
- **Bring your own models** - Configure built-in or custom PI-compatible providers, defaults, reasoning effort, thinking variants, and model limits.
- **Editing diffs** - Inspect PI's native file edit results in the chat.
- **Terminal, browser, and files** - Use a real PTY terminal, an in-app browser with tabs and DevTools, and a workspace file explorer.
- **Files and images** - Select local paths and preview images before sending them to PI.
- **MCP, skills, and extensions** - Use PI resource discovery, project trust, and extension commands.

## Getting Started

Requirements for Windows and macOS:

- Node.js `>= 22.19.0`
- npm
- Rust + Cargo
- Git

```bash
git clone https://github.com/kobrarahimi200/Mylo-Coding-Harness.git
cd Mylo-Coding-Harness
npm install
npm run dev
```

Then click **Import project** in the Projects sidebar and select a local folder.
Use the project's **…** menu to edit project files, rename its sidebar label, show
its folder, or remove it from the app. Removing a project preserves its local files
and saved chats; import the folder again to restore access. **Delete chats** is a
separate action with a confirmation dialog.

**Edit project files** opens the file explorer and editor. Select a file, edit it,
and save with Cmd+S on macOS or Ctrl+S on Windows/Linux. Configure a model provider
in Settings to use the coding agent.

## Development

```bash
npm run dev
npm run check
npm run test
npm --workspace @modus/desktop run typecheck
npm --workspace @modus/desktop run build
```

Package locally:

```bash
npm --workspace @modus/desktop run package:win -- --publish never
npm --workspace @modus/desktop run package:mac -- --publish never
```

Run the Windows command on Windows and the macOS command on macOS.

## MCP Config

Modus uses PI's MCP configuration and the MCP extension selected by PI:

```text
~/.pi/agent/mcp.json
<workspace>/.pi/mcp.json
```

`PI_CODING_AGENT_DIR` selects a different global directory. Project resources follow
PI's trust rules. Installed MCP extensions own their configuration discovery and credentials.

## Tech Stack

Electron, React, TypeScript, Tailwind CSS, Base UI, Motion, Monaco, xterm.js, Streamdown, Rust `portable-pty`, `@earendil-works/pi-coding-agent`.

## Contributing

Contributions are welcome. Keep PRs small, use Conventional Commits, and run `npm run check` plus `npm run test` before opening a PR.

## License

Apache-2.0. See [LICENSE](./LICENSE).

## Navigation

The left rail has one highlighted current page (`aria-current="page"`):

| Icon | Behavior |
| --- | --- |
| Projects | Toggles the project sidebar (pressed state, not a page) |
| Chat | Chat view; the single place to start a task |
| File Explorer | File tree and editor (needs an open project) |
| Skills | Skill management (needs an open project) |
| Tests | Toggles the bottom Tests panel |
| History | Run timeline (needs an open project) |
| Settings | Settings page |

Navigating to a view closes the Tests tab so no panel is left covering the content. Behavior is covered by `navigation.test.ts` and `NavigationRail.test.tsx`.

## Model setup and selection

- Configure providers in **Settings → Models and providers**. Credentials stay in Pi's own `auth.json` / `models.json`; Mylo does not copy them.
- The model picker lists every model Pi knows. Models you cannot use are shown disabled with a reason (missing credentials, or not in the signed-in ChatGPT account's catalog).
- Search by name or provider, and filter by **All / Available / Fast**.
- **Fast** is never inferred from names or hardcoded IDs. A model is marked Fast only after **Test connection** measured a completion at or below 2.5 s on this machine; the measurement is stored locally.
- Settings can store a separate default model for **Ask** and **Agent** mode. They apply to new chats started from the home composer; models inside an existing chat change only manually.
- Thinking levels (including Off/Low) appear only for models whose Pi metadata supports them.

## Performance notes

Changes: the project explorer coalesces filesystem-watch events (750 ms trailing window, max 1.5 s in the watcher) and refreshes only expanded folders that contain a changed path; agent events are batched into one React update per 32 ms without dropping any event.

Measured with `npm run perf:probe -w apps/desktop` (real Electron, loopback fake model, single runs on a busy development Mac, so treat as indicative only):

| Scenario | Before | After |
| --- | --- | --- |
| 12 writes, 400 ms apart, into 1 of 3 expanded folders: `files:list` calls | 60 | 18 |
| Same: `git:changes` calls | 12 | 6 |
| 60 writes at 25 ms (dense burst): `files:list` calls | 2 | 3 |
| Startup, first interactive render, streaming frame gaps, session switch | unchanged within noise | unchanged within noise |

The dense burst is slightly worse because of the max-wait flush that guarantees updates during continuous writes. Duplicate `agent:event` listeners (agent view and harness view) and a second file listing in the Files panel are not yet deduplicated.

## Testing

```bash
npm run check          # biome + typecheck
npm run test           # vitest
npm run test:smoke -w apps/desktop       # real Electron smoke (macOS)
npm run test:acceptance -w apps/desktop  # real Electron acceptance (macOS)
```

## Known issues and limits

- Windows: the real-Electron smoke/acceptance runners are macOS-only. WSL2 isolation requires a prepared self-hosted runner; hosted CI alone does not prove it.
- Run state is held in memory; a task interrupted by quitting the app is shown as cancelled on reopen, not resumed.
- Model speed has no verified provider metadata; Fast requires a local connection test.
- Performance figures above come from single runs and are not a benchmark suite.

## Mylo harness workflow

1. Start the **desktop app** with `npm run dev`. Opening the Vite renderer URL in a
   browser does not load Electron's preload API and cannot access local projects.
2. Choose **Open Project**, then configure a Pi model provider in Settings.
3. Submit a coding request in Chat. The existing Pi session explores the project
   with read-only file tools and returns a repository-specific JSON plan.
4. Edit the goal and steps in the review dialog, then approve or reject execution.
5. Approve commands and code mutations individually. Proposed code appears in an
   editable Monaco diff before it is applied. Unknown extension tools without a
   confinement policy and commands requiring unavailable isolation stay blocked.
6. Approve validation. Mylo discovers npm `test`, `lint`, `typecheck` / `check`, and
   Cargo `test` / `check` commands where available. Tests, Logs, and Problems show
   actual output and exit codes. Missing or skipped checks are explicitly marked.
7. Failed validation is fed back into the same Pi session, with at most **three
   corrections** after the first validation attempt. Stop agent cancels approvals,
   Pi execution, and validation subprocesses.
8. Review diffs and validation before accepting the result. Keeping a result for
   manual review preserves approved file edits on disk; it does not roll them back.

Use the left rail for Projects, File Explorer, Skills, Tests, History, and Settings.
The main editor and file tree, project sidebar, right inspector, agent panel, and
bottom output panel retain or provide resizing controls. Project and session
selection restore only when they still refer to an imported project.

### Custom Pi skills

Create `.pi/skills/my-review/SKILL.md` in your project:

```markdown
---
name: my-review
description: Review the project's error handling and regression tests.
---
Read the relevant source and tests. Explain failure cases and propose a small fix.
```

Open an active session's **Skills** view. Enable/disable discovered skills with the
checkbox, or use **Add skill folder** for another trusted directory. Reload
configuration after adding a skill on disk. Disabled skills are persisted and
filtered from Pi's actual resource loader and slash commands. Stop the current
task before changing skills. Existing Pi extensions still use Pi's discovery and
project-trust flow; Mylo does not run a separate agent engine.

### Verification and installers

```bash
npm run check
npm test
cargo test --workspace
npm run build
npm --workspace @modus/desktop run test:smoke
npm --workspace @modus/desktop run test:acceptance
```

The Electron smoke runner uses temporary projects/preferences, checks empty
startup and real PTY output, and launches a second process to verify restoration. On macOS it also verifies
reopening a closed window without registering duplicate IPC handlers.
Pi integration tests use deterministic provider responses; they do not validate
an external provider's credentials or service availability.

`test:acceptance` runs on macOS and launches an isolated Electron window with a
minimal Vue + TypeScript project. A loopback model fixture drives the existing Pi
engine through read-only exploration, editable plan approval, file diff approval,
real failing npm tests, correction, passing tests/typecheck, and final acceptance.
Only inference is mocked; the desktop UI, Pi tools, Vue compiler, TypeScript, and
sandboxed subprocesses are real. Dependencies are copied from installed dev
packages into the temporary workspace so tests need no downloads or credentials.

Validation results distinguish **PASSED**, **FAILED**, **SKIPPED** (user choice),
and **NOT CONFIGURED** (no supported scripts). Final review explicitly states
whether validation passed; accepting a result does not turn skipped checks into
successful checks.

An additional opt-in macOS test uses your existing Pi sign-in and selected model
to exercise real planning, editable file approval, an intentionally failing npm
test, correction, and a passing rerun. It sends only a generated temporary fixture
to the provider, isolates project/settings context, and does not copy credentials:

```bash
MYLO_LIVE_HARNESS=1 npx vitest run apps/desktop/src/main/agent/pi-sdk-runtime.live.test.ts
```

It defaults to `openai/gpt-6.1-sol`; set `MYLO_LIVE_MODEL=provider/model` to use
another connected model. Normal `npm test` skips this network-dependent test.

Build the Windows installer **on Windows** with Node.js, Rust, and Git installed:

```powershell
npm ci
npm run check
npm test
npm run build
npm --workspace @modus/desktop run test:smoke
npm --workspace @modus/desktop run package:win -- --x64 --publish never
```

The Windows workflow uploads `Mylo-Coding-Harness-*-Setup.exe`. Packaging checks
for a Windows native PTY executable and never substitutes a macOS/Linux helper.
Windows agent shell execution requires WSL, bubblewrap, bash, and the project's
Linux toolchain. The interactive terminal uses the native Windows PTY helper.
Before an agent command, Mylo checks the default WSL distribution's tools and
actually creates an isolated namespace. Missing distributions, dependencies, or
namespace permissions stop execution with setup instructions. It never runs the
agent command in an unrestricted Windows shell. Windows paths are converted with
`wslpath`; only the approved project is mounted at `/workspace`. Provider
credentials, Windows drives, and the host network are not exposed to that sandbox.

For the Windows sandbox, install WSL 2 and complete the default distro's first
launch. On Ubuntu install `bubblewrap`, `util-linux`, and system-wide Linux
Node.js/npm (under `/usr` or `/usr/local`), plus project dependencies. Projects
using other Linux toolchains must provide them under `/usr`, `/usr/local`, or
inside the approved project directory.
The sandbox has no network access, so install dependencies before agent execution.
Run the real isolation checks on a configured Windows machine with PowerShell:

```powershell
$env:MYLO_WSL_TESTS = "1"
npx vitest run apps/desktop/src/main/harness/windows-sandbox.live.test.ts
```

The Windows workflow's optional `verify_wsl` input runs those checks on a
self-hosted Windows x64 runner labeled `mylo-wsl2`. The normal hosted Windows job
checks, builds, tests the native terminal, and packages the x64 installer. The
optional WSL job requires that prepared runner; hosted packaging alone does not
prove WSL isolation works. See [WSL commands](https://learn.microsoft.com/en-us/windows/wsl/basic-commands)
and [Bubblewrap](https://github.com/containers/bubblewrap/blob/main/README.md).
Local verification results and file inventory: [implementation report](docs/mylo-implementation-report.md).

### Recovering a failed model connection

If a task stops during planning, use **Connect / change provider** in the task's
recovery panel. The original request, context, and attachments remain available
for **Retry task**.

For ChatGPT authentication, open **Settings → Model & Provider → OpenAI → Sign in
with ChatGPT**, then complete the browser consent flow. Pi manages the credential
and installation identity. Mylo fetches the signed-in account's model catalog;
API models outside that catalog are not offered as ChatGPT choices. Select a
listed model, use **Test connection**, then **Use model** to update the current
session and default. Finding credentials alone does not prove a model request
will succeed.

The integration follows the [official model-list and inference contract](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).
Authentication does not silently fall back to the API-key billing path.
