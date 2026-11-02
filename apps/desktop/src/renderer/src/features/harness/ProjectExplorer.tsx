import { IconChevronRight, IconFile, IconFolder, IconSearch } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type { FileEntry, SkillInfo } from "../../../../shared/contracts";
import { createCoalescedRunner, directoriesToRefresh } from "./refresh-scheduler";

const REFRESH_DELAY_MS = 750;

export function ProjectExplorer({
  cwd,
  sessionId,
  onFile,
  onSkills,
}: {
  cwd: string | undefined;
  sessionId: string | undefined;
  onFile(path: string): void;
  onSkills(): void;
}) {
  const [entries, setEntries] = useState<FileEntry[]>([]),
    [children, setChildren] = useState<Record<string, FileEntry[]>>({}),
    [expanded, setExpanded] = useState<string[]>([]),
    [query, setQuery] = useState("");
  const [found, setFound] = useState<FileEntry[]>([]),
    [searching, setSearching] = useState(false),
    [error, setError] = useState<string>(),
    [changes, setChanges] = useState<Record<string, string>>({}),
    [skills, setSkills] = useState<SkillInfo[]>([]);
  const childrenRef = useRef(children);
  childrenRef.current = children;
  useEffect(() => {
    setChildren({});
    setExpanded([]);
    setQuery("");
    setError(undefined);
    if (!cwd) {
      setEntries([]);
      return;
    }
    let active = true;
    const fail = (e: unknown) => {
      if (active) setError(String(e));
    };
    const listRoot = () =>
      window.modus.files
        .list({ cwd })
        .then((next) => {
          if (active) setEntries(next);
        })
        .catch(fail);
    const listDir = (dir: string) =>
      window.modus.files
        .list({ cwd, dir })
        .then((next) => {
          if (active) setChildren((current) => ({ ...current, [dir]: next }));
        })
        .catch(fail);
    const loadChanges = () =>
      window.modus.git.changes
        ? window.modus.git
            .changes(cwd)
            .then((next) => {
              if (active) setChanges(Object.fromEntries(next.map((c) => [c.path, c.status])));
            })
            .catch(fail)
        : Promise.resolve();
    void listRoot();
    void loadChanges();
    // Filesystem bursts are merged: one refresh per window, touching only changed listings.
    let pendingPaths: string[] = [];
    let fullRefresh = false;
    const runner = createCoalescedRunner(async () => {
      const paths = pendingPaths;
      const everything = fullRefresh || paths.length === 0;
      pendingPaths = [];
      fullRefresh = false;
      const { root, dirs } = directoriesToRefresh(
        everything ? [] : paths,
        cwd,
        Object.keys(childrenRef.current),
      );
      await Promise.all([root ? listRoot() : undefined, ...dirs.map(listDir), loadChanges()]);
    }, REFRESH_DELAY_MS);
    const stop = window.modus.files.onChanged((e) => {
      if (e.cwd.replaceAll("\\", "/") !== cwd.replaceAll("\\", "/")) return;
      if (e.paths.length === 0) fullRefresh = true;
      else pendingPaths.push(...e.paths);
      runner.request();
    });
    return () => {
      active = false;
      runner.cancel();
      stop();
    };
  }, [cwd]);
  useEffect(() => {
    let active = true;
    setSkills([]);
    const load = () => {
      if (!sessionId) return;
      void window.modus.skills
        .list(sessionId)
        .then((next) => {
          if (active) setSkills(next.skills);
        })
        .catch((e: unknown) => {
          if (active) setError(String(e));
        });
    };
    load();
    const stop = window.modus.skills.onChanged((path) => {
      if (path === cwd) load();
    });
    return () => {
      active = false;
      stop();
    };
  }, [cwd, sessionId]);
  useEffect(() => {
    let active = true;
    const needle = query.trim().toLowerCase();
    setFound([]);
    if (!needle || !cwd) {
      setFound([]);
      setSearching(false);
      return;
    }
    const timer = setTimeout(() => {
      setSearching(true);
      void (async () => {
        const queue = ["."],
          results: FileEntry[] = [];
        let visited = 0;
        while (queue.length && visited++ < 150 && results.length < 200) {
          const dir = queue.shift();
          if (!dir) break;
          const files = await window.modus.files.list({ cwd, dir });
          if (!active) return;
          for (const file of files) {
            if (file.kind === "directory") {
              if (!["node_modules", ".git", "dist", "target"].includes(file.name))
                queue.push(file.path);
            } else if (file.relativePath.toLowerCase().includes(needle)) results.push(file);
          }
        }
        if (active) setFound(results);
      })()
        .catch((e: unknown) => {
          if (active) setError(String(e));
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [cwd, query]);
  function render(files: FileEntry[], depth = 0): React.ReactNode {
    return files.map((file) => (
      <div key={file.path}>
        <button
          className="mylo-tree-row"
          type="button"
          style={{ paddingLeft: 8 + depth * 14 }}
          title={file.relativePath}
          onClick={() => {
            if (file.kind !== "directory") {
              onFile(file.path);
              return;
            }
            if (expanded.includes(file.path)) {
              setExpanded((e) => e.filter((p) => p !== file.path));
              return;
            }
            setExpanded((e) => [...e, file.path]);
            if (cwd)
              void window.modus.files
                .list({ cwd, dir: file.path })
                .then((next) => setChildren((c) => ({ ...c, [file.path]: next })))
                .catch((e: unknown) => setError(String(e)));
          }}
        >
          {file.kind === "directory" ? (
            <>
              <IconChevronRight
                size={12}
                style={{ transform: expanded.includes(file.path) ? "rotate(90deg)" : undefined }}
              />
              <IconFolder size={14} />
            </>
          ) : (
            <IconFile size={14} />
          )}
          <span>{query ? file.relativePath : file.name}</span>
          {changes[file.relativePath] ? (
            <small className="mylo-git-change">{changes[file.relativePath]}</small>
          ) : null}
        </button>
        {expanded.includes(file.path) && !query
          ? render(children[file.path] ?? [], depth + 1)
          : null}
      </div>
    ));
  }
  return (
    <section className="mylo-project-explorer" aria-label="Project Explorer">
      <h3>PROJECT FILES</h3>
      <label className="mylo-file-search">
        <IconSearch size={14} />
        <input
          type="search"
          aria-label="Search project files"
          placeholder="Find a file…"
          value={query}
          disabled={!cwd}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {error ? (
        <p role="alert" className="mylo-inline-error">
          {error}
        </p>
      ) : null}
      {searching ? <p className="mylo-empty-copy">Searching project…</p> : null}
      {!cwd ? (
        <p className="mylo-empty-copy">Open a project to explore its files.</p>
      ) : (
        <div className="mylo-tree">{render(query ? found : entries)}</div>
      )}
      {query ? (
        <p className="mylo-empty-copy">
          {found.length} matches · bounded to 150 folders / 200 results
        </p>
      ) : null}
      <button type="button" className="mylo-text-button" disabled={!sessionId} onClick={onSkills}>
        Active skills <span className="mylo-count">{skills.length}</span>
      </button>
      {skills.slice(0, 4).map((skill) => (
        <button
          className="mylo-skill-chip"
          type="button"
          key={skill.path}
          onClick={onSkills}
          title={skill.description}
        >
          {skill.name}
        </button>
      ))}
    </section>
  );
}
