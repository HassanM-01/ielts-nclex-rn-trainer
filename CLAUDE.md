# CLAUDE.md

Standing instructions for Claude Code in this repo. Read this file, then PROGRESS.md, at the start of every session.

## What this is

A voice-driven IELTS Speaking trainer (plus an NCLEX-aligned Clinical mode) for Julio, a Mexican nurse preparing for IELTS Academic (target 7.0 Speaking) and the NCLEX-RN. The owner is Hassan. Julio is not technical and uses the app in Spanish; exam content is in English.

- **SPEC.md** is the source of truth for what to build and how. Follow it exactly.
- **PROGRESS.md** is the shared memory between sessions. Keep it current.
- **HUMAN_GUIDE.md** is Hassan's checklist. You may point him to a section of it, but don't edit it unless he asks.

## Start of every session

1. Read PROGRESS.md: current step, last checkpoint result, open questions, decisions.
2. Read the SPEC.md sections for the current step (and anything they reference).
3. Tell Hassan in 3 to 5 lines: where things stand, what you'll do this session, and anything you need from him first (keys, a test result, a decision).
4. Wait for his go-ahead if this is the start of a new build step. Continue without asking if you're mid-step.

## How to work

- **One build step at a time** (SPEC.md section 17). Plan the step, build it, test what you can, then stop at its checkpoint. Don't start the next step until Hassan reports the checkpoint result.
- **Don't change the stack, scope or numbers in SPEC.md on your own.** If something in the spec is wrong, impossible or clearly worse than an alternative, explain it briefly, propose the change, and wait. When Hassan agrees, record it in PROGRESS.md under Decisions (and update SPEC.md if he asks).
- **Ask, don't guess, on anything Hassan must provide:** API keys, account setup, passphrase, domain, test results.
- **Don't swap model IDs from memory.** Models come from `EXAMINER_MODEL` and `GRADE_MODEL` env vars; the values in .env.example are the intended ones.
- **Keep diffs focused.** No drive-by refactors of finished steps unless a bug requires it.

## Non-negotiables (the reasons are in SPEC.md)

- Performance budget in SPEC.md section 3 is a requirement, not a goal. Measure it; log it to `sessions.metrics`; show it in the Shift+D overlay.
- No model calls for Part 1, Part 2, transitions or Clinical turns. Model calls only for Part 3 turns, "Reintentar" comparisons, grading and bank building.
- No database calls inside the turn loop.
- Every model call has a deadline and a scripted fallback. The exam never stalls.
- The recognizer stays on for the whole session; never lose recognized text across restarts. Never call `SpeechRecognition.install()`.
- The Anthropic key and the Supabase secret key exist only in server functions. The browser bundle contains neither, and no Supabase client.
- Full tests always run at Nivel 3 conditions; grading rules are identical at every level.
- Julio never sees an English error message, a stack trace or a dead end. Every failure has a Spanish message and a way forward (push-to-talk, retry, resume).

## Code conventions

- TypeScript, strict mode. React function components. Tailwind for styling.
- All user-facing Spanish text lives in `/src/i18n` with correct accents. No hardcoded UI strings in components.
- Exam and level definitions live in `/src/exams` and `/src/levels` as data plus small pure functions, so they can be unit tested.
- Server functions in `/api` are thin: validate input, check the token, call the model or database, stream the result.
- Create the Anthropic client at module scope in each function file.

## Commands

Set these up in step 1 and keep them working:

- `npm run dev`: local app with the `/api` functions (via `vercel dev` once the project is linked; plain `vite` before that).
- `npm run typecheck`
- `npm test` (Vitest)
- `npm run build`
- `npm run bank:build` and `npm run bank:validate` (from step 4)

Before saying a step is done: `npm run typecheck`, `npm test` and `npm run build` all pass.

## Testing

- Unit test the logic that doesn't need a microphone: endpointing rules, repeat-request matching (including "Sorry, I don't really like shoes" as an answer), echo trim, level rules and placement, question selection weights and repeat filtering, session token signing and expiry, overall-band rounding, grade schema validation.
- Speech and audio can't be tested automatically. That is what the `/lab` page and Hassan's checkpoints are for. Make the lab page show every number he needs to report.
- Never call the real Claude API from unit tests. Mock it.

## Secrets and cost

- Never commit `.env`, `.env.local` or any key. `.env.example` lists names only.
- `bank:build` prints an estimated token count and cost before running and asks for confirmation. It writes results incrementally, so a failure doesn't waste completed work.
- Respect the client guard (one examiner request in flight, 40 per session) and the grading-time cap check.

## Git

- Commit at the end of every working sub-step with a clear message ("step 1: recognizer restart logic").
- Push to GitHub only when Hassan asks, or once step 6 has set up deploys and he's confirmed pushing to main is okay.

## End of every session (always, even if interrupted work is incomplete)

Update PROGRESS.md:
1. Step status table.
2. "Last session" summary: what was built, what's untested, anything half-done.
3. If a checkpoint is reached: fill in "Checkpoint for Hassan" with exactly what to test, the commands or URLs, what good looks like, and what to report back. Point to the matching section of HUMAN_GUIDE.md.
4. New decisions, open questions, known issues, and cost spent (bank builds, test runs).

Then tell Hassan in plain language what he needs to do next.
