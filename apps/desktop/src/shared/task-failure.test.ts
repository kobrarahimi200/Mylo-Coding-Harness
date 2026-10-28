import { describe, expect, it } from "vitest";
import { classifyFailure, redactSecrets } from "./task-failure";

describe("classifyFailure", () => {
  it.each([
    ["401 Unauthorized: invalid api key", "authentication", true, false],
    ["Model gpt-x not found", "unsupported_model", true, false],
    ["connect ECONNREFUSED 127.0.0.1:1", "connection", true, true],
    ["No credits remaining", "quota", true, false],
    ["429 rate limit exceeded", "rate_limit", true, true],
    ["Request timed out", "timeout", true, true],
    ["something else broke", "execution", false, true],
  ] as const)("%s -> %s", (message, category, provider, retryable) => {
    const failure = classifyFailure(new Error(message));
    expect(failure.category).toBe(category);
    expect(failure.provider).toBe(provider);
    expect(failure.retryable).toBe(retryable);
    expect(failure.recovery).toBeTruthy();
  });

  it("never leaks credentials", () => {
    const failure = classifyFailure(new Error("401 bad key sk-abcdefghijklmnopqrstuvwxyz123456"));
    expect(failure.message).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(redactSecrets("Bearer abcdefghijklmnop12345")).not.toContain("abcdefghijklmnop12345");
  });
});
