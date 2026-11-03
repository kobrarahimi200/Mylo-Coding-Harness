import type { AgentMode } from "../../shared/harness";

const EDIT_INTENT =
  /\b(fix|implement|add|create|write|edit|change|modify|update|refactor|rename|delete|remove|install|build|deploy|migrate|commit|push|generate|replace|set up|apply)\b/i;
const QUESTION_START =
  /^\s*(why|how|what|which|where|who|when|explain|compare|analy[sz]e|review|audit|investigate|summari[sz]e|research|trace|understand|evaluate|assess|describe|walk me through|tell me|can you (explain|compare|analy[sz]e|review|investigate))\b/i;
const DEPTH_SIGNALS =
  /\b(architecture|across|entire|whole (repo|codebase|project)|all (files|modules|packages)|root cause|trade-?offs?|end-to-end|security|performance|dependenc(y|ies)|data flow|design|pros and cons|compare|investigate|audit|deep|thorough|in depth|step by step)\b/gi;

export type Complexity = { score: number; question: boolean; editIntent: boolean };

export function assessPrompt(message: string): Complexity {
  const text = message.trim();
  const questionMarks = (text.match(/\?/g) ?? []).length;
  const listItems = (text.match(/^\s*(?:\d+[.)]|[-*])\s+/gm) ?? []).length;
  const signals = new Set((text.match(DEPTH_SIGNALS) ?? []).map((word) => word.toLowerCase()));
  let score = 0;
  if (text.length >= 240) score += 1;
  if (text.length >= 600) score += 1;
  if (questionMarks >= 2) score += 1;
  if (listItems >= 3) score += 1;
  if (signals.size >= 2) score += 1;
  if (signals.size >= 4) score += 1;
  return {
    score,
    question: QUESTION_START.test(text) || text.endsWith("?"),
    editIntent: EDIT_INTENT.test(text) && !QUESTION_START.test(text),
  };
}

const COMPLEX_SCORE = 2;

/**
 * Deep Agents only answers; it never edits or runs commands. Ask mode sends any
 * complex prompt there. Agent mode sends only complex questions without edit intent,
 * so implementation work keeps the approved-plan flow.
 */
export function shouldUseDeepAgent(message: string, mode: AgentMode): boolean {
  if (mode === "plan") return false;
  const { score, question, editIntent } = assessPrompt(message);
  if (score < COMPLEX_SCORE) return false;
  return mode === "ask" ? true : question && !editIntent;
}
