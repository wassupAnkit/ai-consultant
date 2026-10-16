---
title: Answer and research with DeepSeek V4.1 Flash, Gemini as fallback
author: Aashish (author@heubert.com)
requested by: Aashish
---

# Answer and research with DeepSeek V4.1 Flash, Gemini as fallback
_Intent written 2026-09-28 with Aashish, solo mode, no ticket. Based on the model benchmark run in the same session._

## Problem
Edge sends every answer and every research step (tool selection) to Gemini 3.6 Flash. That costs about $0.0057 per answer and $0.02 per research phase. A cheaper model that is at least as good was not available to production, because Edge can only call Gemini.

The benchmark on 2026-09-28 found DeepSeek V4.1 Flash scored higher than Gemini 3.6 Flash for answers (judge score 4.77 vs 4.27 on 3 real conversations). It stayed within the evidence on every answer and cost about a sixth as much per answer. On the one research conversation tested, it chose sensible tools at about a fifth of the cost.

Evidence:
- **Report:** https://claude.ai/artifact/TQtJuvnn6WBXJXYuWNiKqE
- **Model selection and sources:** [docs/model-selection-2026-09.md](../model-selection-2026-09.md)
- **The three answers side by side:** `data/eval/private/deepseek-vs-gemini-answers.md` (gitignored, real conversations)

## Proposed outcome
- Answers and research run on DeepSeek V4.1 Flash in production. The cost of those two steps falls to roughly a sixth.
- Consultants see no drop in answer quality or reliability.
- If DeepSeek or OpenRouter fails before an answer starts, the consultant still gets a Gemini answer.
- Going back to Gemini is a configuration change, not a code change.

## Affected users and systems
- **Users:** Expert Education consultants and staff using Edge (the chat frontend).
- **Services:** the expert-ai-consultant API (answer and research steps), OpenRouter and the hosts it routes DeepSeek to, the Gemini API (fallback), the activity log (`chat_turns`) and Langfuse traces.
- **Configuration and secrets:** production config and secrets (Kubernetes, via the gitops repo).
- **Decision owner:** Aashish.

## Scope
- **Endpoints:** `/v1/chat` and `/v1/chat/stream`.
- **Steps:** the answer step and the research (tool-calling) step.
- **Environments:** production and any environment where the model setting is changed.

## User stories
1. As a consultant, I want my answers written by DeepSeek V4.1 Flash, so the business spends less per turn without the answers getting worse.
2. As a consultant, I want the research step (knowledge base, programs, web, CRM lookups) run by DeepSeek V4.1 Flash, so the research phase costs less.
3. As a consultant, I want to still get an answer when DeepSeek or OpenRouter is down, so an outage does not stop my work.
4. As the owner of Edge, I want to switch either step back to Gemini with a configuration change, so a quality or cost problem can be undone quickly.
5. As the owner of Edge, I want each turn's record to show which model answered and researched and what it used, so cost and quality can be followed after the switch.

## Acceptance criteria

**Story 1: answers**
1. Given the answer-model setting names DeepSeek V4.1 Flash, when a consultant sends a message on `/v1/chat` that reaches the answer step, then the reply is written by DeepSeek V4.1 Flash, and the turn's `chat_turns` record names it as the answer model.
2. Given the same setting, when the message is sent on `/v1/chat/stream`, then answer tokens reach the client as a stream (more than one token event before `done`), and the `done` payload carries the full answer.
3. Given the same setting and a turn with gathered evidence, when the answer is returned on either endpoint, then its sources list is built from the answer's citations exactly as it is for Gemini answers today.

**Story 2: research**
4. Given the research-model setting names DeepSeek V4.1 Flash, when a message needs research on either endpoint, then every research tool-selection call is made by DeepSeek V4.1 Flash, and the turn's `chat_turns` record names it as the research model.
5. Given the same setting and a consultant with a CRM account, when they ask about their own caseload on either endpoint, then the CRM tool calls DeepSeek chooses run with that consultant's own CRM permissions, as they do today.
6. Given the same setting, when DeepSeek names a tool that does not exist or sends arguments the tool rejects, then the turn still completes with an answer on either endpoint, as it does for Gemini today.

**Story 3: fallback**
7. Given DeepSeek or OpenRouter returns an error or times out before any answer text has been sent, when the answer step runs on either endpoint, then the consultant receives an answer written by Gemini 3.5 Flash-Lite, and the turn's record shows that the fallback was used.
8. Given DeepSeek fails after answer text has already streamed on `/v1/chat/stream`, when the answer step ends, then no Gemini text is appended; the partial answer stands, as the current rule for Gemini does.
9. Given the research-model call to DeepSeek fails on either endpoint, when the research step ends, then the turn still produces an answer from the evidence gathered so far.

