import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import { runAgent } from "./agent.ts";
import { HEARTBEAT_MS, type ChatTurn, type StreamEvent } from "./protocol.ts";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "\nANTHROPIC_API_KEY is not set.\nCopy .env.example to .env and add your key, then run `npm run dev` again.\n",
  );
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "1mb" }));

function parseConversation(body: unknown): ChatTurn[] | undefined {
  const turns = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(turns) || turns.length === 0) return undefined;
  const parsed = turns.map((t) => ({
    role: t?.role === "assistant" ? ("assistant" as const) : ("user" as const),
    text: String(t?.text ?? ""),
    sources: Array.isArray(t?.sources) ? t.sources : undefined,
  }));
  const last = parsed.at(-1)!;
  return last.role === "user" && last.text.trim() ? parsed : undefined;
}

/** A message the analyst can act on, rather than a stack trace. */
function friendlyError(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    if (err.status === 429 || err.status === 529) {
      return "The research model is busy right now. Please try again in a moment.";
    }
    if (err.status === 401) return "The server's API key was rejected. Check ANTHROPIC_API_KEY.";
  }
  return "Something went wrong while researching your question. Please try again.";
}

app.post("/api/chat", async (req, res) => {
  const conversation = parseConversation(req.body);
  if (!conversation) {
    res.status(400).json({ error: "Expected { messages: [...] } ending with a user question." });
    return;
  }
  console.log(`\n[chat] ${conversation.at(-1)!.text} (${conversation.length - 1} prior turns)`);

  // Stream progress and the final answer as newline-delimited JSON.
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders();
  const send = (event: StreamEvent) => {
    if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
  };
  const heartbeat = setInterval(() => send({ type: "heartbeat" }), HEARTBEAT_MS);

  // Stop spending tokens if the analyst navigates away.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  const startedAt = Date.now();
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const tools = { cacheHits: 0 };

  try {
    const result = await runAgent(
      conversation,
      (event) => {
        switch (event.type) {
          case "step_start":
          case "answer_start":
          case "answer_delta":
            send(event);
            break;
          case "step_end":
            send(event);
            if (event.status === "failed") console.log(`[step]  ! ${event.detail}`);
            break;
          case "tool_call":
            console.log(`[tool]  → ${event.name} ${JSON.stringify(event.input)}`);
            break;
          case "tool_cache_hit":
            tools.cacheHits++;
            console.log(`[tool]  ✓ ${event.name} served from cache`);
            break;
          case "usage":
            tokens.input += event.inputTokens;
            tokens.output += event.outputTokens;
            tokens.cacheRead += event.cacheReadTokens;
            tokens.cacheWrite += event.cacheWriteTokens;
            break;
        }
      },
      abort.signal,
    );

    if (result.unknownCitations.length) {
      console.warn(`[agent] cited sources it never read: ${result.unknownCitations.join(", ")}`);
    }
    console.log(
      `[agent] ${result.kind} in ${result.iterations} iterations, ${Date.now() - startedAt}ms, ` +
        `tokens: ${tokens.input} uncached + ${tokens.cacheRead} cache-read + ${tokens.cacheWrite} cache-write input, ` +
        `${tokens.output} output; ${tools.cacheHits} tool cache hits; ${result.sources.length} sources`,
    );

    send({
      type: "answer",
      kind: result.kind,
      answer: result.answer,
      sources: result.sources,
      followups: result.followups,
    });
  } catch (err) {
    if (abort.signal.aborted) {
      console.log("[chat] client disconnected; aborted");
    } else {
      console.error(err);
      send({ type: "error", message: friendlyError(err) });
    }
  }
  clearInterval(heartbeat);
  res.end();
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`Agent server listening on http://localhost:${port}`);
});
