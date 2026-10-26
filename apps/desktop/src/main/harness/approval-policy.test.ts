import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  assertToolPathsWithinWorkspace,
  assessToolCall,
  requiresExecutionIsolation,
} from "./approval-policy";

const root = mkdtempSync(join(tmpdir(), "modus-harness-approval-"));
const workspace = join(root, "workspace");
const external = join(root, "external");
mkdirSync(workspace);
mkdirSync(external);
writeFileSync(join(workspace, "file.txt"), "workspace");
writeFileSync(join(external, "outside.txt"), "outside");
symlinkSync(external, join(workspace, "escape"));
function tool(toolName: string, input: Record<string, unknown>) {
  return { toolName, input, type: "tool_call", toolCallId: "test" } as const;
}

it("keeps Pi file tools inside the canonical workspace, including symlinks", () => {
  expect(() =>
    assertToolPathsWithinWorkspace(workspace, tool("read", { path: "file.txt" })),
  ).not.toThrow();
  expect(() =>
    assertToolPathsWithinWorkspace(workspace, tool("read", { path: "../outside.txt" })),
  ).toThrow("outside the workspace");
  expect(() =>
    assertToolPathsWithinWorkspace(workspace, tool("read", { path: "escape/outside.txt" })),
  ).toThrow("outside the workspace");
});

it("requires explicit command and file mutation approval but allows scoped reads", () => {
  expect(assessToolCall(workspace, tool("read", { path: "file.txt" }))).toEqual({ allowed: true });
  expect(
    assessToolCall(workspace, tool("write", { path: "file.txt", content: "new" })),
  ).toMatchObject({
    allowed: false,
    approvalRequired: true,
  });
  expect(assessToolCall(workspace, tool("bash", { command: "npm test" }))).toMatchObject({
    allowed: false,
    approvalRequired: true,
  });
});

it("fails closed for commands that need an OS sandbox", () => {
  expect(requiresExecutionIsolation("npm test")).toBe(false);
  expect(requiresExecutionIsolation("sudo rm -rf /tmp/data")).toBe(true);
  expect(
    assessToolCall(workspace, tool("bash", { command: "sudo rm -rf /tmp/data" })),
  ).toMatchObject({
    allowed: false,
    reason: expect.stringContaining("no sandbox backend"),
  });
});

it("cleans up temporary workspace fixtures", () => {
  rmSync(root, { recursive: true, force: true });
});
