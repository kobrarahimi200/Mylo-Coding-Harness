import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { findValidationCommand, findValidationCommands, runValidation } from "./validation";

const root = mkdtempSync(join(tmpdir(), "modus-harness-validation-"));
afterEach(() => {
  for (const name of ["package.json", "pass.cjs", "fail.cjs", ".npm", ".config"]) {
    rmSync(join(root, name), { force: true, recursive: true });
  }
  vi.restoreAllMocks();
});

it("selects only an explicitly configured workspace test script", async () => {
  expect(await findValidationCommand(root)).toBeUndefined();
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
  expect(await findValidationCommand(root)).toMatchObject({
    executable: "npm",
    args: ["run", "test"],
    cwd: root,
  });
});

it("captures diagnostics and uses the isolated operations backend", async () => {
  const exec = vi.fn<import("@earendil-works/pi-coding-agent").BashOperations["exec"]>(
    async (_command, _cwd, options) => {
      options.onData(Buffer.from("assertion failed"));
      return { exitCode: 2 };
    },
  );
  await expect(
    runValidation(
      { executable: "npm", args: ["run", "test"], cwd: root, label: "tests" },
      { exec },
    ),
  ).resolves.toMatchObject({ passed: false, output: "assertion failed", exitCode: 2 });
  expect(exec).toHaveBeenCalledWith(
    "'npm' 'run' 'test'",
    root,
    expect.objectContaining({ timeout: 120 }),
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

it("discovers lint, typecheck, and non-watching tests", async () => {
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      scripts: { test: "vitest", lint: "biome check .", typecheck: "tsc --noEmit" },
    }),
  );
  expect((await findValidationCommands(root)).map((command) => command.args)).toEqual([
    ["run", "test", "--", "--run"],
    ["run", "lint"],
    ["run", "typecheck"],
  ]);
});

it("does not omit a separate check script when lint or typecheck is configured", async () => {
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ scripts: { lint: "eslint .", check: "node additional-invariants.cjs" } }),
  );
  expect((await findValidationCommands(root)).map((command) => command.label)).toEqual([
    "npm run lint",
    "npm run check",
  ]);
});
it("records command launch errors as failed validation, never success", async () => {
  const exec = vi.fn(async () => {
    throw new Error("spawn ENOENT");
  });
  await expect(
    runValidation({ executable: "missing", args: [], cwd: root, label: "missing" }, { exec }),
  ).resolves.toMatchObject({
    passed: false,
    exitCode: null,
    output: expect.stringContaining("ENOENT"),
  });
});

it.runIf(process.platform === "darwin")(
  "runs an actual npm test script through the sandbox",
  async () => {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ scripts: { test: "node pass.cjs" } }),
    );
    writeFileSync(join(root, "pass.cjs"), "console.log('npm fixture passed');\n");
    const command = await findValidationCommand(root);
    if (!command) throw new Error("The fixture test script was not discovered.");
    expect(await runValidation(command)).toMatchObject({
      passed: true,
      exitCode: 0,
      output: expect.stringContaining("npm fixture passed"),
    });
  },
);

it.runIf(process.platform === "darwin")(
  "keeps files outside the workspace unreadable after allowing parent metadata",
  async () => {
    const outside = mkdtempSync(join(tmpdir(), "mylo-validation-outside-"));
    try {
      const secret = join(outside, "private.txt");
      writeFileSync(secret, "outside workspace");
      const script = `require('node:assert/strict').throws(() => require('node:fs').readFileSync(${JSON.stringify(secret)}), {code: 'EPERM'}); console.log('outside read blocked');`;
      expect(
        await runValidation({
          executable: process.execPath,
          args: ["-e", script],
          cwd: root,
          label: "workspace confinement",
        }),
      ).toMatchObject({ passed: true, exitCode: 0, output: "outside read blocked" });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  },
);

it.runIf(process.platform === "darwin")(
  "captures actual sandboxed process exit codes and output",
  async () => {
    const command = {
      executable: process.execPath,
      args: ["-e", "console.error('fixture assertion failed'); process.exit(7)"],
      cwd: root,
      label: "actual failing fixture",
    };
    expect(await runValidation(command)).toMatchObject({
      passed: false,
      exitCode: 7,
      output: expect.stringContaining("fixture assertion failed"),
    });
    expect(
      await runValidation({ ...command, args: ["-e", "console.log('fixture passed')"] }),
    ).toMatchObject({ passed: true, exitCode: 0, output: "fixture passed" });
  },
);
