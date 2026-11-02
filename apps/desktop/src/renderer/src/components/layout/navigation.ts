export type RailSection =
  | "chats"
  | "projects"
  | "editor"
  | "skills"
  | "tests"
  | "history"
  | "settings";

export type NavigationState = {
  settingsOpen: boolean;
  workspacePanel: string;
  bottomTab: string;
  sidebarOpen: boolean;
};

const PANEL_FOR_SECTION: Partial<Record<RailSection, string>> = {
  chats: "chat",
  editor: "editor",
  skills: "skills",
  history: "timeline",
};

/** The one rail item that describes where the user currently is. Projects is a sidebar toggle. */
export function currentRailSection(
  state: Pick<NavigationState, "settingsOpen" | "workspacePanel" | "bottomTab">,
): Exclude<RailSection, "projects"> {
  if (state.settingsOpen) return "settings";
  if (state.bottomTab === "tests") return "tests";
  switch (state.workspacePanel) {
    case "editor":
      return "editor";
    case "skills":
      return "skills";
    case "timeline":
      return "history";
    default:
      return "chats";
  }
}

export function navigateRail(state: NavigationState, section: RailSection): NavigationState {
  const leaveTests = state.bottomTab === "tests" ? "" : state.bottomTab;
  switch (section) {
    case "settings":
      return { ...state, settingsOpen: true };
    case "projects":
      return {
        ...state,
        settingsOpen: false,
        sidebarOpen: state.settingsOpen ? true : !state.sidebarOpen,
      };
    case "tests":
      return {
        ...state,
        settingsOpen: false,
        bottomTab: !state.settingsOpen && state.bottomTab === "tests" ? "" : "tests",
      };
    default:
      return {
        ...state,
        settingsOpen: false,
        workspacePanel: PANEL_FOR_SECTION[section] ?? "chat",
        bottomTab: leaveTests,
      };
  }
}
