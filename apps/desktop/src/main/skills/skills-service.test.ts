import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import {
  createSkill,
  deleteSkill,
  listSkills,
  readSkill,
  revealSkill,
  updateSkill,
} from "./skills-service";

const mocks = vi.hoisted(() => ({
  resources: [] as unknown[],
  open: vi.fn(async () => ""),
  agentDir: "",
  reload: vi.fn(async () => undefined),
}));
vi.mock("electron", () => ({ shell: { openPath: mocks.open } }));
vi.mock("../agent/agent-paths", () => ({ getPiCliAgentDir: () => mocks.agentDir }));
vi.mock("../agent/session-resources", () => ({ sessionResources: () => mocks.resources }));
vi.mock("../preferences/desktop-preferences", () => ({
  desktopPreferences: () => ({}),
  saveDesktopPreferences: vi.fn(),
}));
const root = mkdtempSync(join(tmpdir(), "modus-skill-view-"));
mocks.agentDir = join(root, "agent");
afterAll(() => rmSync(root, { recursive: true, force: true }));
afterEach(() => {
  mocks.resources = [];
  mocks.open.mockClear();
});
function resource(id: string, path: string) {
  return {
    id,
    cwd: root,
    loader: {
      getSkills: () => ({
        diagnostics: [],
        skills: [
          {
            name: id,
            description: "synthetic",
            filePath: path,
            sourceInfo: { scope: "user", source: "local" },
          },
        ],
      }),
    },
  };
}
it("uses the selected loader, not the first session in the workspace", () => {
  mocks.resources = [resource("other", "other-path"), resource("selected", "selected-path")];
  expect(listSkills("selected").skills.map((skill) => skill.path)).toEqual(["selected-path"]);
  expect(() => listSkills("closed")).toThrow("not loaded");
});
it("reveals existing discovered locations without changing their content", async () => {
  const path = join(root, "SKILL.md");
  writeFileSync(path, "synthetic contents");
  mocks.resources = [resource("selected", path)];
  await revealSkill("selected", path);
  expect(mocks.open).toHaveBeenCalledWith(root);
  expect(readFileSync(path, "utf8")).toBe("synthetic contents");
  await expect(revealSkill("selected", join(root, "absent"))).rejects.toThrow("not available");
});

function readSkillFiles(dir: string) {
  return readdirSync(dir)
    .filter((name) => existsSync(join(dir, name, "SKILL.md")))
    .map((name) => ({
      name,
      description: readFileSync(join(dir, name, "SKILL.md"), "utf8").match(
        /description: "(.*)"/,
      )?.[1],
      filePath: join(dir, name, "SKILL.md"),
      sourceInfo: { scope: "user", source: "local" },
    }));
}
function managedSession(id: string) {
  const skillsDir = join(mocks.agentDir, "skills");
  return {
    id,
    cwd: root,
    session: { isStreaming: false, reload: mocks.reload },
    loader: {
      getSkills: () => ({
        diagnostics: [],
        skills: existsSync(skillsDir) ? readSkillFiles(skillsDir) : [],
      }),
    },
  };
}
it("creates, edits, and deletes a managed skill in SKILL.md format", async () => {
  mocks.resources = [managedSession("s1")];
  const created = await createSkill("s1", {
    name: "code-review",
    description: "Review   code\nfor bugs",
    instructions: "# Steps\n1. Read the diff",
  });
  const path = join(mocks.agentDir, "skills", "code-review", "SKILL.md");
  expect(readFileSync(path, "utf8")).toBe(
    '---\nname: code-review\ndescription: "Review code for bugs"\n---\n\n# Steps\n1. Read the diff\n',
  );
  expect(created.skills[0]).toMatchObject({ name: "code-review", editable: true });
  expect(mocks.reload).toHaveBeenCalled();
  expect(readSkill("s1", path)).toEqual({
    name: "code-review",
    description: "Review code for bugs",
    instructions: "# Steps\n1. Read the diff",
  });
  await updateSkill("s1", path, { description: "Better", instructions: "New body" });
  expect(readFileSync(path, "utf8")).toContain('name: code-review\ndescription: "Better"');
  await deleteSkill("s1", path);
  expect(existsSync(dirname(path))).toBe(false);
});
it("rejects invalid names, duplicates, and non-managed paths", async () => {
  mocks.resources = [managedSession("s2")];
  const draft = { name: "ok-name", description: "d", instructions: "i" };
  await expect(createSkill("s2", { ...draft, name: "Bad Name" })).rejects.toThrow("lowercase");
  await expect(createSkill("s2", { ...draft, description: " " })).rejects.toThrow("description");
  await expect(createSkill("s2", { ...draft, instructions: "" })).rejects.toThrow("instructions");
  await createSkill("s2", draft);
  await expect(createSkill("s2", draft)).rejects.toThrow("already exists");
  const outside = join(root, "elsewhere", "SKILL.md");
  mkdirSync(dirname(outside), { recursive: true });
  writeFileSync(outside, "keep");
  await expect(deleteSkill("s2", outside)).rejects.toThrow("cannot be deleted");
  await expect(updateSkill("s2", outside, draft)).rejects.toThrow("cannot be edited");
  expect(readFileSync(outside, "utf8")).toBe("keep");
});
