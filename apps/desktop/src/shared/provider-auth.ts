export type ProviderAuthMethod = { type: "api_key" | "oauth"; label: string };
export type ProviderAuthEvent = { provider: string } & (
  | {
      type: "prompt";
      promptId: string;
      kind: "text" | "secret" | "select" | "manual_code";
      message: string;
      options?: readonly { id: string; label: string }[];
    }
  | { type: "notice"; message: string; url?: string }
);
export type ProviderConnectionResult = { ok: boolean; message: string };
