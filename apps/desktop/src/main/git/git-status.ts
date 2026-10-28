export function parseGitStatus(output: string): Array<{ path: string; status: string }> {
  const entries = output.split("\0"),
    changes: Array<{ path: string; status: string }> = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry || entry.length < 4) continue;
    changes.push({ path: entry.slice(3), status: entry.slice(0, 2).trim() });
    if (/[RC]/.test(entry.slice(0, 2))) i++;
  }
  return changes;
}
