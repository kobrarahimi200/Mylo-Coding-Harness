Mylo Coding Harness
Local-first desktop coding workspace powered by the Pi agent runtime. Mylo connects repository exploration, implementation planning, human approval, file edits, command execution, validation, and review inside an Electron app.
Project status: In development. Features described below exist in the project source, but some integrations, model/provider configurations, UI navigation, and Windows sandbox dependencies still require end-to-end verification. A successful build alone is not proof of a fully working coding harness.

What Mylo does
- Workspaces & sessions: Import local repositories and keep separate conversations by workspace.
- Ask / Plan / Agent modes: Ask read-only questions; propose a plan without editing; or execute a coding task with approval.
- Human-in-the-loop: Review plans, proposed file changes, sensitive commands, and final results.
- Pi tools & skills: Access approved file and shell operations through the existing Pi coding-agent integration, with project trust and skill discovery.
- Validation & self-correction: Run supported npm/Cargo checks with approval and retry corrections up to three times after failed validation.
- Review & recovery: View changes, validation output and task timelines; keep modifications for manual review or use available checkpoint rollback functionality.
- Desktop tools: Monaco-based editor, file explorer, terminal, test/log panels and model/provider settings.
Mylo does not replace the LLM. It orchestrates model reasoning, tooling and approval. Features requiring inference still need a connected and compatible provider or locally configured model.
Setup
Prerequisites:
- Node.js >= 22.19.0 and npm
- Rust/Cargo, for the native PTY host
- Git
- A supported Pi model provider configured in the desktop app
git clone https://github.com/kobrarahimi200/Mylo-Coding-Harness.git
cd Mylo-Coding-Harness
npm install
npm run dev
Important: main and development branches may not contain the same feature set. To work with a particular development branch, check it out explicitly after cloning:
git branch -a
git switch fix/mylo-harness-acceptance-20261027
npm install
npm run dev
The dev renderer is pinned to port 5173 (strictPort), so startup fails if the port is taken. Stop the existing dev server first; on macOS, lsof -nP -iTCP:5173 -sTCP:LISTEN shows the process using it. Mylo is single-instance: a leftover Electron process silently blocks new launches (and shows a blank window if its dev server died), so quit or kill it before restarting.

The renderer URL alone is not a standalone app: run it through Electron so its preload and IPC workspace APIs are available.
First run
1. Select Import project or Open Project, then choose a local repository.
2. Open Settings to connect and test a supported model provider.
3. Use the model selector to pick an available/configured model. The model list is determined by the Pi registry, configured credentials, provider support and account restrictions; it is not an unrestricted list of all models.
4. Choose the interaction mode in the chat composer:
   - Ask: Read-only repository questions, no file edits.
   - Plan: Inspect repository files and produce a reviewable plan.
   - Agent: Request implementation and approve the plan once; file changes in the approved plan are applied without further prompts. Shell commands and the validation step still ask separately. Then review real changes and validation.
5. Use the left rail (Chats, Projects, File Explorer, Skills, Tests, History) and the right panel (Files, Browser, Terminal) for details. Some views depend on a workspace or active session.

The app uses a light theme by default; a theme stored from an earlier run may override it.
Harness flow
User task
  -> Pi read-only planning
  -> Human review/approval
  -> Pi tool execution (subject to permissions and sandbox)
  -> Approved validation commands
  -> At most three self-correction retries, if validation fails
  -> Final review and saved execution history
Approval types are different: plan approval authorizes the task and its file changes; shell commands and validation are approved separately; final review accepts or leaves the result for inspection. Rejecting or keeping files for manual review is not evidence of a provider failure.

Validation states: Passed, Failed, Skipped (by user) and Not Configured (no applicable scripts). A skipped or missing validation step must never be reported as passed.
Models and performance
Mylo discovers Pi-compatible models through its provider registry and filters them based on authentication and account configuration. To access alternative or faster options, configure their provider first and refresh the catalog in Settings. Model latency depends on network, backend/model choice, context size, thinking level and the time consumed by tool calls, approval and tests. "Fast" must not be hardcoded as a promise or used to bypass safety checks.

For troubleshooting, record timings separately for model response, Pi tool calls, validation, workspace scanning and renderer updates. Use the production build for representative UI performance measurements; dev mode includes additional overhead.
Verification
npm run check
npm test
npm --workspace @modus/desktop run typecheck
npm --workspace @modus/desktop run build
npm --workspace @modus/desktop run test:smoke
npm --workspace @modus/desktop run test:acceptance
The acceptance runner in the development branch is designed to use a temporary Vue + TypeScript project and controlled model responses. This is not the same as verifying an external model or the app on Windows. See the source scripts for platform requirements and exclusions.

A useful manual acceptance task:
In Agent mode, create mylo-proof.js exporting add(a,b), wait for approval, write it using a real file tool, read it back, execute a small test, and show the recorded tool events and actual file diff.

Verify the file on disk and command exit code independently. Generated text claiming success is not sufficient.
Windows
Build and package on Windows with Node.js, Rust and Git:
npm ci
npm run check
npm test
npm run build
npm --workspace @modus/desktop run package:win -- --x64 --publish never
Sandbox caveat: Agent shell commands on Windows currently rely on a configured WSL environment with Bash and Bubblewrap plus the required Linux toolchain. The standard Windows installer does not automatically guarantee those dependencies are present. The native terminal and isolated agent execution are separate concerns. Do not disable isolation to work around missing dependencies.
Custom skill example
Create <workspace>/.pi/skills/my-review/SKILL.md:
---
name: my-review
description: Read repository errors and propose small, testable improvements.
---
Inspect the relevant source and tests. State what you verified versus inferred.
Then open Skills and enable it. Project resources follow Pi's existing trust rules.

You can also manage skills in the app: Skills → New skill creates, and Edit/Delete modify, a SKILL.md in the Pi agent directory's skills/ folder (name: lowercase letters, digits and hyphens, up to 64 characters). Editing and deleting are limited to skills created this way and are blocked while the agent is running.
Architecture
- Desktop: Electron, React, TypeScript, Tailwind CSS
- Editor/terminal: Monaco, xterm.js, native Rust PTY
- Agent: @earendil-works/pi-coding-agent
- Main harness: apps/desktop/src/main/harness/
- Agent integration: apps/desktop/src/main/agent/pi-sdk-runtime.ts
- Renderer: apps/desktop/src/renderer/src/
- Secure bridge: apps/desktop/src/preload/
- Shared packages: packages/ (agent-protocol, config, core, ui); apps/web is a placeholder
- Docs: docs/architecture/
Known limitations / work in progress
- Some sidebar icons do not provide a distinct visible navigation state in older builds.
- Switching sessions and restoring task/review state require regression testing.
- Model options are restricted by configured providers and authorized account access.
- Performance should be profiled with real usage; startup/build success is not a latency benchmark.
- Windows sandboxed execution requires external WSL/Bubblewrap configuration and live testing.
License
Apache-2.0. See LICENSE. Mylo incorporates work derived from the Modus desktop project; preserve attribution and notices where required.