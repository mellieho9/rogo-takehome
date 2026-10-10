import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  CITATION_RE,
  citedIds,
  type ChatTurn,
  type ReplyKind,
  type Source,
  type StepKind,
  type StreamEvent,
  STREAM_IDLE_TIMEOUT_MS,
} from "../protocol.ts";

interface Step {
  id: string;
  kind: StepKind;
  label: string;
  status: "pending" | "running" | "done" | "failed";
  detail?: string;
}

interface UserMessage {
  role: "user";
  text: string;
}

interface AssistantMessage {
  role: "assistant";
  status: "working" | "done" | "error";
  steps: Step[];
  kind?: ReplyKind;
  /** The answer so far, while it streams in. */
  draft?: string;
  /** Everything read so far, for rendering citations in the draft. */
  available?: Source[];
  text?: string;
  sources?: Source[];
  followups?: string[];
  error?: string;
}

type Message = UserMessage | AssistantMessage;

const EXAMPLES = [
  "What companies do you cover?",
  "Compare Acme and Globex and tell me which one appears to be growing faster.",
  "What are the biggest risks Umbrella Health flags in its filings?",
  "How is Initech's subscription transition going?",
  "Which company in the universe is growing fastest?",
];

/** The completed question/answer pairs, as context for the next question. */
function historyOf(messages: Message[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (let i = 0; i + 1 < messages.length; i++) {
    const [q, a] = [messages[i], messages[i + 1]];
    if (q.role === "user" && a.role === "assistant" && a.status === "done" && a.text) {
      turns.push({ role: "user", text: q.text });
      turns.push({ role: "assistant", text: a.text, sources: a.sources });
      i++;
    }
  }
  return turns;
}

/**
 * Yield the server's NDJSON events. If nothing arrives for STREAM_IDLE_TIMEOUT_MS
 * (the server heartbeats well inside that), the connection is presumed dead and the
 * stream ends early, so the caller can show an error instead of spinning forever.
 */
async function* readEvents(res: Response): AsyncGenerator<StreamEvent> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let idle: ReturnType<typeof setTimeout> | undefined;
  const resetIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => reader.cancel().catch(() => {}), STREAM_IDLE_TIMEOUT_MS);
  };
  try {
    for (;;) {
      resetIdle();
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield JSON.parse(line) as StreamEvent;
      }
    }
  } finally {
    clearTimeout(idle);
  }
}

