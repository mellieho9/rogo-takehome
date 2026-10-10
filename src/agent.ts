/**
 * The research agent: a tool-use loop over the mocked research tools.
 */

import Anthropic from "@anthropic-ai/sdk";
import { companies } from "./data.ts";
import { citedIds, type ChatTurn, type ReplyKind, type Source, type StepKind } from "./protocol.ts";
import { createToolCache } from "./toolCache.ts";
import { executeTool, sourcesFrom, toolSchemas } from "./tools.ts";

const MODEL = process.env.ROGO_MODEL ?? "claude-sonnet-5";
const MAX_ITERATIONS = 12;
/** Prior turns replayed for follow-up questions. Older turns are dropped. */
const MAX_HISTORY_TURNS = 20;

const client = new Anthropic();

const cachedExecuteTool = createToolCache({
  execute: executeTool,
  ttlMs: Number(process.env.ROGO_TOOL_CACHE_TTL_MS ?? 10 * 60_000),
});

const SYSTEM_PROMPT = `You are Rogo Research, an assistant that answers questions about companies for financial analysts. Analysts act on your answers, so accuracy and traceability matter more than polish.

Coverage universe (the only companies you have data on):
${companies
  .map(
    (c) =>
      `- ${c.name} (${c.ticker}) — ${c.sector}, HQ ${c.hq}, ${c.employees} employees. ${c.description}`,
  )
  .join("\n")}

## Researching
- Tools accept a company's full name or ticker. You already know the universe above, so you rarely need searchCompanies.
- Plan up front and request everything you need in a single turn: e.g. financials *and* document searches for every company involved, all at once. Calls in one turn run in parallel, and document searches don't depend on the financials. Only do a second round if the results reveal a real gap.
- Don't re-fetch data you already have in this conversation.
- Numbers alone can mislead. For growth, performance or risk questions, also search the company's documents for context the financials don't show: organic vs. acquired growth, guidance, one-offs, management commentary.
- getFinancials returns annual figures; pass \`includeQuarterly\` only when the question is about quarters or seasonality.
- searchDocuments is keyword search: pass 1–6 distinctive keywords, not a sentence, and scope it with \`company\` when you can.
- If a tool returns an error, read it and change the call (fix the name, shorten the query). Never repeat a failing call unchanged. If the data doesn't exist, say so in your answer.

## Clarify or assume
The conversation may include earlier turns. Resolve "it", "they", "both", "the other one" etc. against them before anything else.

Ask a clarifying question (respond with kind "clarification") only when the plausible readings lead to materially different answers and neither the question nor the conversation settles it. Example: a bare "Acme" could mean Acme Corp or Acme Robotics, two unrelated companies with very different growth profiles. Put the concrete options in \`followups\`, each phrased as a complete question the analyst can send as-is. Ask before researching, not after.

Otherwise, make a reasonable assumption, state it in one line at the top of the answer, and answer. For example:
- No period given → use the latest full fiscal year plus the multi-year trend.
- "Better business" → compare growth, margins and cash generation, and say it's a judgment call.
- "Fastest growing in the universe" → just pull the data and compute it; don't ask.

## Answering
- Lead with the direct answer in one or two sentences, then the support. Use markdown: short sections or bullets, and a table for multi-company or multi-period comparisons. Be concise.
- Cite every figure and factual claim with the \`sourceId\` from the tool result, in square brackets: "Revenue grew 5.5% [FIN-ACME]", "management guides 4–6% [DOC-ACME-001]". Only cite IDs you actually received. Filing IDs listed in a profile (e.g. ACME-10K-2025) are not sources you have read.
- For derived numbers (growth rates, CAGR, margins), state the inputs and periods.
- Surface caveats from the data: unfiled or preliminary periods, warnings, restatements, acquisition-driven vs. organic growth. Never fill a gap with a number you don't have.
- Figures are USD millions unless stated otherwise.
- Deliver your reply by calling the \`respond\` tool. With an answer, include 2–3 follow-up questions the analyst is likely to ask next.
`;

