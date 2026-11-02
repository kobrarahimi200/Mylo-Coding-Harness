import { expect, it } from "vitest";
import { toHexColor } from "./monaco";

it("expands shorthand hex colors to the form Monaco requires", () => {
  expect(toHexColor("#fff")).toBe("#ffffff");
  expect(toHexColor("#1234")).toBe("#11223344");
  expect(toHexColor("#a1b2c3")).toBe("#a1b2c3");
  expect(toHexColor("rgb(255, 0, 0)")).toBe("#ff0000");
});
