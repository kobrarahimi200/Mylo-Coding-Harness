import { failureFromCategory, redactSecrets, type TaskFailure } from "../../shared/task-failure";

export type ModelCatalogView = {
  find(reference: string | undefined): { provider: string; id: string } | undefined;
  /** Returns undefined when the authentication state cannot be determined. */
  isProviderConfigured(provider: string): boolean | undefined;
};

/**
 * Checks that the chosen model is registered and its provider has credentials.
 * It never substitutes another model; it only explains what is wrong.
 */
export function diagnoseModelSelection(
  reference: string | undefined,
  catalog: ModelCatalogView,
): TaskFailure | undefined {
  if (!reference)
    return failureFromCategory(
      "unsupported_model",
      "No model is selected. Choose a model before starting a task.",
    );
  const model = catalog.find(reference);
  if (!model)
    return failureFromCategory(
      "unsupported_model",
      `Model ${reference} is not registered in the provider catalog.`,
    );
  if (catalog.isProviderConfigured(model.provider) === false)
    return failureFromCategory(
      "authentication",
      `Provider ${model.provider} has no working credentials for ${reference}.`,
    );
  return undefined;
}

export function logProviderFailure(scope: string, reference: string | undefined, error: unknown) {
  const failure = error as { message?: string; cause?: unknown };
  console.warn(
    `[provider-error] ${scope}`,
    redactSecrets(
      JSON.stringify({
        model: reference ?? null,
        message: failure?.message ? String(failure.message).slice(0, 2000) : String(error),
        cause:
          failure?.cause instanceof Error
            ? failure.cause.message
            : failure?.cause !== undefined
              ? String(failure.cause)
              : undefined,
      }),
    ),
  );
}
