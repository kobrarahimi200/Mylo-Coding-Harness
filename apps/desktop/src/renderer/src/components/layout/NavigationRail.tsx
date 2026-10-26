import {
  IconCalculator,
  IconFiles,
  IconFolder,
  IconHistory,
  IconHome,
  IconPuzzle,
  IconSettings,
  IconTestPipe,
} from "@tabler/icons-react";
import modusLogo from "../../assets/modus-logo.png";
import { ToolbarButton } from "../ui/ToolbarButton";

export function NavigationRail({
  settingsOpen,
  calculatorOpen,
  onHome,
  onCalculator,
  onSettings,
  hasWorkspace,
  onNavigate,
}: {
  settingsOpen: boolean;
  calculatorOpen: boolean;
  hasWorkspace: boolean;
  onNavigate(section: string): void;
  onHome(): void;
  onCalculator(): void;
  onSettings(): void;
}) {
  return (
    <nav aria-label="Main navigation" className="navigation-rail">
      <img alt="Mylo" className="my-3 size-7 object-contain" src={modusLogo} />
      <ToolbarButton
        active={!settingsOpen && !calculatorOpen}
        className="rail-button"
        label="Chats"
        onClick={onHome}
      >
        <IconHome size={21} stroke={1.6} />
      </ToolbarButton>
      <ToolbarButton
        active={calculatorOpen}
        className="rail-button"
        label="Calculator"
        onClick={onCalculator}
      >
        <IconCalculator size={21} stroke={1.6} />
      </ToolbarButton>
      {(
        [
          ["projects", "Projects", IconFolder],
          ["editor", "File Explorer", IconFiles],
          ["skills", "Skills", IconPuzzle],
          ["tests", "Tests", IconTestPipe],
          ["history", "History", IconHistory],
        ] as const
      ).map(([section, label, Icon]) => (
        <ToolbarButton
          key={section}
          className="rail-button"
          label={label}
          disabled={section !== "projects" && !hasWorkspace}
          onClick={() => onNavigate(section)}
        >
          <Icon size={21} stroke={1.6} />
        </ToolbarButton>
      ))}
      <div className="flex-1" />
      <ToolbarButton
        active={settingsOpen}
        className="rail-button"
        label="Settings"
        onClick={onSettings}
      >
        <IconSettings size={21} stroke={1.6} />
      </ToolbarButton>
    </nav>
  );
}
