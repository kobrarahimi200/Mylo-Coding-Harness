// Measures real Electron renderer behaviour against a deterministic loopback model.
// Usage: electron scripts/perf-probe.mjs [path-to-main-bundle]. Prints one JSON line (PERF_RESULT).
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, dialog, ipcMain } from "electron";

const bundle = process.argv.find((arg) => arg.endsWith("index.js")) ?? "out/main/index.js";
const root = realpathSync(mkdtempSync(join(tmpdir(), "mylo-perf-")));
const project = join(root, "project");
mkdirSync(project);
writeFileSync(join(project, "README.md"), "# perf fixture\n");
const TOKENS = 200;
const TOKEN_INTERVAL_MS = 8;

const calls = new Map();
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) =>
  originalHandle(channel, (...args) => {
    calls.set(channel, (calls.get(channel) ?? 0) + 1);
    return listener(...args);
  });

const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const send = (delta, finish = null) =>
    res.write(
      `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 1, model: "probe", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
    );
  send({ role: "assistant", content: "" });
  for (let index = 0; index < TOKENS; index++) {
    send({ content: `token${index} ` });
    await new Promise((resolve) => setTimeout(resolve, TOKEN_INTERVAL_MS));
  }
  send({}, "stop");
  res.end("data: [DONE]\n\n");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
app.setPath("userData", join(root, "prefs"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = join(root, "sessions");
mkdirSync(process.env.PI_CODING_AGENT_DIR);
writeFileSync(
  join(process.env.PI_CODING_AGENT_DIR, "models.json"),
  JSON.stringify({
    providers: {
      probe: {
        api: "openai-completions",
        baseUrl: `http://127.0.0.1:${port}/v1`,
        apiKey: "synthetic-local-only",
        models: [
          { id: "probe", name: "Probe", contextWindow: 32768, maxTokens: 4096, reasoning: false },
        ],
      },
    },
  }),
);
writeFileSync(
  join(process.env.PI_CODING_AGENT_DIR, "settings.json"),
  JSON.stringify({
    defaultProvider: "probe",
    defaultModel: "probe",
    defaultProjectTrust: "always",
    compaction: { enabled: false },
    retry: { enabled: false },
  }),
);

