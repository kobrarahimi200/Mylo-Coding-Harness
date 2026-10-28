import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electron from "electron";

const root = mkdtempSync(join(tmpdir(), "mylo-restart-smoke-"));
const env = { ...process.env, MYLO_SMOKE_ROOT: root };
delete env.ELECTRON_RUN_AS_NODE;
try {
  for (const restore of process.platform === "darwin" ? ["0", "1", "reopen"] : ["0", "1"]) {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(electron, ["scripts/smoke.mjs"], {
        env: { ...env, MYLO_SMOKE_RESTORE: restore },
        stdio: "inherit",
      });
      child.on("error", reject);
      child.on("exit", resolve);
    });
    if (code !== 0) throw new Error(`Electron smoke phase ${restore} failed: ${code}`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
