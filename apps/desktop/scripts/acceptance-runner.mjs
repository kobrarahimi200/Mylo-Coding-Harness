import { spawn } from "node:child_process";
import electron from "electron";

if (process.platform !== "darwin") {
  throw new Error(
    "The desktop acceptance fixture currently requires macOS sandbox-exec. Windows WSL checks are separate; this command does not silently skip them.",
  );
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ["scripts/acceptance.mjs"], { env, stdio: "inherit" });
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
