import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { dialog, shell } from "electron";
import type { SkillDraft, SkillState } from "../../shared/contracts";
import { getPiCliAgentDir } from "../agent/agent-paths";
import { getActiveAgentRun } from "../agent/agent-run-store";
import { sessionResources } from "../agent/session-resources";
import { desktopPreferences, saveDesktopPreferences } from "../preferences/desktop-preferences";
import { disabledSkills } from "./skill-preferences";
import { toSkillInfo } from "./skills";

export function listSkills(sessionId: string): SkillState {
  const resource = sessionResources().find(({ id }) => id === sessionId);
  const loaded = resource?.loader.getSkills();
  if (!loaded) throw new Error("Session resources are not loaded.");
  return {
    skills: loaded.skills.map((skill) => ({
      ...toSkillInfo(skill),
      enabled: true,
      editable: isManagedSkill(skill.filePath),
    })),
    disabledSkills: disabledSkills(resource?.cwd ?? "").map((skill) => ({
      ...toSkillInfo(skill),
      enabled: false,
      editable: isManagedSkill(skill.filePath),
    })),
    diagnostics: loaded.diagnostics.map(({ type, message, path }) => ({
      type,
      message,
      ...(path ? { path } : {}),
    })),
  };
}

export async function revealSkill(sessionId: string, path: string): Promise<void> {
  const state = listSkills(sessionId);
  if (
    (!state.skills.some((skill) => skill.path === path) &&
      !state.diagnostics.some((diagnostic) => diagnostic.path === path)) ||
    !existsSync(path)
  )
    throw new Error("Skill is not available in this session.");
  const error = await shell.openPath(dirname(path));
  if (error) throw new Error(error);
}

// Pi owns skill discovery and parsing; managing paths does not copy or execute skill code.
export async function addSkillFolder(sessionId: string): Promise<SkillState> {
  const resource = sessionResources().find(({ id }) => id === sessionId);
  if (!resource) throw new Error("Session resources are not loaded.");
  const choice = await dialog.showOpenDialog({
    title: "Add a trusted Pi skill folder",
    properties: ["openDirectory"],
  });
  if (choice.canceled || !choice.filePaths[0]) return listSkills(sessionId);
  if (resource.session.isStreaming || getActiveAgentRun(sessionId))
    throw new Error("Stop the task before changing skill folders.");
  const settings = resource.session.settingsManager;
  settings.setSkillPaths([...new Set([...settings.getSkillPaths(), choice.filePaths[0]])]);
  await resource.session.reload();
  return listSkills(sessionId);
}

export async function removeSkillFolder(sessionId: string, path: string): Promise<SkillState> {
  const resource = sessionResources().find(({ id }) => id === sessionId);
  if (!resource) throw new Error("Session resources are not loaded.");
  if (resource.session.isStreaming || getActiveAgentRun(sessionId))
    throw new Error("Stop the task before changing skill folders.");
  const settings = resource.session.settingsManager;
  if (!settings.getSkillPaths().includes(path))
    throw new Error("Only explicitly added skill folders can be removed here.");
  settings.setSkillPaths(settings.getSkillPaths().filter((entry) => entry !== path));
  await resource.session.reload();
  return listSkills(sessionId);
}

export function skillFolders(sessionId: string): string[] {
  return (
    sessionResources()
      .find(({ id }) => id === sessionId)
      ?.session.settingsManager.getSkillPaths() ?? []
  );
}

export async function setSkillEnabled(
  sessionId: string,
  path: string,
  enabled: boolean,
): Promise<SkillState> {
  const resource = sessionResources().find(({ id }) => id === sessionId);
  if (!resource || resource.session.isStreaming || getActiveAgentRun(sessionId))
    throw new Error("Stop the agent before changing skills.");
  const state = listSkills(sessionId);
  if (![...state.skills, ...(state.disabledSkills ?? [])].some((skill) => skill.path === path))
    throw new Error("Unknown skill.");
  const preferences = desktopPreferences();
  const disabled = new Set(preferences.disabledSkillPaths ?? []);
  if (enabled) disabled.delete(path);
  else disabled.add(path);
  preferences.disabledSkillPaths = [...disabled];
  saveDesktopPreferences();
  for (const loaded of sessionResources()) {
    if (!loaded.session.isStreaming && !getActiveAgentRun(loaded.id)) await loaded.session.reload();
  }
  return listSkills(sessionId);
}

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function managedSkillsRoot(): string {
  return resolve(getPiCliAgentDir(), "skills");
}

