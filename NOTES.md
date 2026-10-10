## baseline (ran the original code first)
- slow: 25–44s per question. tools ran one at a time, plus an extra "editor" model call, no caching
- ux: only showed "thinking…", markdown not rendered, no coverage universe, no way back to the main page
- no conversation history: "how does its margin compare to the other one?" → "which two companies?"
- no citations, no clickable follow-ups, no token log, no unit tests
- already worked: logged tool calls, resisted a prompt-injection attempt, handled ambiguous "acme" by stating an assumption

## priorities
1. trust first (ux + agent behavior): analysts can't act on answers they can't verify or follow up on
2. then speed + cost
3. engineering (tests, logs) throughout

## what i changed and why
trust
- citations: every figure cites a source; the server checks the agent actually read it, and unverified ones are flagged
- progress stepper, so users see what the agent is doing
- conversation history, so follow-ups keep context (answer text only, to keep it cheap)
- clarify-vs-assume rules in the system prompt: only ask when readings differ a lot (e.g. "acme")
- clickable follow-ups, markdown rendering, logo → new chat
- error messages with retry; a heartbeat so a dead connection shows an error instead of spinning forever
- removed the editor pass: an extra model call, and its "brief and conversational" rewrite could drop caveats

speed + cost
- streamed answers: first text at 4–7s instead of 15–20s
- parallel tool calls; the prompt asks for financials + documents in one round (3 model calls → 2 on "glbx vs itch")
- prompt caching: repeated input ~10x cheaper, almost all input is now cache reads
- tool-result caching: follow-ups reuse earlier lookups. small win here (~0.8s, local data), bigger with real apis
- quarterly data only on request (~630 → ~220 tokens per company)
- skipped batching document search: parallel calls already cover it

## tradeoffs / known risks
- streaming skips the api's input check, and the model sometimes breaks the json → recovery code rebuilds the answer + follow-ups (tested on real broken outputs)
- token log undercounts when that recovery kicks in

## not done (yet)
- evals. my manual test cases are the first set: ambiguous acme, unfiled initech fy2025, organic vs acquired growth, follow-up context, prompt injection
- history of all chats, ticker suggestions while typing
- a token dashboard + flagging harmful prompts
- add verifier to fact check cited figure 

## unit tests
- `npm test`: 26 tests in `src/tools.test.ts` and `src/toolCache.test.ts`
- covers company/ticker matching, citations, follow-up parsing, streaming + recovery, tool cache
