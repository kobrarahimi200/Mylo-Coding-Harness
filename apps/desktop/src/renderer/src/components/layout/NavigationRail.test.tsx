import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NavigationRail } from "./NavigationRail";

function render(props: Partial<Parameters<typeof NavigationRail>[0]> = {}) {
  return renderToStaticMarkup(
    <NavigationRail
      current="chats"
      sidebarOpen={false}
      hasWorkspace
      onNavigate={() => undefined}
      {...props}
    />,
  );
}

describe("NavigationRail", () => {
  it("renders every destination", () => {
    const html = render();
    for (const label of [
      "Chats",
      "Projects",
      "File Explorer",
      "Skills",
      "Tests",
      "History",
      "Settings",
    ])
      expect(html).toContain(`aria-label="${label}"`);
  });

  it("marks exactly one destination as the current page", () => {
    const html = render({ current: "skills" });
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(
      /aria-current="page"[^>]*aria-label="Skills"|aria-label="Skills"[^>]*aria-current="page"/,
    );
  });

  it("disables workspace-only views without a project but keeps Projects and Settings", () => {
    const html = render({ hasWorkspace: false });
    const disabled = html.match(/<button[^>]*disabled=""[^>]*>/g) ?? [];
    expect(disabled).toHaveLength(4);
    expect(disabled.join("")).not.toMatch(/aria-label="(Chats|Projects|Settings)"/);
  });
});
