import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import type { BashOperations } from "@earendil-works/pi-coding-agent";

export type SandboxInvocation = { executable: string; args: string[] };

// Approval is not confinement. Never fall back to an unrestricted host shell.
export function sandboxInvocation(
  cwd: string,
  executable: string,
  args: string[],
  platform = process.platform,
): SandboxInvocation {
  const root = realpathSync(cwd);
  if (platform === "darwin") {
    const literal = (value: string) => JSON.stringify(value);
    const profile = [
      "(version 1)",
      "(deny default)",
      "(allow process*)",
      "(allow sysctl-read)",
      "(allow mach-lookup)",
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
      '(allow file-read* file-write* (literal "/dev/null"))',
    ].join("\n");
    return { executable: "/usr/bin/sandbox-exec", args: ["-p", profile, executable, ...args] };
  }
  if (platform === "win32") {
    // WSL only launches the sandbox. Bubblewrap hides all host mounts except this workspace.
    // Requires a WSL distro with bubblewrap, bash, and the workspace's Linux toolchain.
    const launcher = `set -eu
root=$(/usr/bin/wslpath -u "$1")
shift
if [ -d /lib64 ]; then set -- --ro-bind /lib64 /lib64 "$@"; fi
exec /usr/bin/bwrap --unshare-all --die-with-parent --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib --proc /proc --dev /dev --tmpfs /tmp --bind "$root" /workspace --chdir /workspace "$@"`;
    return {
      executable: "wsl.exe",
      args: ["--exec", "/bin/sh", "-c", launcher, "mylo-sandbox", root, "--", executable, ...args],
    };
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

export function sandboxOperations(root: string, shell = "/bin/bash"): BashOperations {
  return {
    exec: async (command, cwd, options) => {
      if (realpathSync(cwd) !== realpathSync(root))
        throw new Error("Unapproved command workspace.");
      const invocation = sandboxInvocation(root, shell, ["-c", command]);
      return await new Promise((resolve, reject) => {
        const child = spawn(invocation.executable, invocation.args, {
          cwd: root,
          detached: process.platform !== "win32",
          windowsHide: true,
          // Do not forward provider credentials or agent metadata to child processes.
          env: {
            PATH: process.env.PATH,
            HOME: root,
            TMPDIR: root,
            TEMP: root,
            TMP: root,
            CI: "true",
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        const stop = () => {
          if (child.pid) {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch {
              child.kill("SIGKILL");
            }
          }
        };
        const timer = setTimeout(stop, (options.timeout ?? 120) * 1000);
        options.signal?.addEventListener("abort", stop, { once: true });
        if (options.signal?.aborted) stop();
        child.stdout.on("data", options.onData);
        child.stderr.on("data", options.onData);
        const clean = () => {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", stop);
        };
        child.once("error", (error) => {
          clean();
          reject(error);
        });
        child.once("close", (exitCode) => {
          clean();
          resolve({ exitCode });
        });
      });
    },
  };
}
