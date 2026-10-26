import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { sandboxInvocation } from "./sandbox";

const root = mkdtempSync(join(tmpdir(), "mylo-sandbox-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
it("builds an OS sandbox invocation with only the workspace writable", () => {
  const invocation = sandboxInvocation(root, "/bin/bash", ["-c", "echo test"], "darwin");
  expect(invocation.executable).toBe("/usr/bin/sandbox-exec");
  expect(invocation.args[1]).toContain("(deny default)");
  expect(invocation.args[1]).toContain("(allow file-read* file-write* (subpath");
  expect(invocation.args[1]).not.toContain("network*");
  expect(invocation.args.slice(-3)).toEqual(["/bin/bash", "-c", "echo test"]);
});
it("fails closed when there is no supported isolation backend", () => {
  expect(() => sandboxInvocation(root, "powershell", [], "freebsd")).toThrow(
    "execution is blocked",
  );
});

it("runs Windows commands through WSL and bubblewrap without exposing host mounts", () => {
  const invocation = sandboxInvocation(root, "/bin/bash", ["-c", "npm test"], "win32");
  expect(invocation.executable).toBe("wsl.exe");
  expect(invocation.args.join(" ")).toContain("--unshare-all");
  expect(invocation.args.join(" ")).toContain('--bind "$root" /workspace');
  expect(invocation.args).toContain(realpathSync(root));
});
