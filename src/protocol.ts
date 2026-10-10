/**
 * Types and helpers shared by the agent server and the web UI.
 * The server streams `StreamEvent`s to the browser as newline-delimited JSON.
 */

/** A prior turn of the conversation, as replayed to the agent for follow-ups. */
export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  /** For assistant turns: the sources that answer cited, so follow-ups can cite them too. */
  sources?: Source[];
}

/** Something the agent read during research and can cite in its answer. */
export interface Source {
  id: string;
  kind: "document" | "financials" | "profile";
  company: string;
  title: string;
  date?: string;
  excerpt?: string;
}

export type ReplyKind = "answer" | "clarification";

/** "model" steps are the agent thinking; "tool" steps are research lookups. */
export type StepKind = "model" | "tool";

export type StreamEvent =
  | { type: "step_start"; id: string; kind: StepKind; label: string }
  | { type: "step_end"; id: string; status: "done" | "failed"; ms: number; detail?: string }
  | {
      type: "answer";
      kind: ReplyKind;
      answer: string;
      sources: Source[];
      followups: string[];
    }
  /**
   * The final answer has started streaming. `sources` is everything the agent has
   * read so far, so the UI can render citations before the answer is complete.
   */
  | { type: "answer_start"; sources: Source[] }
  | { type: "answer_delta"; text: string }
  | { type: "error"; message: string }
  /** Sent periodically so the client can tell a slow answer from a dead connection. */
  | { type: "heartbeat" };

export const HEARTBEAT_MS = 5_000;
/** The client gives up when nothing (not even a heartbeat) arrives for this long. */
export const STREAM_IDLE_TIMEOUT_MS = 20_000;

/** Matches citation markers like [DOC-ACME-001] or [FIN-ACME, DOC-ACME-002]. */
const SOURCE_ID = String.raw`(?:DOC|FIN|PROFILE)-[A-Z0-9-]+`;
export const CITATION_RE = new RegExp(
  String.raw`\[(${SOURCE_ID}(?:\s*[,;]\s*${SOURCE_ID})*)\]`,
  "g",
);

/** Source IDs cited in `text`, in order of first appearance. */
export function citedIds(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(CITATION_RE)) {
    for (const id of match[1].split(/\s*[,;]\s*/)) ids.add(id);
  }
  return [...ids];
}