**Story 4: switching**
10. Given both settings are changed back to Gemini 3.6 Flash and the service is restarted, when a consultant sends a message on either endpoint, then answers and research are produced by Gemini 3.6 Flash with no code change.
11. Given a setting names DeepSeek V4.1 Flash but no OpenRouter key is configured, when the service starts in any environment, then it refuses to start with an error that names the missing key.

**Story 5: records**
12. Given a turn answered or researched by DeepSeek on either endpoint, when its `chat_turns` record is written, then the record holds the model name and the input and output token counts of each DeepSeek call, as it does for Gemini calls.
13. Given the same turn, when its Langfuse trace is viewed, then the answer and research generations show DeepSeek V4.1 Flash as the model.

## Edge cases
- **Answer cut off (AC 1, 2).** DeepSeek reasons before it writes, and those tokens count against its output limit. With the current limit the answer could be cut off. Source: the benchmark.
- **Slow first reply (AC 2, 7).** DeepSeek took about 10 s to its first answer token, against 6 s for Gemini; the slowest measured answer was 17 s, inside the 45 s answer budget. An answer that exceeds the budget with nothing sent falls under AC 7. Source: the benchmark.
- **Host switch (AC 1, 4, 12).** OpenRouter can serve DeepSeek from different hosts at different prices and precisions. If the pinned host is down, it may use DeepSeek's own endpoint at about $0.30/$1.20 per million tokens, against $0.14/$0.42. Source: the benchmark and OpenRouter's endpoint data.
- **Thinking panel (AC 2).** Gemini's thought summaries feed the "what Edge is working through" panel. DeepSeek's reasoning arrives in a different form, so the panel may stay empty. See open question 3. Source: code (`src/graph/nodes.ts`).
- **Refused turns (AC 1).** Prompt-injection refusals are a template and never reach the answer step, so they are unaffected. Source: code.
- **Classifier fallback (AC 4).** When the classifier falls back to a default intent, the turn still goes to research, which then uses DeepSeek. Source: code.

## Constraints
- The answer step keeps its current 45 s budget and the research step its 25 s budget.
- The answer rules stay as they are: inline [n] citations, "Not in the knowledge base:", no invented figures, a MARN note where needed. Only the model changes.
- The Gemini fallback model is Gemini 3.5 Flash-Lite, as agreed.
- Budget: at about 300 turns a month the change saves around $4–5 a month. The reason to do it is cost at future volume, not today's bill.

## Out of scope
- **The intent classifier.** It stays on Gemini 3.5 Flash-Lite. Moving it to Jev is separate work (branch `feat/intent-tool-scoping`).
- **Web search, PDF parsing, program extraction and embeddings.** These stay on Gemini.
- **The larger 60-question answer and research benchmark.** It is a follow-up to confirm the switch; see open question 4.
- **Changes to the prompts, playbooks or answer rules.**

## Dependencies
- An OpenRouter API key in the production secrets (Kubernetes, through the gitops repo). Owner: Aashish.
- The OpenRouter model support built for the benchmark on branch `feat/model-eval`. It is not merged.
- Branch `feat/intent-tool-scoping` also adds `OPENROUTER_API_KEY` to the environment settings. The two branches need a coordinated merge.

## Open questions
1. **Data protection. Blocks go-live, not the build.** Owner: Aashish.
   - May prompts that contain student data (CRM records, student names, pasted emails) be sent to OpenRouter and the hosts serving DeepSeek?
   - Should routing exclude DeepSeek's own endpoint, which is operated in China, and use only hosts such as DeepInfra?
2. **Research fallback. Does not block.** Owner: Aashish. When DeepSeek fails during research, should that round be retried on Gemini 3.6 Flash, or should the turn continue with the evidence gathered so far, as happens today?
3. **Thinking panel. Does not block.** Owner: Aashish. Should DeepSeek's reasoning appear in the "what Edge is working through" panel, or may the panel stay empty while DeepSeek answers?
   - **Decided 2026-09-28 (Aashish): show it, deepseek.com style, and store it.** OpenRouter sends DeepSeek's raw reasoning as `reasoning` (not `reasoning_content`, the only name `@langchain/openai` reads), so `OpenRouterChatModel` keeps it. The research rounds' reasoning streams too, in order with their lookups, and the turn's timeline is stored as `metadata.thoughts` (`{ at, text }`, `at` = lookups before it). A **DeepThink** toggle (`deepThink: true`) answers at `reasoning.effort` `DEEP_THINK_EFFORT` (default high) with 16k tokens of headroom and a 60 s answer budget. DeepInfra lists `reasoning` and `reasoning_effort` as supported, so `require_parameters` still routes. Measured: reasoning reaches the client at about 1.5 s instead of nothing until the first answer token at 9 to 16 s.
4. **Validation before go-live. Does not block the build.** Owner: Aashish. Should the 60-question benchmark with consultant-checked reference answers run before production traffic moves to DeepSeek, or after it, while watching live turns?
