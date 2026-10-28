import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SandboxInvocation } from "./sandbox";

const execute = promisify(execFile);
const SETUP =
  "Windows agent commands require WSL 2 with a default Linux distribution. Run wsl --install -d Ubuntu, open Ubuntu to finish setup, then install bubblewrap and util-linux in that distribution (Ubuntu: sudo apt-get install bubblewrap util-linux). Install the project's Linux toolchain there. No host-shell fallback was used.";

const probe = `set -eu
for tool in /usr/bin/bwrap /usr/bin/wslpath /usr/bin/realpath /usr/bin/setsid /bin/bash; do
  [ -x "$tool" ] || { printf 'Missing sandbox dependency: %s\\n' "$tool" >&2; exit 78; }
done
set -- --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib
if [ -d /lib64 ]; then set -- "$@" --ro-bind /lib64 /lib64; fi
/usr/bin/bwrap --unshare-all --new-session --die-with-parent "$@" -- /bin/true
printf MYLO_SANDBOX_READY`;

export function windowsControlEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    USERPROFILE: process.env.USERPROFILE,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
  };
}

export async function ensureWindowsSandbox(signal?: AbortSignal): Promise<void> {
  try {
    const { stdout } = await execute("wsl.exe", ["--exec", "/bin/sh", "-c", probe], {
      env: windowsControlEnvironment(),
      timeout: 15000,
      maxBuffer: 64000,
      windowsHide: true,
      ...(signal ? { signal } : {}),
    });
    if (stdout.trim() !== "MYLO_SANDBOX_READY")
      throw new Error("The isolation probe did not complete.");
  } catch (error) {
    if (signal?.aborted) throw new Error("Sandbox setup check cancelled.");
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${SETUP}\n${detail}`);
  }
}

function assertRunId(id: string): void {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid sandbox run identity.");
}

export function windowsSandboxInvocation(
  root: string,
  executable: string,
  args: string[],
  runId: string,
): SandboxInvocation {
  assertRunId(runId);
  const launcher = `set -eu
root=$(/usr/bin/wslpath -a -u "$1") || { printf 'Cannot convert approved Windows workspace to a WSL path.\\n' >&2; exit 78; }
shift
[ -d "$root" ] || { printf 'Approved workspace is not accessible in the default WSL distribution.\\n' >&2; exit 78; }
root=$(/usr/bin/realpath -e -- "$root")
[ "$root" != / ] || { printf 'A filesystem root cannot be used as an agent workspace.\\n' >&2; exit 78; }
state=/tmp/mylo-sandbox-${runId}
umask 077
[ ! -e "$state.cancel" ] || { rm -f -- "$state.cancel"; exit 130; }
mkdir "$state"
trap 'rm -rf -- "$state"; rm -f -- "$state.cancel"' EXIT
# The token directory is outside the sandbox; project code cannot forge the PID.
/usr/bin/setsid /bin/sh -c '
  state=$1
  root=$2
  shift 2
  printf "%s\\n" "$$" > "$state/pid"
  [ ! -e "$state.cancel" ] || exit 130
  set -- --unshare-all --new-session --die-with-parent --clearenv --setenv PATH /usr/local/bin:/usr/bin:/bin --setenv HOME /workspace --setenv TMPDIR /tmp --setenv CI true --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib --proc /proc --dev /dev --tmpfs /tmp --bind "$root" /workspace --chdir /workspace "$@"
  if [ -d /lib64 ]; then set -- --ro-bind /lib64 /lib64 "$@"; fi
  exec /usr/bin/bwrap "$@"
' mylo-child "$state" "$root" -- "$@" &
pid=$!
wait "$pid"`;
  return {
    executable: "wsl.exe",
    args: ["--exec", "/bin/sh", "-c", launcher, "mylo-sandbox", root, executable, ...args],
  };
}

export async function cleanupWindowsSandbox(runId: string): Promise<void> {
  assertRunId(runId);
  const cleanup = `state=/tmp/mylo-sandbox-${runId}
umask 077
: > "$state.cancel"
[ -r "$state/pid" ] || exit 0
pid=$(cat "$state/pid" 2>/dev/null) || exit 0
case "$pid" in ''|*[!0-9]*) exit 78;; esac
[ "$pid" -gt 1 ] || exit 78
/bin/kill -KILL -- -"$pid" 2>/dev/null || true`;
  await execute("wsl.exe", ["--exec", "/bin/sh", "-c", cleanup], {
    env: windowsControlEnvironment(),
    timeout: 5000,
    maxBuffer: 64000,
    windowsHide: true,
  });
}