const result = {};
const startedAt = Date.now();
const timeout = setTimeout(() => finish(new Error("perf probe timed out")), 120000);
function finish(error) {
  clearTimeout(timeout);
  if (error) console.error(error);
  else console.log(`PERF_RESULT ${JSON.stringify(result)}`);
  server.closeAllConnections();
  server.close();
  rmSync(root, { recursive: true, force: true });
  app.exit(error ? 1 : 0);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.on("browser-window-created", (_event, window) => {
  window.webContents.setBackgroundThrottling(false);
  window.webContents.once("did-finish-load", async () => {
    const evaluate = (source) => window.webContents.executeJavaScript(source);
    const waitFor = async (source, limit = 600) => {
      for (let index = 0; index < limit; index++) {
        if (await evaluate(source)) return;
        await sleep(25);
      }
      throw new Error(`Condition failed: ${source}\n${await evaluate("document.body.innerText")}`);
    };
    try {
      result.mainReadyMs = Date.now() - startedAt;
      await waitFor('document.body.innerText.includes("Open Project")');
      result.firstInteractiveMs = Math.round(await evaluate("performance.now()"));
      result.firstContentfulPaintMs = Math.round(
        await evaluate(
          "performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? -1",
        ),
      );
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
      await evaluate(
        "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Open Project').click()",
      );
      await waitFor('document.body.innerText.includes("What are we building?")');
      await sleep(800);

      // Explorer refresh load: 60 file creations 25ms apart.
      calls.clear();
      const burstStart = Date.now();
      for (let index = 0; index < 60; index++) {
        writeFileSync(join(project, `burst-${index}.txt`), String(index));
        await sleep(25);
      }
      await sleep(2500);
      result.explorerBurst = {
        writes: 60,
        durationMs: Date.now() - burstStart,
        filesList: calls.get("files:list") ?? 0,
        gitChanges: calls.get("git:changes") ?? 0,
      };

      // Trickle of changes inside one of three expanded folders.
      for (const dir of ["a", "b", "c"]) {
        mkdirSync(join(project, dir));
        writeFileSync(join(project, dir, "seed.txt"), dir);
      }
      await waitFor(
        "Array.from(document.querySelectorAll('.mylo-project-explorer .mylo-tree-row')).filter(b=>['a','b','c'].includes(b.textContent.trim())).length===3",
      );
      for (const dir of ["a", "b", "c"]) {
        await evaluate(
          `Array.from(document.querySelectorAll('.mylo-project-explorer .mylo-tree-row')).find(b=>b.textContent.trim()===${JSON.stringify(dir)}).click()`,
        );
      }
      await waitFor(
        "document.querySelectorAll('.mylo-project-explorer .mylo-tree-row').length >= 8",
      );
      await sleep(1500);
      calls.clear();
      for (let index = 0; index < 12; index++) {
        writeFileSync(join(project, "a", `trickle-${index}.txt`), String(index));
        await sleep(400);
      }
      await sleep(2500);
      result.explorerTrickle = {
        writes: 12,
        filesList: calls.get("files:list") ?? 0,
        gitChanges: calls.get("git:changes") ?? 0,
      };

      // Streaming responsiveness while the model streams tokens.
      await evaluate(`
        window.__perf = { gaps: [], long: 0, longTotal: 0, last: performance.now(), on: true };
        const tick = (now) => { const p = window.__perf; if (p.on) { p.gaps.push(now - p.last); p.last = now; requestAnimationFrame(tick); } };
        requestAnimationFrame(tick);
        try { new PerformanceObserver((list) => { for (const e of list.getEntries()) { window.__perf.long++; window.__perf.longTotal += e.duration; } }).observe({ entryTypes: ['longtask'] }); } catch {}
        Array.from(document.querySelectorAll('fieldset[aria-label=Mode] button')).find(b=>b.textContent.trim()==='Ask')?.click();
        document.querySelector('[contenteditable]').focus();
      `);
      await window.webContents.insertText("stream measurement one");
      const sendAt = Date.now();
      await evaluate(
        "Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')==='Send' && !b.disabled).click()",
      );
      await waitFor("document.body.innerText.includes('token0')", 1200);
      result.streaming = { firstTokenMs: Date.now() - sendAt };
      await waitFor(`document.body.innerText.includes('token${TOKENS - 1}')`, 1200);
      result.streaming.completeMs = Date.now() - sendAt;
      const frames = await evaluate(
        "(() => { const p = window.__perf; p.on = false; const g = p.gaps.slice(1).sort((a,b)=>a-b); return { frames: g.length, p95: g[Math.floor(g.length*0.95)] ?? 0, max: g[g.length-1] ?? 0, over50: g.filter(x=>x>50).length, longTasks: p.long, longTaskMs: Math.round(p.longTotal) }; })()",
      );
      result.streaming.frameGapP95Ms = Math.round(frames.p95);
      result.streaming.frameGapMaxMs = Math.round(frames.max);
      result.streaming.framesOver50ms = frames.over50;
      result.streaming.longTasks = frames.longTasks;
      result.streaming.longTaskTotalMs = frames.longTaskMs;
      await sleep(500);

      // Session switch latency between two sessions.
      await evaluate(
        "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='New chat').click()",
      );
      await waitFor('document.body.innerText.includes("What are we building?")');
      await evaluate("document.querySelector('[contenteditable]').focus()");
      await window.webContents.insertText("second probe chat");
      await evaluate(
        "Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')==='Send' && !b.disabled).click()",
      );
      await waitFor("document.body.innerText.includes('token199')", 1200);
      await sleep(800);
      const titles = ["second probe chat", "stream measurement one"];
      const samples = [];
      for (let index = 0; index < 8; index++) {
        const title = titles[index % 2];
        const before = Date.now();
        const clicked = await evaluate(
          `(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes(${JSON.stringify(title)}) && x.getClientRects().length); if (!b) return false; b.click(); return true; })()`,
        );
        if (!clicked) throw new Error(`session row not found: ${title}`);
        await waitFor(
          `Array.from(document.querySelectorAll('header, [class*=toolbar]')).some(h => h.textContent.includes(${JSON.stringify(title)}))`,
          400,
        );
        samples.push(Date.now() - before);
        await sleep(150);
      }
      samples.sort((a, b) => a - b);
      result.sessionSwitchMs = {
        samples: samples.length,
        median: samples[Math.floor(samples.length / 2)],
        max: samples.at(-1),
      };
      finish();
    } catch (error) {
      finish(error);
    }
  });
});
await import(pathToFileURL(join(process.cwd(), bundle)).href);