function managedSkillFile(name: string): string {
  return join(managedSkillsRoot(), name, "SKILL.md");
}

// Only skills Modus writes into Pi's user skills folder can be edited or deleted.
function isManagedSkill(path: string): boolean {
  const resolved = resolve(path);
  return (
    basename(resolved) === "SKILL.md" &&
    SKILL_NAME.test(basename(dirname(resolved))) &&
    resolved === managedSkillFile(basename(dirname(resolved)))
  );
}

function validateSkillDraft(draft: SkillDraft): SkillDraft {
  const name = draft.name.trim();
  const description = draft.description.replace(/\s+/g, " ").trim();
  const instructions = draft.instructions.trim();
  if (name.length > 64 || !SKILL_NAME.test(name))
    throw new Error(
      "Skill name must use lowercase letters, numbers, and single hyphens (max 64 characters).",
    );
  if (!description) throw new Error("Add a short description so the agent knows when to use it.");
  if (description.length > 1024) throw new Error("Description must be 1024 characters or fewer.");
  if (!instructions) throw new Error("Add the instructions the agent should follow.");
  return { name, description, instructions };
}

// Agent Skills format: YAML frontmatter (name, description) followed by Markdown instructions.
export function formatSkillFile(draft: SkillDraft): string {
  return `---\nname: ${draft.name}\ndescription: ${JSON.stringify(draft.description)}\n---\n\n${draft.instructions}\n`;
}

function skillBody(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

function assertSkillsEditable(sessionId: string): void {
  const resource = sessionResources().find(({ id }) => id === sessionId);
  if (!resource) throw new Error("Session resources are not loaded.");
  if (resource.session.isStreaming || getActiveAgentRun(sessionId))
    throw new Error("Stop the agent before changing skills.");
}

async function reloadIdleSessions(): Promise<void> {
  for (const loaded of sessionResources()) {
    if (!loaded.session.isStreaming && !getActiveAgentRun(loaded.id)) await loaded.session.reload();
  }
}

export function readSkill(sessionId: string, path: string): SkillDraft {
  const state = listSkills(sessionId);
  const skill = [...state.skills, ...(state.disabledSkills ?? [])].find(
    (entry) => entry.path === path,
  );
  if (!skill || !isManagedSkill(path)) throw new Error("This skill cannot be edited here.");
  return {
    name: skill.name,
    description: skill.description,
    instructions: skillBody(readFileSync(path, "utf8")),
  };
}

export async function createSkill(sessionId: string, input: SkillDraft): Promise<SkillState> {
  assertSkillsEditable(sessionId);
  const draft = validateSkillDraft(input);
  const file = managedSkillFile(draft.name);
  if (existsSync(file)) throw new Error(`A skill named "${draft.name}" already exists.`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, formatSkillFile(draft), { flag: "wx" });
  await reloadIdleSessions();
  return listSkills(sessionId);
}

export async function updateSkill(
  sessionId: string,
  path: string,
  input: Pick<SkillDraft, "description" | "instructions">,
): Promise<SkillState> {
  assertSkillsEditable(sessionId);
  if (!isManagedSkill(path) || !existsSync(path))
    throw new Error("This skill cannot be edited here.");
  const draft = validateSkillDraft({ ...input, name: basename(dirname(resolve(path))) });
  writeFileSync(path, formatSkillFile(draft));
  await reloadIdleSessions();
  return listSkills(sessionId);
}

export async function deleteSkill(sessionId: string, path: string): Promise<SkillState> {
  assertSkillsEditable(sessionId);
  if (!isManagedSkill(path)) throw new Error("This skill cannot be deleted here.");
  rmSync(dirname(resolve(path)), { recursive: true, force: true });
  const preferences = desktopPreferences();
  if (preferences.disabledSkillPaths?.includes(path)) {
    preferences.disabledSkillPaths = preferences.disabledSkillPaths.filter(
      (entry) => entry !== path,
    );
    saveDesktopPreferences();
  }
  await reloadIdleSessions();
  return listSkills(sessionId);
}
