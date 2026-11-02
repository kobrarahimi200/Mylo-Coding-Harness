import { describe, expect, it } from "vitest";
import { currentRailSection, type NavigationState, navigateRail } from "./navigation";

const start: NavigationState = {
  settingsOpen: false,
  workspacePanel: "chat",
  bottomTab: "",
  sidebarOpen: true,
};

describe("rail navigation", () => {
  it.each([
    ["chats", "chat", "chats"],
    ["editor", "editor", "editor"],
    ["skills", "skills", "skills"],
    ["history", "timeline", "history"],
  ] as const)("opens %s and marks it current", (section, panel, current) => {
    const next = navigateRail({ ...start, workspacePanel: "skills" }, section);
    expect(next.workspacePanel).toBe(panel);
    expect(next.settingsOpen).toBe(false);
    expect(currentRailSection(next)).toBe(current);
  });

  it("opens settings and leaves it when another view is chosen", () => {
    const settings = navigateRail(start, "settings");
    expect(currentRailSection(settings)).toBe("settings");
    const back = navigateRail(settings, "editor");
    expect(back.settingsOpen).toBe(false);
    expect(currentRailSection(back)).toBe("editor");
  });

  it("toggles the tests panel and clears it when navigating to a view", () => {
    const open = navigateRail(start, "tests");
    expect(open.bottomTab).toBe("tests");
    expect(currentRailSection(open)).toBe("tests");
    expect(navigateRail(open, "tests").bottomTab).toBe("");
    const view = navigateRail(open, "skills");
    expect(view.bottomTab).toBe("");
    expect(currentRailSection(view)).toBe("skills");
  });

  it("keeps a non-test bottom tab when switching views", () => {
    expect(navigateRail({ ...start, bottomTab: "terminal" }, "editor").bottomTab).toBe("terminal");
  });

  it("reopens tests instead of closing them when coming from settings", () => {
    const next = navigateRail({ ...start, settingsOpen: true, bottomTab: "tests" }, "tests");
    expect(next.settingsOpen).toBe(false);
    expect(next.bottomTab).toBe("tests");
  });

  it("toggles the projects sidebar and always reveals it from settings", () => {
    expect(navigateRail(start, "projects").sidebarOpen).toBe(false);
    expect(navigateRail({ ...start, sidebarOpen: false }, "projects").sidebarOpen).toBe(true);
    const fromSettings = navigateRail({ ...start, settingsOpen: true }, "projects");
    expect(fromSettings).toMatchObject({ settingsOpen: false, sidebarOpen: true });
  });

  it("treats plan and diff views as part of chat", () => {
    expect(currentRailSection({ ...start, workspacePanel: "plan" })).toBe("chats");
    expect(currentRailSection({ ...start, workspacePanel: "diff" })).toBe("chats");
  });
});