export function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const last = messages.at(-1);

  const bottomRef = useRef<HTMLDivElement>(null);
  const latestRef = useRef<HTMLDivElement>(null);
  const lastReply = last?.role === "assistant" ? last : undefined;
  const busy = lastReply?.status === "working";
  // Once the answer starts streaming (or is done), the reader reads it from the top.
  const showingAnswer = !!lastReply && (lastReply.draft !== undefined || lastReply.status !== "working");
  const stepCount = lastReply?.steps.length ?? 0;

  // Follow the progress steps while researching; when the answer starts, scroll to its
  // top once and leave the scroll position to the reader while it streams.
  useEffect(() => {
    if (showingAnswer) {
      latestRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages.length, stepCount, showingAnswer]);

  /** Apply `update` to the in-flight assistant message (always the last one). */
  function updateReply(update: (reply: AssistantMessage) => AssistantMessage) {
    setMessages((prev) => {
      const last = prev.at(-1);
      if (last?.role !== "assistant") return prev;
      return [...prev.slice(0, -1), update(last)];
    });
  }

  async function send(question: string, base: Message[] = messages) {
    question = question.trim();
    if (!question || busy) return;

    const conversation = [...historyOf(base), { role: "user" as const, text: question }];
    setMessages([
      ...base,
      { role: "user", text: question },
      { role: "assistant", status: "working", steps: [] },
    ]);
    setInput("");

    const fail = (error: string) =>
      updateReply((r) => ({ ...r, status: "error", error }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: conversation }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        fail(data.error ?? `The server responded with ${res.status}.`);
        return;
      }

      let finished = false;
      for await (const event of readEvents(res)) {
        switch (event.type) {
          case "step_start":
            updateReply((r) => ({
              ...r,
              steps: [...r.steps, { id: event.id, kind: event.kind, label: event.label, status: "running" }],
            }));
            break;
          case "step_end":
            updateReply((r) => ({
              ...r,
              steps: r.steps.map((s) =>
                s.id === event.id ? { ...s, status: event.status, detail: event.detail } : s,
              ),
            }));
            break;
          case "answer_start":
            updateReply((r) => ({ ...r, draft: "", available: event.sources }));
            break;
          case "answer_delta":
            updateReply((r) => ({ ...r, draft: (r.draft ?? "") + event.text }));
            break;
          case "answer":
            finished = true;
            updateReply((r) => ({
              ...r,
              status: "done",
              draft: undefined,
              available: undefined,
              kind: event.kind,
              text: event.answer,
              sources: event.sources,
              followups: event.followups,
            }));
            break;
          case "error":
            finished = true;
            fail(event.message);
            break;
        }
      }
      if (!finished) {
        fail("Lost the connection to the research server before an answer arrived. Please try again.");
      }
    } catch {
      fail("Couldn't reach the research server. Check that it's running and try again.");
    }
  }

  function newChat() {
    setMessages([]);
  }

  /** Re-ask the question behind a failed reply at `index`. */
  function retry(index: number) {
    const question = messages[index - 1];
    if (question?.role === "user") send(question.text, messages.slice(0, index - 1));
  }

  // Stable identities for the memoized <Reply>s, so only the reply that changed
  // re-renders (and re-parses its markdown) on each streamed event.
  const latest = useRef({ send, retry });
  latest.current = { send, retry };
  const ask = useCallback((question: string) => latest.current.send(question), []);
  const retryAt = useCallback((index: number) => latest.current.retry(index), []);

  return (
    <div className="app">
      <header>
        <div>
          <h1>
            <button className="home" onClick={() => !busy && newChat()} title="Start a new chat">
              Rogo Research
            </button>
          </h1>
          <p>Ask a question about a company in our coverage universe.</p>
        </div>
        {messages.length > 0 && (
          <button className="ghost" onClick={newChat} disabled={busy}>
            New chat
          </button>
        )}
      </header>

      <div className="transcript">
        {messages.length === 0 && (
          <div className="chips">
            {EXAMPLES.map((example) => (
              <button key={example} onClick={() => send(example)}>
                {example}
              </button>
            ))}
          </div>
        )}

        {messages.map((message, i) =>
          message.role === "user" ? (
            <div key={i} className="bubble user">
              {message.text}
            </div>
          ) : (
            <Reply
              key={i}
              ref={message === last ? latestRef : undefined}
              index={i}
              reply={message}
              isLatest={message === last}
              onAsk={ask}
              onRetry={retryAt}
            />
          ),
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={messages.length ? "Ask a follow-up…" : "Ask a research question…"}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

const Reply = memo(function Reply({
  ref,
  index,
  reply,
  isLatest,
  onAsk,
  onRetry,
}: {
  ref?: Ref<HTMLDivElement>;
  index: number;
  reply: AssistantMessage;
  isLatest: boolean;
  onAsk: (question: string) => void;
  onRetry: (index: number) => void;
}) {
  const anchor = useCallback((id: string) => `src-${index}-${id}`, [index]);

  if (reply.status === "working") {
    if (reply.draft === undefined) {
      return (
        <div ref={ref} className="bubble assistant working">
          <Progress steps={reply.steps} working />
        </div>
      );
    }
    // The answer is streaming in: show it with live citations, steps collapsed.
    return (
      <div ref={ref} className="bubble assistant">
        <ProgressSummary reply={reply} />
        <AnswerBody text={reply.draft} available={reply.available ?? []} anchor={anchor} streaming />
      </div>
    );
  }

  if (reply.status === "error") {
    return (
      <div ref={ref} className="bubble assistant error">
        <p>{reply.error}</p>
        {reply.steps.length > 0 && <ProgressSummary reply={reply} />}
        {isLatest && (
          <button className="ghost" onClick={() => onRetry(index)}>
            Try again
          </button>
        )}
      </div>
    );
  }

  const followups = reply.followups ?? [];

  return (
    <div ref={ref} className={`bubble assistant ${reply.kind === "clarification" ? "clarification" : ""}`}>
      {reply.kind !== "clarification" && reply.steps.length > 0 && <ProgressSummary reply={reply} />}

      <AnswerBody text={reply.text ?? ""} available={reply.sources ?? []} anchor={anchor} />

      {isLatest && followups.length > 0 && (
        <div className="chips followups">
          {followups.map((followup) => (
            <button key={followup} onClick={() => onAsk(followup)}>
              {followup}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

/**
 * The answer markdown plus its numbered Sources list. Sources are those cited in
 * `text`, in order of first citation, so numbering stays stable while the text streams.
 */
function AnswerBody({
  text,
  available,
  anchor,
  streaming = false,
}: {
  text: string;
  available: Source[];
  anchor: (id: string) => string;
  streaming?: boolean;
}) {
  const ids = citedIds(text).join(",");
  const sources = useMemo(
    () => (ids ? ids.split(",") : []).flatMap((id) => available.find((s) => s.id === id) ?? []),
    [ids, available],
  );
  // A new component type per render would remount every link; only rebuild when sources change.
  const components = useMemo(() => ({ a: CitationLink(sources, anchor) }), [sources, anchor]);

  return (
    <>
      <div className={`answer ${streaming ? "streaming" : ""}`}>
        <Markdown remarkPlugins={[remarkGfm]} components={components}>
          {/* Hide a citation that's still being written, e.g. a trailing "[DOC-AC". */}
          {linkCitations(streaming ? text.replace(/\[[A-Z0-9, -]*$/, "") : text)}
        </Markdown>
      </div>

      {sources.length > 0 && <div className="sources-label">Sources</div>}
      {sources.length > 0 && (
        <ol className="sources">
          {sources.map((source, n) => (
            <li key={source.id} id={anchor(source.id)}>
              <details>
                <summary>
                  <span className="source-num">{n + 1}</span>
                  <span className="source-title">{source.title}</span>
                  <span className="source-meta">
                    {[source.date, source.id].filter(Boolean).join(" · ")}
                  </span>
                </summary>
                {source.excerpt && <p>{source.excerpt}</p>}
              </details>
            </li>
          ))}
        </ol>
      )}

    </>
  );
}

/** Turn [DOC-X, FIN-Y] markers into markdown links the CitationLink renderer picks up. */
function linkCitations(text: string): string {
  return text.replace(CITATION_RE, (_, ids: string) =>
    ids
      .split(/\s*[,;]\s*/)
      .map((id) => `[${id}](#cite-${id})`)
      .join(""),
  );
}

function CitationLink(sources: Source[], anchor: (id: string) => string) {
  return function Link({ href, children }: { href?: string; children?: ReactNode }) {
    if (!href?.startsWith("#cite-")) {
      return (
        <a href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      );
    }
    const id = href.slice("#cite-".length);
    const n = sources.findIndex((s) => s.id === id);
    if (n < 0) {
      return (
        <sup className="cite unverified" title={`${id} — not among the sources the agent read; treat as unverified`}>
          ?
        </sup>
      );
    }
    return (
      <sup className="cite">
        <a
          href={`#${anchor(id)}`}
          title={sources[n].title}
          onClick={(e) => {
            e.preventDefault();
            const el = document.getElementById(anchor(id));
            el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
            el?.querySelector("details")?.setAttribute("open", "");
            el?.classList.remove("flash");
            void el?.offsetWidth;
            el?.classList.add("flash");
          }}
        >
          {n + 1}
        </a>
      </sup>
    );
  };
}

/** Vertical stepper: one node per step, joined by a line that fills in as steps finish. */
function Progress({ steps, working = false }: { steps: Step[]; working?: boolean }) {
  // While working, end with a not-yet-started "answer" node so it's clear what's still to come.
  const nodes: Step[] = working
    ? [...steps, { id: "answer", kind: "model", label: "Write answer", status: "pending" }]
    : steps;
  if (working && steps.length === 0) nodes[0] = { ...nodes[0], label: "Starting research", status: "running" };

  return (
    <ol className="stepper">
      {nodes.map((step) => (
        <li key={step.id} className={`${step.status} ${step.kind}`}>
          <span className="node" aria-hidden>
            {step.status === "done" ? "✓" : step.status === "failed" ? "!" : null}
          </span>
          <div className="content">
            <span className="label">{step.label}</span>
            {step.detail && <span className="detail">{step.detail}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function ProgressSummary({ reply }: { reply: AssistantMessage }) {
  const lookups = reply.steps.filter((s) => s.kind === "tool");
  const failed = reply.steps.filter((s) => s.status === "failed").length;
  return (
    <details className="summary">
      <summary>
        {lookups.length} lookup{lookups.length === 1 ? "" : "s"}
        {failed > 0 && ` · ${failed} failed`}
      </summary>
      <Progress steps={reply.steps} />
    </details>
  );
}
