# Rogo Research Agent — engineering exercise

This is a small, working research agent. An analyst asks a question about a company;
the agent calls a few research tools and answers.

It was prototyped quickly. It works, and it is not finished.

## Your task

**Review the implementation and improve the areas you believe would have the highest impact.**

Possible areas include:

- **Product / UX** — interaction quality, communicating progress, handling ambiguous
  requests, presenting answers clearly, error states
- **Agent behavior** — tool selection, repeated or unnecessary tool calls, loop and
  stopping behavior, handling tool failures, maintaining useful context, answer quality
- **Performance / efficiency** — latency, unnecessary model or tool calls, parallelizing
  independent work, context and token usage
- **Engineering quality** — architecture, reliability, maintainability, testing,
  observability, error handling

You do **not** need to address every area. We care much more about the quality of your
decisions than the amount of code you write. A focused, well-reasoned change to two
areas beats a shallow pass over all four.

**Please spend no more than 60–90 minutes.** Stop when the time is up, even mid-thought.
We would rather see what you chose to do first.

**You may use any AI coding tools you normally use** — Claude Code, Cursor, Codex,
whatever your setup is. We use them too. You will be asked to explain the code you
submit, including code a tool generated for you.

We will discuss your approach and implementation in the interview.

## Setup

Requires Node 22 (or Node 20.19+).

```bash
npm install
cp .env.example .env   # then paste in the API key we sent you
npm run dev
```

Open http://localhost:5173. The agent server logs its tool calls to the terminal,
which is usually the fastest way to see what the agent is actually doing.

## Try it

Some questions to start with:

- "Compare Acme and Globex and tell me which one appears to be growing faster."
- "What are the biggest risks Umbrella Health flags in its filings?"
- "How is Initech's subscription transition going?"
- "Which company in the universe is growing fastest?"
- "Is GLBX a better business than ITCH?"

## The code

Nine files matter:

| File | What it is |
| --- | --- |
| `src/server.ts` | Express server, one `POST /api/chat` endpoint |
| `src/agent.ts` | The agent loop — system prompt, tool-use loop, final answer |
| `src/tools.ts` | Tool schemas and tool execution |
| `src/data.ts` | All the research data. Fictional, local, deterministic |
| `src/ui/App.tsx` | The chat interface |
| `src/ui/main.tsx`, `src/ui/styles.css` | Mount point and styling |
| `vite.config.ts`, `package.json` | Vite dev server proxies `/api` to port 8787 |

There are five fictional companies. The tools are backed entirely by `src/data.ts` —
no network calls, no credentials beyond the model key, nothing to set up. Each tool
sleeps for a few hundred milliseconds to stand in for a real API.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the agent server and the web UI together |
| `npm run dev:server` | Agent server only, on port 8787 |
| `npm run dev:web` | Web UI only, on port 5173 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Runs Vitest |

The model defaults to `claude-sonnet-5`. Set `ROGO_MODEL` in `.env` to change it.

## Submitting

Commit your work on a branch and send us the repo (or a zip, or a PR — whatever is
easiest). If you want to leave notes on what you changed and why, add a short
`NOTES.md`. Bullet points are fine; please don't write a design document.

If you noticed something you deliberately chose *not* to fix, that is worth a line
too — we will ask about it either way.
