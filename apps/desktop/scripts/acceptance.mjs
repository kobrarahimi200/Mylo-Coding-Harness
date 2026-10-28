import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, dialog } from "electron";
import { prepareVueFixture } from "./vue-fixture.mjs";

// Real Electron, preload, Pi, tools, Vue, TypeScript, and test subprocesses.
// Only inference is deterministic and served over a loopback HTTP connection.
const root = realpathSync(mkdtempSync(join(tmpdir(), "mylo-vue-acceptance-")));
const project = join(root, "project");
prepareVueFixture(project);
const broken = readFileSync(join(project, "src/counter.ts"), "utf8");
const fixed = broken.replace("-=", "+=");
let requestCount = 0;
let connectionTestCount = 0;
let rejectTask = false;
const replies = [
  { read: "src/counter.ts" },
  {
    content: JSON.stringify({
      goal: "Fix the Vue reactive counter",
      steps: [
        "Read src/counter.ts and tests/counter.cjs",
        "Fix increment",
        "Run npm test and npm run typecheck",
      ],
    }),
  },
  { tool: broken },
  { content: "Initial implementation ready for checks." },
  { tool: fixed },
  { content: "Corrected the counter after validation failed." },
];
const server = createServer(async (req, res) => {
  try {
    if (req.url !== "/v1/chat/completions") {
      res.writeHead(404).end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(input.model, "vue-fixture");
    const connectionTest = JSON.stringify(input.messages).includes("Reply with OK.");
    if ((connectionTest && ++connectionTestCount > 1) || (!connectionTest && rejectTask)) {
      res.writeHead(401, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          error: { message: "Fixture connection rejected", type: "authentication_error" },
        }),
      );
      return;
    }
    const reply = connectionTest ? { content: "OK" } : replies[requestCount++];
    assert.ok(reply, "Unexpected extra model request");
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const usesTool = reply.tool !== undefined || reply.read !== undefined;
    const delta = usesTool
      ? {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: `fixture-${requestCount}`,
              type: "function",
              function: {
                name: reply.read ? "read" : "write",
                arguments: JSON.stringify(
                  reply.read
                    ? { path: reply.read }
                    : { path: "src/counter.ts", content: reply.tool },
                ),
              },
            },
          ],
        }
      : { role: "assistant", content: reply.content };
    const chunk = (value, finish_reason = null) => ({
      id: `completion-${requestCount}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "vue-fixture",
      choices: [{ index: 0, delta: value, finish_reason }],
    });
    res.write(`data: ${JSON.stringify(chunk(delta))}\n\n`);
    res.write(`data: ${JSON.stringify(chunk({}, usesTool ? "tool_calls" : "stop"))}\n\n`);
    res.end("data: [DONE]\n\n");
  } catch (error) {
    console.error(error);
    res.writeHead(500).end(String(error));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
app.setPath("userData", join(root, "preferences"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = join(root, "sessions");
mkdirSync(process.env.PI_CODING_AGENT_DIR);
writeFileSync(
  join(process.env.PI_CODING_AGENT_DIR, "models.json"),
  JSON.stringify({
    providers: {
      acceptance: {
        api: "openai-completions",
        baseUrl: `http://127.0.0.1:${port}/v1`,
        apiKey: "synthetic-local-only",
        models: [
          {
            id: "vue-fixture",
            name: "Vue acceptance fixture",
            contextWindow: 32768,
            maxTokens: 4096,
            reasoning: false,
          },
        ],
      },
    },
  }),
);
writeFileSync(
  join(process.env.PI_CODING_AGENT_DIR, "settings.json"),
  JSON.stringify({
    defaultProvider: "acceptance",
    defaultModel: "vue-fixture",
    defaultTools: ["read", "write"],
    defaultProjectTrust: "always",
    compaction: { enabled: false },
    retry: { enabled: false },
  }),
);
const errors = [];
let finishing = false;
const timeout = setTimeout(() => finish(new Error("Vue desktop acceptance timed out")), 90000);
function finish(error) {
  if (finishing) return;
  finishing = true;
  clearTimeout(timeout);
  if (error) console.error(error);
  else
    console.log(
      "PASS: Vue desktop acceptance — empty startup, UI import, model selection, editable plan, reviewed writes, real failed tests, Pi correction, passed tests/typecheck, final human acceptance, editor tabs/drafts/save, rollback conflict protection and compact/expanded layout",
    );
  server.closeAllConnections();
  server.close();
  rmSync(root, { recursive: true, force: true });
  app.exit(error ? 1 : 0);
}
app.on("browser-window-created", (_event, window) => {
  window.webContents.setBackgroundThrottling(false);
  window.webContents.on("preload-error", (_event, path, error) => errors.push(`${path}: ${error}`));
  window.webContents.on("console-message", (event) => {
    if (event.level === "error") errors.push(event.message);
  });
  window.webContents.once("did-finish-load", async () => {
    const evaluate = (source) => window.webContents.executeJavaScript(source);
    const waitFor = async (source) => {
      for (let i = 0; i < 300; i++) {
        if (await evaluate(source)) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(
        `Condition failed: ${source}\nUI: ${await evaluate("document.body.innerText")}\nControls: ${JSON.stringify(await evaluate("({task:document.querySelector('#mylo-task')?.value,buttons:Array.from(document.querySelectorAll('button')).filter(b=>b.textContent.includes('Generate')).map(b=>({text:b.textContent,disabled:b.disabled,title:b.title})),model:document.querySelector('[aria-label=\"Workspace AI model\"]')?.value})"))}\nErrors: ${JSON.stringify(errors)}`,
      );
    };
    const hasButton = (label) =>
      `Array.from(document.querySelectorAll('button')).some(b => (b.textContent.trim() === ${JSON.stringify(label)} || b.getAttribute('aria-label') === ${JSON.stringify(label)}) && !b.disabled && b.getClientRects().length)`;
    const click = async (label) => {
      await waitFor(hasButton(label));
      await evaluate(
        `Array.from(document.querySelectorAll('button')).find(b => (b.textContent.trim() === ${JSON.stringify(label)} || b.getAttribute('aria-label') === ${JSON.stringify(label)}) && !b.disabled && b.getClientRects().length).click()`,
      );
    };
    const mouseClick = async (expression) => {
      await waitFor(
        `Boolean((${expression})?.getClientRects().length) && !(${expression}).disabled`,
      );
      await evaluate(`(${expression}).scrollIntoView({block:'nearest'})`);
      await waitFor(
        `(()=>{const b=(${expression}),r=b.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===b})()`,
      );
      const point = await evaluate(
        `(()=>{const r=(${expression}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
      );
      window.webContents.sendInputEvent({ type: "mouseMove", ...point });
      window.webContents.sendInputEvent({
        type: "mouseDown",
        button: "left",
        clickCount: 1,
        ...point,
      });
      window.webContents.sendInputEvent({
        type: "mouseUp",
        button: "left",
        clickCount: 1,
        ...point,
      });
    };
    try {
      await waitFor('document.body.innerText.includes("Open Project")');
      assert.equal((await evaluate("window.modus.workspace.list()")).length, 0);
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
      await click("Open Project");
      await waitFor(
        'document.body.innerText.includes("project") && document.body.innerText.includes("Vue acceptance fixture")',
      );
      await evaluate(
        "const selector=document.querySelector('[aria-label=\"Workspace AI model\"]');selector.value='acceptance/vue-fixture';selector.dispatchEvent(new Event('change',{bubbles:true}));",
      );
      await waitFor(
        "Array.from(document.querySelectorAll('button')).some(button=>button.textContent.trim()==='Generate Plan' && button.title==='Pi explores the repository using read-only tools')",
      );
      assert.equal(
        await evaluate("Boolean(document.querySelector('[aria-label=Calculator]'))"),
        false,
      );
      await mouseClick(
        "document.querySelector('nav[aria-label=\"Main navigation\"] button[aria-label=Skills]')",
      );
      await waitFor(
        "document.querySelector('[aria-label=\"Workspace views\"] [aria-selected=true]')?.textContent==='Skills'",
      );
      await mouseClick("document.querySelector('button[aria-label=Chats]')");
      await waitFor(
        "document.querySelector('[aria-label=\"Workspace views\"] [aria-selected=true]')?.textContent==='Chat'",
      );
      await mouseClick("document.querySelector('button[aria-label=\"File Explorer\"]')");
      await waitFor(
        "document.querySelector('[aria-label=\"Workspace views\"] [aria-selected=true]')?.textContent==='Code'",
      );
      await mouseClick("document.querySelector('button[aria-label=History]')");
      await waitFor(
        "document.querySelector('[aria-label=\"Workspace views\"] [aria-selected=true]')?.textContent==='Timeline'",
      );
      await mouseClick("document.querySelector('button[aria-label=Chats]')");
      await waitFor(
        "document.querySelector('[aria-label=\"Workspace views\"] [aria-selected=true]')?.textContent==='Chat'",
      );
      await mouseClick("document.querySelector('button[aria-label=\"Open Settings\"]')");
      await mouseClick(
        "Array.from(document.querySelectorAll('.context-sidebar button')).find(b=>b.textContent.trim()==='Skills')",
      );
      await waitFor(
        "document.querySelector('.context-sidebar [aria-current=page]')?.textContent==='Skills'",
      );
      await mouseClick("document.querySelector('button[aria-label=\"Open Settings\"]')");
      await waitFor(
        "document.querySelector('.context-sidebar [aria-current=page]')?.textContent==='Model & Provider'",
      );
      await mouseClick(
        "Array.from(document.querySelectorAll('.settings-content button[aria-haspopup=dialog]')).find(b=>b.textContent.toLowerCase().startsWith('acceptance'))",
      );
      const testButton =
        "Array.from(document.querySelectorAll('[role=dialog] button')).find(b=>b.textContent.trim()==='Test connection')";
      await mouseClick(testButton);
      await waitFor(
        "document.querySelector('[role=dialog] [role=status]')?.textContent.includes('Received a response from acceptance/vue-fixture')",
      );
      await mouseClick(testButton);
      await waitFor(
        "document.querySelector('[role=dialog] [role=status]')?.textContent.includes('Fixture connection rejected')",
      );
      assert.equal(
        await evaluate(
          "document.querySelector('.context-sidebar [aria-current=page]')?.textContent",
        ),
        "Model & Provider",
      );
      assert.equal(connectionTestCount, 2);
      assert.equal(requestCount, 0, "Connection tests must not start a coding task");
      await mouseClick("document.querySelector('button[aria-label=\"Close provider details\"]')");
      await waitFor("!document.querySelector('[role=dialog]')");
      await mouseClick("document.querySelector('button[aria-label=Chats]')");
      await evaluate(
        "window.acceptanceEvents=[];window.acceptanceRejections=[];window.addEventListener('unhandledrejection',event=>window.acceptanceRejections.push({message:event.reason?.message,stack:event.reason?.stack}));window.modus.agent.onEvent(event=>window.acceptanceEvents.push(event));document.querySelector('#mylo-task').focus()",
      );
      await evaluate(
        "const task=document.querySelector('#mylo-task');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(task,'Fix the failing unit test.');task.dispatchEvent(new Event('input',{bubbles:true}));",
      );
      await click("Generate Plan");
      await waitFor(hasButton("Approve plan"));
      assert.equal(requestCount, 2, "Execution began before plan approval");
      // Closing animation completion must never gate delivery of an approval.
      await evaluate(
        "const style=document.createElement('style');style.textContent='.dialog-surface[data-ending-style], .dialog-backdrop[data-ending-style] { transition-duration: 3600s !important; }';document.head.append(style)",
      );
      await click("Approve plan");
      await waitFor(hasButton("Apply change"));
      assert.equal(readFileSync(join(project, "src/counter.ts"), "utf8"), broken);
      await click("Apply change");
      await click("Run checks");
      await waitFor(hasButton("Apply change"));
      assert.ok(
        await evaluate(
          "window.acceptanceEvents.some(e=>e.type==='harness.validation' && e.status==='failed' && e.exitCode===1)",
        ),
      );
      await click("Apply change");
      await waitFor(hasButton("Accept result"));
      assert.equal(readFileSync(join(project, "src/counter.ts"), "utf8"), fixed);
      assert.ok(
        await evaluate(
          "window.acceptanceEvents.some(e=>e.type==='harness.validation' && e.label==='npm run test' && e.status==='passed' && e.exitCode===0)",
        ),
      );
      assert.ok(
        await evaluate(
          "window.acceptanceEvents.some(e=>e.type==='harness.validation' && e.label==='npm run typecheck' && e.status==='passed' && e.exitCode===0)",
        ),
      );
      assert.ok(
        await evaluate(
          "window.acceptanceEvents.some(e=>e.type==='harness.change' && e.before!==e.after)",
        ),
      );
      assert.equal(
        await evaluate("window.acceptanceEvents.some(e=>e.type==='run.completed')"),
        false,
      );
      await click("Accept result");
      await waitFor("window.acceptanceEvents.some(e=>e.type==='run.completed')");
      await click("Diff");
      await waitFor('document.body.innerText.includes("src/counter.ts")');
      await click("Output");
      await click("Tests");
      await waitFor(
        'document.body.innerText.includes("PASSED") && document.body.innerText.includes("FAILED")',
      );
      assert.equal(requestCount, 6);
      // Exercise actual editor buffers, tab/panel persistence and guarded rollback.
      const notes = "export const note = 'unrelated user content';\n";
      await evaluate(
        `window.modus.files.write({cwd:${JSON.stringify(project)},path:'src/notes.ts',content:${JSON.stringify(notes)}})`,
      );
      await click("Code");
      await evaluate(
        "Array.from(document.querySelectorAll('[aria-label=\"Project Explorer\"] button')).find(b=>b.title==='src').click()",
      );
      await waitFor(
        "Array.from(document.querySelectorAll('[aria-label=\"Project Explorer\"] button')).some(b=>b.title==='src/counter.ts')",
      );
      await evaluate(
        "Array.from(document.querySelectorAll('[aria-label=\"Project Explorer\"] button')).find(b=>b.title==='src/counter.ts').click()",
      );
      await waitFor(
        "Array.from(document.querySelectorAll('[aria-label=\"Open files\"] [role=tab]')).some(b=>b.textContent.includes('counter.ts'))",
      );
      await waitFor(
        "document.querySelector('[aria-label=\"Code editor src/counter.ts\"] textarea') !== null",
      );
      const userDraft = `${fixed}\n// Unsaved user draft\n`;
      const monacoAssets = new URL("../out/renderer/assets/", import.meta.url);
      const monacoFile = readdirSync(fileURLToPath(monacoAssets)).find(
        (name) => name.startsWith("editor.main-") && name.endsWith(".js"),
      );
      if (!monacoFile) throw new Error("Built Monaco module was not found");
      const monacoModule = new URL(monacoFile, monacoAssets).href;
      // Use Monaco's public edit API to drive its real model/change listeners;
      // native IME injection differs between textarea and EditContext backends.
      await evaluate(`(async()=>{
        const monaco=await import(${JSON.stringify(monacoModule)});
        const api=monaco.editor ?? Object.values(monaco).find(value=>typeof value?.getEditors==='function');
        if(!api)throw new Error('Monaco editor API is unavailable');
        const editor=api.getEditors().find(editor=>editor.getDomNode()?.closest('[aria-label="Code editor src/counter.ts"]'));
        if(!editor)throw new Error('Editable Monaco instance was not found');
        editor.focus();
        editor.executeEdits('acceptance-user',[{range:editor.getModel().getFullModelRange(),text:${JSON.stringify(userDraft)}}]);
      })()`);
      await waitFor(
        "Array.from(document.querySelectorAll('[aria-label=\"Open files\"] [role=tab]')).some(b=>b.textContent.includes('●')&&b.textContent.includes('counter.ts'))",
      );
      await evaluate(
        "Array.from(document.querySelectorAll('[aria-label=\"Project Explorer\"] button')).find(b=>b.title==='src/notes.ts').click()",
      );
      await waitFor(
        "Array.from(document.querySelectorAll('[aria-label=\"Open files\"] [role=tab]')).some(b=>b.textContent.includes('notes.ts'))",
      );
      await click("Chat");
      await click("Code");
      await evaluate(
        "Array.from(document.querySelectorAll('[aria-label=\"Open files\"] [role=tab]')).find(b=>b.textContent.includes('counter.ts')).click()",
      );
      await click("Save");
      await waitFor(
        `window.modus.files.read({cwd:${JSON.stringify(project)},path:'src/counter.ts'}).then(file=>file.content===${JSON.stringify(userDraft)})`,
      );
      await click("Rollback");
      await waitFor(
        "document.body.textContent.includes('This file changed after the agent proposal')",
      );
      assert.equal(
        await evaluate(
          "Array.from(document.querySelectorAll('.mylo-dialog-actions button')).find(b=>b.textContent.includes('Restore')).disabled",
        ),
        true,
      );
      assert.equal(readFileSync(join(project, "src/notes.ts"), "utf8"), notes);
      await evaluate(
        "Array.from(document.querySelectorAll('.mylo-dialog-actions button')).find(b=>b.textContent.trim()==='Close').click()",
      );
      window.setSize(900, 700);
      await waitFor("window.innerWidth === 900");
      await click("Collapse Agent Workspace");
      await waitFor("document.body.scrollWidth <= window.innerWidth");
      await click("Code");
      assert.equal(
        await evaluate(
          "document.querySelectorAll('[aria-label=\"Open files\"] [role=tab]').length",
        ),
        2,
      );
      window.setSize(1440, 900);
      await waitFor("window.innerWidth === 1440");
      await click("Toggle Agent Workspace");
      await waitFor(
        "document.querySelector('[aria-label=\"Agent Workspace\"]')?.clientWidth >= 300",
      );
      const screenshot = fileURLToPath(
        new URL("../../../output/playwright/mylo-workspace.png", import.meta.url),
      );
      mkdirSync(dirname(screenshot), { recursive: true });
      writeFileSync(screenshot, (await window.capturePage()).toPNG());
      // Exercise the recovery banner too: a provider shortcut must not reopen
      // the previously selected Skills settings, and testing must stay inline.
      rejectTask = true;
      await click("Chat");
      await evaluate(
        "const nextTask=document.querySelector('#mylo-task');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(nextTask,'Fixture provider failure');nextTask.dispatchEvent(new Event('input',{bubbles:true}));",
      );
      await click("Generate Plan");
      await waitFor("document.body.innerText.includes('Authentication failed')");
      await mouseClick("document.querySelector('button[aria-label=\"Open Settings\"]')");
      await mouseClick(
        "Array.from(document.querySelectorAll('.context-sidebar button')).find(b=>b.textContent.trim()==='Skills')",
      );
      await waitFor(
        "document.querySelector('.context-sidebar [aria-current=page]')?.textContent==='Skills'",
      );
      await mouseClick("document.querySelector('button[aria-label=Chats]')");
      await mouseClick(
        "Array.from(document.querySelectorAll('section[role=alert] button')).find(b=>b.textContent.trim()==='Test connection')",
      );
      await waitFor(
        "Array.from(document.querySelectorAll('section[role=alert] > p:last-child')).some(p=>p.textContent.includes('Fixture connection rejected'))",
      );
      assert.equal(connectionTestCount, 3);
      assert.equal(
        await evaluate("document.querySelector('.context-sidebar').getClientRects().length"),
        0,
      );
      await mouseClick(
        "Array.from(document.querySelectorAll('section[role=alert] button')).find(b=>b.textContent.trim()==='Connect / change provider')",
      );
      await waitFor(
        "document.querySelector('.context-sidebar [aria-current=page]')?.textContent==='Model & Provider'",
      );
      const rejections = await evaluate("window.acceptanceRejections");
      if (rejections.length) console.error("Renderer rejections", JSON.stringify(rejections));
      assert.deepEqual(errors, []);
      finish();
    } catch (error) {
      finish(error);
    }
  });
});
await import("../out/main/index.js");
