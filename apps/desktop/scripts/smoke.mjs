import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { app, dialog } from "electron";

const root = process.env.MYLO_SMOKE_ROOT ?? mkdtempSync(join(tmpdir(), "mylo-electron-smoke-"));
const restoring = process.env.MYLO_SMOKE_RESTORE === "1";
const project = join(root, "project");
mkdirSync(project, { recursive: true });
writeFileSync(join(project, "hello.txt"), "original\n");
app.setPath("userData", root);
process.env.PI_CODING_AGENT_DIR = join(root, "pi");
process.env.PI_CODING_AGENT_SESSION_DIR = join(root, "sessions");
mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
const errors = [];
const timeout = setTimeout(() => finish(new Error("Electron smoke test timed out")), 45000);
function finish(error) {
  clearTimeout(timeout);
  if (error) console.error(error);
  else
    console.log(
      "PASS: Electron preload, empty startup, import, edit, removal, and persisted project restore",
    );
  // Exit promptly: this isolated test owns all its processes and temporary files.
  if (!process.env.MYLO_SMOKE_ROOT) rmSync(root, { recursive: true, force: true });
  app.exit(error ? 1 : 0);
}
app.on("browser-window-created", (_event, window) => {
  window.webContents.on("preload-error", (_event, path, error) =>
    errors.push(`${path}: ${error.stack}`),
  );
  window.webContents.on("console-message", (event) => {
    if (event.level === "error") errors.push(event.message);
  });
  window.webContents.once("did-finish-load", async () => {
    try {
      const evaluate = (source) => window.webContents.executeJavaScript(source);
      const waitFor = async (source) => {
        for (let count = 0; count < 100; count++) {
          if (await evaluate(source)) return;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error(
          `UI condition not reached: ${source}\nRenderer errors: ${JSON.stringify(errors)}\nUI: ${await evaluate("document.body.innerText")}`,
        );
      };
      if (process.argv.includes("--inspect-ui")) {
        clearTimeout(timeout);
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
        console.log("READY: isolated Mylo UI inspection");
        return;
      }
      if (restoring) {
        await waitFor('document.body.innerText.includes("Smoke project")');
        const workspaces = await evaluate("window.modus.workspace.list()");
        assert.equal(workspaces.length, 1);
        assert.equal(workspaces[0].displayName, "Smoke project");
        await waitFor('document.body.innerText.includes("Saved fixture response")');
        const sessions = await evaluate("window.modus.agent.list()");
        assert.ok(sessions.some((session) => session.title === "Saved smoke session"));
        assert.deepEqual(errors, []);
        console.log("PASS: workspace restored across a full Electron process restart");
        finish();
        return;
      }
      await waitFor('document.body.innerText.includes("Open Project")');
      assert.equal(await evaluate("typeof window.modus.workspace.open"), "function");
      assert.deepEqual(await evaluate("window.modus.workspace.list()"), []);
      assert.deepEqual(errors, []);
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
      await evaluate(
        `Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Open Project').click()`,
      );
      await waitFor(
        'document.body.innerText.includes("project") && !document.body.innerText.includes("Open Project")',
      );
      const workspaces = await evaluate("window.modus.workspace.list()");
      assert.equal(workspaces.length, 1);
      const workspace = workspaces[0];
      await evaluate(
        `window.modus.files.write({cwd:${JSON.stringify(project)},path:"hello.txt",content:"edited\\n"})`,
      );
      assert.equal(
        (
          await evaluate(
            `window.modus.files.read({cwd:${JSON.stringify(project)},path:"hello.txt"})`,
          )
        ).content,
        "edited\n",
      );
      await evaluate(
        `window.modus.workspace.rename({id:${JSON.stringify(workspace.id)},displayName:"Smoke project"})`,
      );
      await window.webContents.reload();
      await waitFor('document.body.innerText.includes("Smoke project")');
      const terminalOutput = await evaluate(`(async () => {
        let output = '';
        const unsub = window.modus.terminal.onEvent(event => { if (event.type === 'terminal.data') output += event.data; });
        const terminal = await window.modus.terminal.create({ workspaceId: ${JSON.stringify(workspace.id)}, cwd: ${JSON.stringify(project)} });
        await window.modus.terminal.write({ terminalId: terminal.id, data: ${JSON.stringify(process.platform === "win32" ? "Write-Output ('MYLO_' + 'PTY_OK')\r" : "printf 'MYLO_%s\\n' PTY_OK\r")} });
        for (let i = 0; i < 100 && !output.includes('MYLO_PTY_OK'); i++) await new Promise(resolve => setTimeout(resolve, 100));
        unsub();
        await window.modus.terminal.kill(terminal.id);
        return output;
      })()`);
      assert.ok(terminalOutput.includes("MYLO_PTY_OK"), "PTY did not return real shell output");
      await evaluate(`window.modus.workspace.remove(${JSON.stringify(workspace.id)})`);
      window.webContents.reload();
      await waitFor('document.body.innerText.includes("Open Project")');
      assert.deepEqual(await evaluate("window.modus.workspace.list()"), []);
      assert.deepEqual(errors, []);
      // Leave a saved workspace for the runner's second, independent Electron process.
      await evaluate("window.modus.workspace.open()");
      const restored = (await evaluate("window.modus.workspace.list()"))[0];
      await evaluate(
        `window.modus.workspace.rename({id:${JSON.stringify(restored.id)},displayName:"Smoke project"})`,
      );
      const manager = SessionManager.create(project, process.env.PI_CODING_AGENT_SESSION_DIR);
      manager.appendMessage({
        role: "user",
        content: "Smoke persisted question",
        timestamp: Date.now(),
      });
      manager.appendMessage(fauxAssistantMessage("Saved fixture response"));
      manager.appendSessionInfo("Saved smoke session");
      await evaluate("window.modus.agent.list()");
      await evaluate(
        `localStorage.setItem('mylo.workspace', ${JSON.stringify(restored.id)}); localStorage.setItem('mylo.session', ${JSON.stringify(manager.getSessionId())});`,
      );
      window.webContents.reload();
      await waitFor('document.body.innerText.includes("Saved fixture response")');
      finish();
    } catch (error) {
      finish(error);
    }
  });
});
await import("../out/main/index.js");
