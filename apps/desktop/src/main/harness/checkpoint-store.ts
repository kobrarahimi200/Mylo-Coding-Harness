import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import type { CheckpointPreview, RollbackResult } from "../../shared/checkpoint";
import { resolveWithin } from "../files/path-within";

type Snapshot = { before: string | null; after: string; mode: number };
type Checkpoint = { root: string; runId: string; files: Record<string, Snapshot> };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const LIMIT = 4 * 1024 * 1024;

// Snapshots cover explicit Pi write/edit proposals only. Arbitrary shell changes
// are deliberately not attributed to the agent or rolled back over user edits.
export class CheckpointStore {
  constructor(private readonly directory: string) {}
  private file(sessionId: string) {
    return join(this.directory, `${digest(sessionId)}.json`);
  }
  private load(sessionId: string): Checkpoint | undefined {
    const file = this.file(sessionId);
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Checkpoint) : undefined;
  }
  private save(sessionId: string, checkpoint: Checkpoint) {
    const json = JSON.stringify(checkpoint);
    if (Buffer.byteLength(json) > 32 * 1024 * 1024)
      throw new Error("The checkpoint exceeds the 32 MiB safety limit.");
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const file = this.file(sessionId),
      temporary = `${file}.tmp`;
    writeFileSync(temporary, json, { mode: 0o600 });
    renameSync(temporary, file);
  }
  private target(root: string, path: string): string {
    if (realpathSync(root) !== root) throw new Error("The checkpoint workspace has moved.");
    const target = resolveWithin(root, path);
    let parent = dirname(target);
    while (!existsSync(parent)) parent = dirname(parent);
    resolveWithin(root, realpathSync(parent));
    try {
      const info = lstatSync(target);
      if (info.isSymbolicLink() || !info.isFile())
        throw new Error("Rollback requires a regular file, not a symlink or directory.");
      resolveWithin(root, realpathSync(target));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    return target;
  }
  private read(path: string): Buffer | null {
    if (!existsSync(path)) return null;
    if (lstatSync(path).size > LIMIT) throw new Error("Checkpoint files must be at most 4 MiB.");
    return readFileSync(path);
  }
  capture(sessionId: string, runId: string, cwd: string, path: string, after: string): void {
    if (Buffer.byteLength(after) > LIMIT)
      throw new Error("The proposed file is too large to checkpoint safely.");
    const root = realpathSync(cwd),
      target = this.target(root, path);
    const key = relative(root, target).split("\\").join("/");
    const previous = this.load(sessionId);
    const checkpoint = previous?.runId === runId ? previous : { root, runId, files: {} };
    if (checkpoint.root !== root) throw new Error("Checkpoint workspace mismatch.");
    const before = this.read(target);
    const existing = Object.hasOwn(checkpoint.files, key) ? checkpoint.files[key] : undefined;
    const snapshot = {
      before: existing ? existing.before : (before?.toString("base64") ?? null),
      after: Buffer.from(after).toString("base64"),
      mode: existing?.mode ?? (before ? lstatSync(target).mode & 0o777 : 0o644),
    };
    checkpoint.files = { ...checkpoint.files, [key]: snapshot };
    this.save(sessionId, checkpoint);
  }
  preview(sessionId: string, cwd: string): CheckpointPreview {
    const checkpoint = this.load(sessionId);
    if (!checkpoint) return { token: digest("empty"), runId: null, files: [] };
    if (realpathSync(cwd) !== checkpoint.root) throw new Error("Checkpoint workspace mismatch.");
    const states: string[] = [];
    const files = Object.entries(checkpoint.files).map(([path, snapshot]) => {
      let current: string | null = null,
        reason: string | undefined;
      try {
        current = this.read(this.target(checkpoint.root, path))?.toString("base64") ?? null;
      } catch (error) {
        reason = String(error);
      }
      const status = reason
        ? "conflict"
        : current === snapshot.before
          ? "unchanged"
          : current === snapshot.after
            ? "ready"
            : "conflict";
      if (status === "conflict" && !reason)
        reason =
          "This file changed after the agent proposal. Your current content will be preserved.";
      states.push(`${path}:${current}:${reason ?? ""}`);
      return {
        path,
        before: Buffer.from(snapshot.before ?? "", "base64").toString("utf8"),
        after: Buffer.from(snapshot.after, "base64").toString("utf8"),
        status,
        ...(reason ? { reason } : {}),
        created: snapshot.before === null,
      } as const;
    });
    return {
      token: digest(JSON.stringify(checkpoint) + JSON.stringify(states)),
      runId: checkpoint.runId,
      files,
    };
  }
  restore(sessionId: string, cwd: string, token: string, confirmed: boolean): RollbackResult {
    if (!confirmed) throw new Error("Explicit rollback confirmation is required.");
    const preview = this.preview(sessionId, cwd);
    if (preview.token !== token)
      throw new Error("Files or checkpoint changed. Review a fresh rollback preview.");
    const conflicts = preview.files
      .filter((file) => file.status === "conflict")
      .map((file) => file.path);
    if (conflicts.length) return { restored: [], conflicts };
    const checkpoint = this.load(sessionId);
    if (!checkpoint) return { restored: [], conflicts: [] };
    const restored: string[] = [];
    // No await between verification and writes: other app IPC writes cannot
    // interleave. External host processes remain subject to conflict checks.
    for (const file of preview.files.filter((file) => file.status === "ready")) {
      const snapshot = checkpoint.files[file.path];
      if (!snapshot) continue;
      try {
        const target = this.target(checkpoint.root, file.path);
        if (this.read(target)?.toString("base64") !== snapshot.after)
          throw new Error("Concurrent modification detected.");
        if (snapshot.before === null) unlinkSync(target);
        else {
          const temporary = join(dirname(target), `.mylo-restore-${randomUUID()}.tmp`);
          try {
            // Finish writing before replacing the current file. A failed write
            // must never leave the user's file truncated.
            writeFileSync(temporary, Buffer.from(snapshot.before, "base64"), {
              flag: "wx",
              mode: snapshot.mode,
            });
            if (
              this.read(this.target(checkpoint.root, file.path))?.toString("base64") !==
              snapshot.after
            )
              throw new Error("Concurrent modification detected.");
            renameSync(temporary, target);
          } finally {
            if (existsSync(temporary)) unlinkSync(temporary);
          }
        }
        restored.push(file.path);
        delete checkpoint.files[file.path];
      } catch {
        conflicts.push(file.path);
        break;
      }
    }
    this.save(sessionId, checkpoint);
    return { restored, conflicts };
  }
}
