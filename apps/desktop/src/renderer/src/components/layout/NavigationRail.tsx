import {
  IconFiles,
  IconFolder,
  IconHistory,
  IconHome,
  IconPuzzle,
  IconSettings,
  IconTestPipe,
} from "@tabler/icons-react";
import type { ComponentType } from "react";
import modusLogo from "../../assets/modus-logo.png";
import { ToolbarButton } from "../ui/ToolbarButton";
import type { RailSection } from "./navigation";

const ITEMS: ReadonlyArray<{
  section: Exclude<RailSection, "settings">;
  label: string;
  Icon: ComponentType<{ size?: number; stroke?: number }>;
  needsWorkspace: boolean;
}> = [
  { section: "chats", label: "Chats", Icon: IconHome, needsWorkspace: false },
  { section: "projects", label: "Projects", Icon: IconFolder, needsWorkspace: false },
  { section: "editor", label: "File Explorer", Icon: IconFiles, needsWorkspace: true },
  { section: "skills", label: "Skills", Icon: IconPuzzle, needsWorkspace: true },
  { section: "tests", label: "Tests", Icon: IconTestPipe, needsWorkspace: true },
  { section: "history", label: "History", Icon: IconHistory, needsWorkspace: true },
];

export function NavigationRail({
  current,
  sidebarOpen,
  hasWorkspace,
  onNavigate,
}: {
  current: Exclude<RailSection, "projects">;
  sidebarOpen: boolean;
  hasWorkspace: boolean;
  onNavigate(section: RailSection): void;
}) {
  return (
    <nav aria-label="Main navigation" className="navigation-rail">
      <img alt="Mylo" className="my-3 size-7 object-contain" src={modusLogo} />
      {ITEMS.map(({ section, label, Icon, needsWorkspace }) => (
        <ToolbarButton
          key={section}
          active={section === "projects" && sidebarOpen}
          current={section === current}
          className="rail-button"
          disabled={needsWorkspace && !hasWorkspace}
          label={label}
          onClick={() => onNavigate(section)}
        >
          <Icon size={21} stroke={1.6} />
        </ToolbarButton>
      ))}
      <div className="flex-1" />
      <ToolbarButton
        current={current === "settings"}
        className="rail-button"
        label="Settings"
        onClick={() => onNavigate("settings")}
      >
        <IconSettings size={21} stroke={1.6} />
      </ToolbarButton>
    </nav>
  );
}
