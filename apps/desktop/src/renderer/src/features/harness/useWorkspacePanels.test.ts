import { describe, expect, it } from "vitest";
import { fitAgentWorkspaceWidth } from "./useWorkspacePanels";

describe("fitAgentWorkspaceWidth", () => {
  it("preserves the saved width when the viewport has room", () => {
    expect(fitAgentWorkspaceWidth(360, 900)).toBe(360);
  });

  it("caps the panel to the available viewport on narrow windows", () => {
    expect(fitAgentWorkspaceWidth(360, 320)).toBe(264);
    expect(fitAgentWorkspaceWidth(520, 400)).toBe(344);
  });
});
