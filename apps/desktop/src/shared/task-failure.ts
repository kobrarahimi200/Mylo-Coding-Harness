export type FailureCategory =
  | "authentication"
  | "unsupported_model"
  | "connection"
  | "quota"
  | "rate_limit"
  | "timeout"
  | "planning"
  | "validation"
  | "execution";

export type TaskFailure = {
  category: FailureCategory;
  /** Redacted underlying message, never truncated to a generic summary. */
  message: string;
  /** True only when re-running the same request can reasonably succeed without user changes. */
  retryable: boolean;
  /** True when the cause lies with the model provider, its credentials or its catalog. */
  provider: boolean;
  recovery: string;
};

export const FAILURE_LABELS: Record<FailureCategory, string> = {
  authentication: "Authentication failed",
  unsupported_model: "Model unavailable",
  connection: "Connection problem",
  quota: "Quota or billing limit",
  rate_limit: "Rate limited",
  timeout: "Request timed out",
  planning: "Planning failed",
  validation: "Validation failed",
  execution: "Task failed",
};

const RECOVERY: Record<FailureCategory, string> = {
  authentication:
    "Reconnect the provider or update its credentials in provider settings, then test the connection.",
  unsupported_model:
    "Choose a model that is available for this provider, or check the provider's model list. Mylo does not switch models for you.",
  connection: "Check your network connection or the provider's base URL, then retry.",
  quota: "Check the provider's plan, billing or credits, or choose another model.",
  rate_limit: "Wait a moment and retry, or choose another model.",
  timeout: "Retry the task. If it keeps timing out, test the connection or choose another model.",
  planning:
    "Retry, or rephrase the request. The model did not return a usable plan; no files were changed.",
  validation:
    "File changes were kept. Review the Tests panel and diff, then fix the failures or start a new task.",
  execution: "Review the details below, then retry or adjust the request.",
};

const PROVIDER_CATEGORIES = new Set<FailureCategory>([
  "authentication",
  "unsupported_model",
  "connection",
  "quota",
  "rate_limit",
  "timeout",
]);
const RETRYABLE = new Set<FailureCategory>([
  "connection",
  "rate_limit",
  "timeout",
  "planning",
  "execution",
]);

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, "[redacted]"],
  [/\b(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{10,}/g, "[redacted]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]"],
  [
    /(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|authorization)["']?\s*[:=]\s*)["']?[^\s"',;}]{4,}/gi,
    "$1[redacted]",
  ],
  [/([?&](?:key|api_key|access_token|token)=)[^&\s]+/gi, "$1[redacted]"],
];

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((value, [pattern, replacement]) => {
    return value.replace(pattern, replacement);
  }, text);
}

const RULES: Array<[FailureCategory, RegExp]> = [
  ["validation", /workspace validation|validation failed after/i],
  [
    "quota",
    /quota|insufficient[_ ]?(funds|credits|balance)|no credits|out of credits|billing|credit balance|payment required|\b402\b|usage limit|exceeded your current/i,
  ],
  ["rate_limit", /rate[ _-]?limit|\b429\b|too many requests|overloaded|\b529\b/i],
  [
    "authentication",
    /\b401\b|unauthori[sz]ed|invalid[_ ]?(api[_ ]?key|credentials?|token|x-api-key)|incorrect api key|authentication|not authenticated|no api key|api key (is )?(missing|required|not)|no credentials|not logged in|login required|token (has )?expired|expired token/i,
  ],
  [
    "unsupported_model",
    /(model[^.\n]{0,80}(not found|does not exist|unavailable|not available|not supported|unsupported|not registered|not a valid|no access|access denied))|unknown model|no such model|invalid model|not registered in the provider catalog|no model selected|select an available model/i,
  ],
  ["authentication", /\b403\b|forbidden|permission denied/i],
  [
    "timeout",
    /timed?[ -]?out|timeout|etimedout|deadline exceeded|aborted due to timeout|TimeoutError/i,
  ],
  [
    "connection",
    /econnrefused|enotfound|econnreset|eai_again|fetch failed|network|socket hang up|connection (error|refused|reset|closed)|getaddrinfo|\b50[234]\b|service unavailable|bad gateway|unable to connect/i,
  ],
  [
    "planning",
    /pi planning failed|plan must contain|task plan needs|returned no assistant response while planning|unexpected token|is not valid json|unexpected end of json/i,
  ],
];

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    const code = (error as { code?: unknown }).code;
    const parts = [error.name === "TimeoutError" ? "TimeoutError" : "", error.message];
    if (typeof code === "string" && !error.message.includes(code)) parts.push(`(${code})`);
    if (cause instanceof Error && cause.message && !error.message.includes(cause.message))
      parts.push(`Cause: ${cause.message}`);
    return parts.filter(Boolean).join(" ");
  }
  return String(error);
}

export function failureFromCategory(category: FailureCategory, message: string): TaskFailure {
  return {
    category,
    message: redactSecrets(message),
    retryable: RETRYABLE.has(category),
    provider: PROVIDER_CATEGORIES.has(category),
    recovery: RECOVERY[category],
  };
}

export function classifyFailure(error: unknown): TaskFailure {
  const text = describe(error);
  const category = RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? "execution";
  return failureFromCategory(category, text);
}

export function isTaskFailure(value: unknown): value is TaskFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as TaskFailure).category === "string" &&
    typeof (value as TaskFailure).message === "string" &&
    typeof (value as TaskFailure).retryable === "boolean"
  );
}
