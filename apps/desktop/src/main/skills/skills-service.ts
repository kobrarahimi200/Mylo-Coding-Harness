import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { dialog, shell } from "electron";
import type { SkillState } from "../../shared/contracts";
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
    skills: loaded.skills.map((skill) => ({ ...toSkillInfo(skill), enabled: true })),
    disabledSkills: disabledSkills(resource?.cwd ?? "").map((skill) => ({
      ...toSkillInfo(skill),
      enabled: false,
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
