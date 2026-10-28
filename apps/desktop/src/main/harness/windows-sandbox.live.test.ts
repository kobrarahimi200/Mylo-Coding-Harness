import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sandboxOperations } from "./sandbox";
import { findValidationCommand, runValidation } from "./validation";

// Requires a real Windows host, default WSL 2 distro, working bubblewrap,
// and Linux node/npm. Ordinary tests exercise contracts and skip this suite.
const enabled = process.platform === "win32" && process.env.MYLO_WSL_TESTS === "1";
let root = "";
describe.runIf(enabled)("real Windows WSL isolation", () => {
  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });
  it("converts a Windows path containing spaces and quotes and runs real npm validation", async () => {
    root = mkdtempSync(join(tmpdir(), "Mylo WSL's fixture "));
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ scripts: { test: "node test.cjs" } }),
    );
    writeFileSync(
      join(root, "test.cjs"),
      "const assert=require('node:assert/strict');const fs=require('node:fs');assert.equal(process.cwd(),'/workspace');assert.equal(fs.existsSync('/mnt/c'),false);assert.equal(fs.existsSync('/home'),false);assert.equal(process.env.OPENAI_API_KEY,undefined);console.log('WSL_FIXTURE_PASSED');",
    );
    const command = await findValidationCommand(root);
    if (!command) throw new Error("Missing fixture validation");
    expect(await runValidation(command)).toMatchObject({
      passed: true,
      exitCode: 0,
      output: expect.stringContaining("WSL_FIXTURE_PASSED"),
    });
  }, 45000);
  it("stops Linux descendants on cancellation and does not resume writing afterwards", async () => {
    const controller = new AbortController();
    const exec = sandboxOperations(root).exec(
      "echo 0 > heartbeat; echo ready; i=0; while true; do i=$((i+1)); echo $i > heartbeat; sleep 0.05; done",
      root,
      {
        timeout: 10,
        signal: controller.signal,
        onData: (chunk) => {
          if (chunk.toString().includes("ready")) controller.abort();
        },
      },
    );
    await expect(exec).rejects.toThrow("cancelled");
    expect(existsSync(join(root, "heartbeat"))).toBe(true);
    const before = readFileSync(join(root, "heartbeat"), "utf8");
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(readFileSync(join(root, "heartbeat"), "utf8")).toBe(before);
  }, 20000);
});