const RESPOND_TOOL: Anthropic.Tool = {
  name: "respond",
  // Stream the answer to the analyst as it's written. This skips server-side
  // validation of the input, so it's validated after the stream ends.
  eager_input_streaming: true,
  description:
    "Deliver your reply to the analyst. Call this once, alone, when research is complete — or straight away to ask a clarifying question.",
  input_schema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["answer", "clarification"],
        description: '"answer" for a researched answer, "clarification" to ask the analyst a question.',
      },
      answer: {
        type: "string",
        description:
          "Markdown shown to the analyst. For an answer, cite sources inline as [SOURCE-ID]. For a clarification, the question.",
      },
      followups: {
        type: "array",
        items: { type: "string" },
        description:
          "For an answer: 2–3 likely next questions. For a clarification: the options, each a complete question the analyst can send as-is.",
      },
    },
    required: ["kind", "answer", "followups"],
  },
};

interface RespondInput {
  kind: ReplyKind;
  answer: string;
  /** Model output, so not guaranteed to be an array; see normalizeFollowups. */
  followups: unknown;
}

export type AgentEvent =
  | { type: "step_start"; id: string; kind: StepKind; label: string }
  | { type: "step_end"; id: string; status: "done" | "failed"; ms: number; detail?: string }
  | { type: "tool_call"; name: string; input: unknown }
  | { type: "tool_cache_hit"; name: string }
  | { type: "answer_start"; sources: Source[] }
  | { type: "answer_delta"; text: string }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
    };

export interface AgentResult {
  kind: ReplyKind;
  answer: string;
  sources: Source[];
  followups: string[];
  iterations: number;
  /** Citation markers that don't match anything the agent actually read. */
  unknownCitations: string[];
}

/**
 * Follow-ups are model output: they sometimes arrive as a JSON-encoded string, as
 * newline-separated text, or wrapped in stray XML-ish tags. Coerce them to a clean list.
 */
export function normalizeFollowups(value: unknown): string[] {
  return flattenFollowups(value)
    .map((f) => f.replace(/<\/?\w+[^>]*>/g, "").replace(/^\s*(?:[-*]|\d+\.)\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 4);
}

function flattenFollowups(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(flattenFollowups);
  if (typeof value !== "string") return [];
  // A JSON array, possibly with junk around it like `<parameter name="followups">[...]`.
  const start = value.indexOf("[");
  const end = value.lastIndexOf("]");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(value.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed.flatMap(flattenFollowups);
    } catch {
      // Not JSON; fall through to line splitting.
    }
  }
  return value.split(/\n|<\/\w+>/);
}

/**
 * Decode the (possibly unfinished) string value of `key` from a partial JSON object,
 * e.g. `{"kind":"answer","answer":"Revenue gr` → "Revenue gr". Stops before an
 * incomplete escape sequence. The SDK's partial parser drops unfinished strings, so
 * it can't be used to stream a string field as it's generated.
 */
export function partialStringField(json: string, key: string): string | undefined {
  const start = new RegExp(`"${key}"\\s*:\\s*"`).exec(json);
  if (!start) return undefined;
  const escapes: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", '"': '"', "\\": "\\", "/": "/" };
  let out = "";
  for (let i = start.index + start[0].length; i < json.length; i++) {
    const ch = json[i];
    if (ch === '"') break;
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = json[i + 1];
    if (next === undefined) break;
    if (next === "u") {
      const hex = json.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
    } else {
      out += escapes[next] ?? next;
      i += 1;
    }
  }
  return out;
}

/**
 * Markup the model sometimes writes into the answer string when it "closes" the
 * answer itself and then writes the follow-ups, e.g.
 * `…the 10-K.</answer> <parameter name="followups">["How has…?"]`.
 */
const LEAKED_MARKUP = /<\/answer>|<\/?parameter\b[^>]*>|<\/?followups>/;

/** Split leaked follow-up markup off the end of an answer. */
export function splitLeakedFollowups(answer: string): { answer: string; leaked: string[] } {
  const match = LEAKED_MARKUP.exec(answer);
  if (!match) return { answer, leaked: [] };
  return {
    answer: answer.slice(0, match.index).trimEnd(),
    leaked: normalizeFollowups(answer.slice(match.index)).filter((f) => f.endsWith("?")),
  };
}

/**
 * The part of a streaming answer that's safe to show: everything before leaked
 * markup, holding back a trailing "<…" that might be the start of it.
 */
export function visibleAnswer(answer: string): string {
  // An unfinished tag at the very end ("</ans", '<parameter name="fol') could be
  // leaked markup; hold it until it completes. "<5%" doesn't look like a tag.
  return splitLeakedFollowups(answer).answer.replace(/<\/?[a-z]*(?:\s[^>]*)?$/i, "");
}

