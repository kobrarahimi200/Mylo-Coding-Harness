import { expect, it } from "vitest";
import {
  createValidationRetryPrompt,
  MAX_VALIDATION_RETRIES,
  shouldRetryValidation,
} from "./retry-policy";

it("allows no more than three validation correction attempts", () => {
  expect(MAX_VALIDATION_RETRIES).toBe(3);
  expect(shouldRetryValidation(0, false)).toBe(true);
  expect(shouldRetryValidation(2, false)).toBe(true);
  expect(shouldRetryValidation(3, false)).toBe(false);
  expect(shouldRetryValidation(0, true)).toBe(false);
});

it("includes the failing output in a bounded correction request", () => {
  expect(createValidationRetryPrompt(1, "test failed")).toContain("test failed");
  expect(() => createValidationRetryPrompt(4, "failure")).toThrow("between 1 and 3");
  expect(() => createValidationRetryPrompt(1, " ")).toThrow("required");
});
