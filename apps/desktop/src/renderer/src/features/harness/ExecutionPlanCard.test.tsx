import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExecutionPlanCard, PlanParseError } from "./ExecutionPlanCard";
import type { PlanView } from "./plan-view";
import { splitStep } from "./plan-view";

const plan = { goal: "Create mylo-test.js", steps: ["Wait for approval", "Create the file"] };
const view: PlanView = {
  goal: plan.goal,
  plan,
  approved: false,
  steps: plan.steps.map((step) => ({ ...splitStep(step), status: "pending" as const })),
  targetFiles: ["mylo-test.js"],
  overallLabel: "Awaiting approval",
  overallTone: "pending",
};

describe("ExecutionPlanCard", () => {
  it("renders a structured card, not raw JSON", () => {
    const html = renderToStaticMarkup(<ExecutionPlanCard view={view} />);
    expect(html).toContain("EXECUTION PLAN");
    expect(html).toContain("Create mylo-test.js");
    expect(html).toContain("Awaiting approval");
    expect(html).toContain("mylo-test.js</code>");
    expect(html).toContain("Wait for approval");
    expect(html).not.toContain('{"goal"');
    expect(html).toContain("Copy as Markdown");
  });

  it("offers approval controls only when a real approval is pending", () => {
    expect(renderToStaticMarkup(<ExecutionPlanCard view={view} />)).not.toContain("Approve plan");
    const html = renderToStaticMarkup(
      <ExecutionPlanCard
        view={view}
        approval={{ busy: false, onApprove() {}, onReject() {}, onReplan() {} }}
      />,
    );
    for (const label of ["Approve plan", "Edit plan", "Reject", "Re-plan"])
      expect(html).toContain(label);
  });

  it("renders a clear parse error with collapsible technical details", () => {
    const html = renderToStaticMarkup(
      <PlanParseError error={{ message: "Unexpected token", raw: "{oops" }} />,
    );
    expect(html).toContain("could not be read");
    expect(html).toContain("<details");
    expect(html).toContain("Technical details");
    expect(html).toContain("{oops");
  });
});
