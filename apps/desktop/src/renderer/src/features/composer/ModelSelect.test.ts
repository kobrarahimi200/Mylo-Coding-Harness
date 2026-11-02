import { expect, it } from "vitest";
import type { ModelInfo } from "../../../../shared/contracts";
import { filterModels } from "./ModelSelect";

const base = { provider: "p", name: "n", contextWindow: 1, maxTokens: 1 } as unknown as ModelInfo;
const models: ModelInfo[] = [
  { ...base, id: "p/a", available: true, fast: true },
  { ...base, id: "p/b", available: true, fast: false },
  { ...base, id: "p/c", available: true },
  { ...base, id: "p/d", available: false, fast: true, unavailableReason: "No credentials" },
];

it("filters models by availability and measured speed only", () => {
  expect(filterModels(models, "all")).toHaveLength(4);
  expect(filterModels(models, "available").map((m) => m.id)).toEqual(["p/a", "p/b", "p/c"]);
  expect(filterModels(models, "fast").map((m) => m.id)).toEqual(["p/a"]);
});