/** Rebuild a `respond` reply from its raw (unparseable) JSON input. */
export function recoverReply(raw: string): RespondInput {
  const key = raw.indexOf('"followups"');
  const tail = key < 0 ? "" : raw.slice(key + '"followups"'.length).replace(/^\s*:\s*/, "").replace(/\}\s*$/, "");
  return {
    kind: partialStringField(raw, "kind") === "clarification" ? "clarification" : "answer",
    answer: partialStringField(raw, "answer") ?? "",
    // Whatever shape they arrived in, follow-ups are questions; drop the leftovers.
    followups: normalizeFollowups(tail)
      .map((f) => f.replace(/^"|"$/g, "").trim())
      .filter((f) => f.endsWith("?")),
  };
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/** A short, analyst-readable description of a tool call, for the progress list. */
function describeToolCall(name: string, input: Record<string, unknown>): string {
  const company = input.company ? String(input.company) : undefined;
  switch (name) {
    case "searchCompanies":
      return input.query ? `Finding companies matching “${input.query}”` : "Listing covered companies";
    case "getCompanyProfile":
      return `Loading ${company} profile`;
    case "getFinancials":
      return `Loading ${company} financials`;
    case "searchDocuments":
      return `Searching ${company ? `${company} ` : ""}documents for “${input.query}”`;
    default:
      return `Running ${name}`;
  }
}

function historyToMessages(history: ChatTurn[]): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];
  for (const turn of history.slice(-MAX_HISTORY_TURNS)) {
    const text = turn.text.trim();
    if (!text) continue;
    const last = messages.at(-1);
    // The API requires alternating roles; merge any consecutive same-role turns.
    if (last && last.role === turn.role) {
      last.content = `${last.content}\n\n${text}`;
    } else {
      messages.push({ role: turn.role, content: text });
    }
  }
  // The conversation has to start with the analyst.
  while (messages[0]?.role === "assistant") messages.shift();
  return messages;
}

/**
 * One streamed model call. Calls `onAnswerDelta` with new answer text as the model
 * writes the `respond` tool's `answer` field. Resolves with the complete message, or
 * with no message if the `respond` input turned out to be unparseable JSON — in which
 * case `rawRespondInput` holds what was streamed.
 */
async function streamModelTurn(
  params: Anthropic.MessageCreateParamsNonStreaming,
  handlers: { onAnswerStart: () => void; onAnswerDelta: (text: string) => void },
  signal?: AbortSignal,
): Promise<{ response?: Anthropic.Message; rawRespondInput: string }> {
  const stream = client.messages.stream(params, { signal });
  let respondIndex = -1;
  let raw = "";
  let streamed = 0;

  try {
    for await (const event of stream) {
      if (
        event.type === "content_block_start" &&
        event.content_block.type === "tool_use" &&
        event.content_block.name === RESPOND_TOOL.name
      ) {
        respondIndex = event.index;
      } else if (
        event.type === "content_block_delta" &&
        event.index === respondIndex &&
        event.delta.type === "input_json_delta"
      ) {
        raw += event.delta.partial_json;
        const answer = visibleAnswer(partialStringField(raw, "answer") ?? "");
        if (answer.length > streamed) {
          if (streamed === 0) handlers.onAnswerStart();
          handlers.onAnswerDelta(answer.slice(streamed));
          streamed = answer.length;
        }
      }
    }
    return { response: await stream.finalMessage(), rawRespondInput: raw };
  } catch (err) {
    // API errors (rate limits, auth, aborts) are real failures; rethrow them. Anything
    // else here is the SDK failing to parse the streamed `respond` input.
    if (err instanceof Anthropic.APIError || respondIndex < 0) throw err;
    return { rawRespondInput: raw };
  }
}

/**
 * Answer the latest question in `conversation` (whose last turn is the analyst's).
 * Earlier turns give context for follow-ups.
 */
