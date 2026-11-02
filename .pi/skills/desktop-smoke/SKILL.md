---
name: desktop-smoke
description: "Run the real-Electron smoke and acceptance tests (macOS only) and the perf probe for the Mylo desktop app."
---

# Desktop smoke, acceptance and perf

Run from `apps/desktop` on macOS. These start real Electron with a loopback fake model.

- Build first when main or preload code changed: `npx electron-vite build`.
- Smoke: `npm run test:smoke`
- Acceptance (plan, approval, validation, correction, rollback): `npm run test:acceptance`
- Perf probe (explorer refreshes, streaming frame gaps, session switch): `npm run perf:probe`

Rules:
- Stop any running dev app first (`kill <PID>`); a stale Electron holds the single-instance lock.
- Do not claim a pass unless the command printed PASS. Perf numbers are single-run indications, not benchmarks.
- Keep the `aria-label` names the acceptance script clicks (Chats, File Explorer, Skills, History, Open Settings).
