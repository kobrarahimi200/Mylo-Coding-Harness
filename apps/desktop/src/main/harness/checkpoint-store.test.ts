import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { CheckpointStore } from "./checkpoint-store";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "mylo-checkpoint-"));
  roots.push(root);
  const cwd = join(root, "project");
  mkdirSync(cwd);
  return { root, cwd, store: new CheckpointStore(join(root, "snapshots")) };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
it("restores the pre-agent dirty baseline and leaves unrelated user files untouched", () => {
  const { cwd, store } = fixture();
  writeFileSync(join(cwd, "code.ts"), "user baseline, uncommitted");
  writeFileSync(join(cwd, "notes.txt"), "unrelated draft");
  store.capture("session", "run", cwd, "code.ts", "agent output");
  writeFileSync(join(cwd, "code.ts"), "agent output");
  const preview = store.preview("session", cwd);
  expect(preview.files[0]?.status).toBe("ready");
  expect(store.restore("session", cwd, preview.token, true)).toEqual({
    restored: ["code.ts"],
    conflicts: [],
  });
  expect(readFileSync(join(cwd, "code.ts"), "utf8")).toBe("user baseline, uncommitted");
  expect(readFileSync(join(cwd, "notes.txt"), "utf8")).toBe("unrelated draft");
});
it("refuses the whole batch if any affected file was edited manually afterwards", () => {
  const { cwd, store } = fixture();
  for (const path of ["one.ts", "two.ts"]) {
    writeFileSync(join(cwd, path), "before");
    store.capture("s", "r", cwd, path, "agent");
    writeFileSync(join(cwd, path), "agent");
  }
  writeFileSync(join(cwd, "two.ts"), "manual edit");
  const preview = store.preview("s", cwd);
  expect(store.restore("s", cwd, preview.token, true)).toEqual({
    restored: [],
    conflicts: ["two.ts"],
  });
  expect(readFileSync(join(cwd, "one.ts"), "utf8")).toBe("agent");
  expect(readFileSync(join(cwd, "two.ts"), "utf8")).toBe("manual edit");
});
it("requires explicit confirmation and rejects stale previews", () => {
  const { cwd, store } = fixture();
  store.capture("s", "r", cwd, "new.ts", "agent");
  writeFileSync(join(cwd, "new.ts"), "agent");
  const p = store.preview("s", cwd);
  expect(() => store.restore("s", cwd, p.token, false)).toThrow("confirmation");
  writeFileSync(join(cwd, "new.ts"), "manual");
  expect(() => store.restore("s", cwd, p.token, true)).toThrow("fresh rollback preview");
});
it("removes only agent-created files and restores the first baseline across repeated edits after restart", () => {
  const { cwd, root, store } = fixture();
  writeFileSync(join(cwd, "old.ts"), "original");
  store.capture("s", "r", cwd, "old.ts", "v1");
  writeFileSync(join(cwd, "old.ts"), "v1");
  store.capture("s", "r", cwd, "old.ts", "v2");
  writeFileSync(join(cwd, "old.ts"), "v2");
  store.capture("s", "r", cwd, "new.ts", "new");
  writeFileSync(join(cwd, "new.ts"), "new");
  const resumed = new CheckpointStore(join(root, "snapshots"));
  const p = resumed.preview("s", cwd);
  expect(resumed.restore("s", cwd, p.token, true).restored).toHaveLength(2);
  expect(readFileSync(join(cwd, "old.ts"), "utf8")).toBe("original");
  expect(existsSync(join(cwd, "new.ts"))).toBe(false);
});
it("blocks escaped paths and symlink replacement rather than restoring outside the project", () => {
  const { cwd, root, store } = fixture();
  writeFileSync(join(root, "outside.ts"), "private");
  expect(() => store.capture("s", "r", cwd, "../outside.ts", "new")).toThrow(
    "outside the workspace",
  );
  const dir = join(cwd, "src");
  mkdirSync(dir);
  writeFileSync(join(dir, "file.ts"), "before");
  store.capture("s", "r", cwd, "src/file.ts", "after");
  writeFileSync(join(dir, "file.ts"), "after");
  rmSync(dir, { recursive: true });
  symlinkSync(root, dir, process.platform === "win32" ? "junction" : "dir");
  expect(store.preview("s", cwd).files[0]?.status).toBe("conflict");
  expect(readFileSync(join(root, "outside.ts"), "utf8")).toBe("private");
});
it("keeps rollback scoped to the most recent file-changing run", () => {
  const { cwd, store } = fixture();
  writeFileSync(join(cwd, "file.ts"), "start");
  store.capture("s", "r1", cwd, "file.ts", "first");
  writeFileSync(join(cwd, "file.ts"), "first");
  store.capture("s", "r2", cwd, "file.ts", "second");
  writeFileSync(join(cwd, "file.ts"), "second");
  const p = store.preview("s", cwd);
  expect(p.runId).toBe("r2");
  store.restore("s", cwd, p.token, true);
  expect(readFileSync(join(cwd, "file.ts"), "utf8")).toBe("first");
});
it("checkpoints filenames that match JavaScript object properties", () => {
  const { cwd, store } = fixture();
  for (const path of ["__proto__", "constructor"]) {
    writeFileSync(join(cwd, path), "user baseline");
    store.capture("s", "r", cwd, path, "agent output");
    writeFileSync(join(cwd, path), "agent output");
  }
  const preview = store.preview("s", cwd);
  expect(store.restore("s", cwd, preview.token, true).restored).toHaveLength(2);
  for (const path of ["__proto__", "constructor"])
    expect(readFileSync(join(cwd, path), "utf8")).toBe("user baseline");
});
