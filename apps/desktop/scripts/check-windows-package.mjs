import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const binary = fileURLToPath(
  new URL("../../../target/release/modus-pty-host.exe", import.meta.url),
);
if (!existsSync(binary) || readFileSync(binary).subarray(0, 2).toString() !== "MZ") {
  console.error(
    "Windows packaging requires a Windows native PTY helper. On Windows, run npm --workspace @modus/desktop run build first, then package:win. This host's macOS/Linux helper cannot be put in a Windows installer.",
  );
  process.exit(1);
}
