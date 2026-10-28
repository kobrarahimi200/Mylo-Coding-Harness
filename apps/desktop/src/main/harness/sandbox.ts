import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { dirname } from "node:path";
import type { BashOperations } from "@earendil-works/pi-coding-agent";
import {
  cleanupWindowsSandbox,
  ensureWindowsSandbox,
  windowsControlEnvironment,
  windowsSandboxInvocation,
} from "./windows-sandbox";

export type SandboxInvocation = { executable: string; args: string[] };

// Approval is not confinement. Never fall back to an unrestricted host shell.
export function sandboxInvocation(
  cwd: string,
  executable: string,
  args: string[],
  platform = process.platform,
  runId = randomUUID(),
): SandboxInvocation {
  const root = realpathSync(cwd);
  if (platform === "darwin") {
    const literal = (value: string) => JSON.stringify(value);
    // Node resolves executable symlinks and the working directory one parent
    // at a time. Permit stat on those parents without exposing their contents.
    const parents = new Set(["/opt"]);
    for (let parent = dirname(root); parent !== dirname(parent); parent = dirname(parent))
      parents.add(parent);
    const profile = [
      "(version 1)",
      "(deny default)",
      "(allow process*)",
      "(allow sysctl-read)",
      "(allow mach-lookup)",
      ...[...parents].map((path) => `(allow file-read-metadata (literal ${literal(path)}))`),
      ...[
        "/usr",
        "/bin",
        "/sbin",
        "/System",
        "/Library",
        "/dev",
        "/opt/homebrew",
        "/opt/local",
      ].map((path) => `(allow file-read* (subpath ${literal(path)}))`),
      `(allow file-read* file-write* (subpath ${literal(root)}))`,
      '(allow file-read* (literal "/") (literal "/private") (literal "/private/tmp"))',
      '(allow file-read* (literal "/private/var/select/sh"))',
      '(allow file-read* file-write* (literal "/dev/null"))',
    ].join("\n");
    return { executable: "/usr/bin/sandbox-exec", args: ["-p", profile, executable, ...args] };
  }
  if (platform === "win32") {
    return windowsSandboxInvocation(root, executable, args, runId);
  }
  if (platform === "linux" && existsSync("/usr/bin/bwrap")) {
    const mounts = ["/usr", "/bin", "/lib", "/lib64"]
      .filter(existsSync)
      .flatMap((path) => ["--ro-bind", path, path]);
    return {
      executable: "/usr/bin/bwrap",
      args: [
        "--unshare-all",
        "--die-with-parent",
        ...mounts,
        "--proc",
        "/proc",
        "--dev",
        "/dev",
        "--tmpfs",
        "/tmp",
        "--bind",
        root,
        root,
        "--chdir",
        root,
        "--",
        executable,
        ...args,
      ],
    };
  }
  throw new Error("No supported OS sandbox backend is available. Command execution is blocked.");
}

export function sandboxOperations(
  root: string,
  shell = "/bin/bash",
  platform = process.platform,
): BashOperations {
  return {
    exec: async (command, cwd, options) => {
      if (realpathSync(cwd) !== realpathSync(root))
        throw new Error("Unapproved command workspace.");
      if (options.signal?.aborted) throw new Error("Sandbox command cancelled.");
      if (platform === "win32") await ensureWindowsSandbox(options.signal);
      const runId = randomUUID();
      const invocation = sandboxInvocation(root, shell, ["-c", command], platform, runId);
      return await new Promise((resolve, reject) => {
        const child = spawn(invocation.executable, invocation.args, {
          cwd: root,
          detached: platform !== "win32",
          windowsHide: true,
          // Do not forward provider credentials or agent metadata to child processes.
          env: {
            ...(platform === "win32" ? windowsControlEnvironment() : {}),
            PATH: process.env.PATH,
            HOME: root,
            TMPDIR: root,
            TEMP: root,
            TMP: root,
            CI: "true",
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let interrupted: string | undefined;
        let stopping: Promise<void> | undefined;
        const stop = (reason: string) => {
          if (interrupted) return;
          interrupted = reason;
          if (platform === "win32") {
            stopping = cleanupWindowsSandbox(runId)
              .catch((error: unknown) => {
                interrupted += ` WSL cleanup failed: ${String(error)}`;
              })
              .finally(() => child.kill("SIGKILL"));
            return;
          }
          if (child.pid) {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch {
              child.kill("SIGKILL");
            }
          }
        };
        const abort = () => stop("Sandbox command cancelled.");
        const timer = setTimeout(
          () => stop(`Sandbox command timed out after ${options.timeout ?? 120} seconds.`),
          (options.timeout ?? 120) * 1000,
        );
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) abort();
        child.stdout.on("data", options.onData);
        child.stderr.on("data", options.onData);
        const clean = () => {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", abort);
        };
        child.once("error", (error) => {
          clean();
          reject(error);
        });
        child.once("close", async (exitCode) => {
          await stopping;
          clean();
          if (interrupted) {
            reject(new Error(interrupted));
            return;
          }
          resolve({ exitCode });
        });
      });
    },
  };
}
