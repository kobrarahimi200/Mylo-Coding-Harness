/**
 * Workspace path containment — authoritative sandbox for file IPC handlers.
 */

import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

/** Resolve `target` against `root`, or throw if it escapes the workspace root. */
export function resolveWithin(root: string, target: string): string {
  const rootResolved = resolve(root);
  const abs = isAbsolute(target) ? resolve(target) : resolve(rootResolved, target);
  const rel = relative(rootResolved, abs);
  if (rel === "") {
    return abs;
  }
  if (rel.startsWith("..") || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("Refusing to access a path outside the workspace.");
  }
  return abs;
}

/** Also checks existing ancestors, including dangling links, for file IPC. */
export function resolveWorkspacePath(root: string, target: string): string {
  const abs = resolveWithin(root, target),
    canonicalRoot = realpathSync(root);
  let existing = abs;
  for (;;) {
    try {
      lstatSync(existing);
      break;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      const parent = dirname(existing);
      if (parent === existing) throw new Error("Unable to validate workspace path.");
      existing = parent;
    }
  }
  resolveWithin(canonicalRoot, realpathSync(existing));
  return abs;
}
