---
name: add-ipc-api
description: "Add a new main-process capability exposed to the renderer through Electron IPC in the Mylo repo."
---

# Add an IPC API

Touch these files under `apps/desktop/src`, in order:

1. `main/ipc/channels.ts`: add the channel name to `IPC_CHANNELS`.
2. `main/ipc/schemas.ts`: add a zod schema for the input.
3. `main/ipc/register-app-ipc.ts`: `ipcMain.handle(...)`, call `assertTrustedSender(event)` and validate with `parseIpcInput(schema, input, channel)`.
4. `preload/index.ts` and `preload/types.ts`: expose and type the method on `window.modus`.
5. Renderer: call `window.modus.<area>.<method>`.
6. Add a vitest test for the main-side logic, then run the verify-changes skill.

Never expose raw `ipcRenderer`, and never skip sender or input validation.