export async function runAgent(
  conversation: ChatTurn[],
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<AgentResult> {
  const messages = historyToMessages(conversation);
  if (messages.at(-1)?.role !== "user") {
    throw new Error("conversation must end with the analyst's question");
  }

  // Everything the agent has read and may cite: this turn's tool results plus
  // sources cited earlier in the conversation.
  const read = new Map<string, Source>();
  for (const turn of conversation) {
    for (const source of turn.sources ?? []) read.set(source.id, source);
  }
  let reply: RespondInput | undefined;
  let iterations = 0;
  let stepCount = 0;

  async function step<T>(
    kind: StepKind,
    label: string,
    fn: () => Promise<T>,
    detail?: (result: T) => string,
  ) {
    const id = `s${++stepCount}`;
    const startedAt = Date.now();
    onEvent({ type: "step_start", id, kind, label });
    try {
      const result = await fn();
      onEvent({ type: "step_end", id, status: "done", ms: Date.now() - startedAt, detail: detail?.(result) });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onEvent({ type: "step_end", id, status: "failed", ms: Date.now() - startedAt, detail: message });
      throw err;
    }
  }

  while (!reply && iterations < MAX_ITERATIONS) {
    iterations++;
    const lastChance = iterations === MAX_ITERATIONS;

    // Streamed so the final answer reaches the analyst as it's written; the rest of
    // the loop works on the complete message.
    const { response, rawRespondInput } = await step(
      "model",
      iterations === 1 ? "Planning research" : lastChance ? "Writing up what I found" : "Reviewing findings",
      () =>
        streamModelTurn(
          {
            model: MODEL,
            max_tokens: 16000,
            // Cache the stable prefix (tools + system prompt) explicitly, and let
            // automatic caching cover the transcript that grows each iteration.
            system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
            cache_control: { type: "ephemeral" },
            tools: [...toolSchemas, RESPOND_TOOL],
            // Every turn must call a tool, so replies always arrive via `respond` with
            // structured follow-ups. Out of research budget: force the reply from
            // what has been gathered so far.
            tool_choice: lastChance ? { type: "tool", name: RESPOND_TOOL.name } : { type: "any" },
            messages,
          },
          {
            onAnswerStart: () => onEvent({ type: "answer_start", sources: [...read.values()] }),
            onAnswerDelta: (text) => onEvent({ type: "answer_delta", text }),
          },
          signal,
        ),
    );

    if (!response) {
      // The respond input was malformed JSON (eager streaming skips the API's
      // validation; the model sometimes writes followups as XML). The streamed
      // answer is intact, so recover the reply from the raw input.
      console.warn("[agent] respond input was not valid JSON; recovered from raw stream");
      reply = recoverReply(rawRespondInput);
      break;
    }

    onEvent({
      type: "usage",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    });

    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    const respond = toolUses.find((use) => use.name === RESPOND_TOOL.name);
    if (respond) {
      reply = respond.input as RespondInput;
      break;
    }

    if (toolUses.length === 0) {
      // Shouldn't happen with tool_choice "any", but don't lose a plain-text answer.
      reply = { kind: "answer", answer: textOf(response), followups: [] };
      break;
    }

    // Independent tool calls from one turn run in parallel.
    const toolResults = await Promise.all(
      toolUses.map(async (use): Promise<Anthropic.ToolResultBlockParam> => {
        const input = use.input as Record<string, unknown>;
        onEvent({ type: "tool_call", name: use.name, input });
        try {
          const { output, cached } = await step(
            "tool",
            describeToolCall(use.name, input),
            () => cachedExecuteTool(use.name, input),
            ({ output: out }) => (Array.isArray(out) ? `${out.length} result${out.length === 1 ? "" : "s"}` : ""),
          );
          if (cached) onEvent({ type: "tool_cache_hit", name: use.name });
          for (const source of sourcesFrom(use.name, output)) read.set(source.id, source);
          return { type: "tool_result", tool_use_id: use.id, content: JSON.stringify(output) };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { type: "tool_result", tool_use_id: use.id, content: message, is_error: true };
        }
      }),
    );

    messages.push({ role: "user", content: toolResults });
  }

  if (typeof reply?.answer !== "string" || !reply.answer.trim()) {
    reply = {
      kind: "answer",
      answer:
        "I wasn't able to put together an answer from the research I did. Try asking a narrower question, or name the specific company and metric you're interested in.",
      followups: [],
    };
  }

  const { answer, leaked } = splitLeakedFollowups(reply.answer);
  const followups = normalizeFollowups(reply.followups);
  const cited = citedIds(answer);
  return {
    kind: reply.kind === "clarification" ? "clarification" : "answer",
    answer,
    followups: followups.length ? followups : leaked,
    sources: cited.flatMap((id) => read.get(id) ?? []),
    unknownCitations: cited.filter((id) => !read.has(id)),
    iterations,
  };
}
