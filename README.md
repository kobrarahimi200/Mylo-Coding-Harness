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

Modus is an open-source desktop app for running AI coding agents inside real local projects.

Open a workspace, connect your PI model provider, chat with PI, and inspect your project in one window.

Modus is early and currently runs best from source.

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
git clone https://github.com/brandlll-lee/modus.git
cd modus
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
```

The Electron smoke runner uses temporary projects/preferences, checks empty
startup and real PTY output, and launches a second process to verify restoration.
Pi integration tests use deterministic provider responses; they do not validate
an external provider's credentials or service availability.

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
Local verification results and file inventory: [implementation report](docs/mylo-implementation-report.md).
