import type { Skill } from "@earendil-works/pi-coding-agent";
import { desktopPreferences } from "../preferences/desktop-preferences";

const catalogs = new Map<string, Skill[]>();
export function filterEnabledSkills(cwd: string, skills: Skill[]): Skill[] {
  catalogs.set(cwd, skills);
  const disabled = new Set(desktopPreferences().disabledSkillPaths ?? []);
  return skills.filter((skill) => !disabled.has(skill.filePath));
}
export function disabledSkills(cwd: string): Skill[] {
  const catalog = catalogs.get(cwd);
  if (!catalog) return [];
  const disabled = new Set(desktopPreferences().disabledSkillPaths ?? []);
  return catalog.filter((skill) => disabled.has(skill.filePath));
}
