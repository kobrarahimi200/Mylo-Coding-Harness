export const MAX_VALIDATION_RETRIES = 3;

export function shouldRetryValidation(retriesUsed: number, passed: boolean): boolean {
  return !passed && retriesUsed < MAX_VALIDATION_RETRIES;
}

export function createValidationRetryPrompt(attempt: number, output: string): string {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_VALIDATION_RETRIES)
    throw new Error(`Validation retry attempt must be between 1 and ${MAX_VALIDATION_RETRIES}.`);
  const details = output.trim();
  if (!details) throw new Error("Validation output is required to request a correction.");
  return [
    `Workspace validation failed (correction attempt ${attempt}/${MAX_VALIDATION_RETRIES}).`,
    "Use the existing Pi tools to fix the reported failures. Do not claim success without rerunning validation.",
    details,
  ].join("\n\n");
}
