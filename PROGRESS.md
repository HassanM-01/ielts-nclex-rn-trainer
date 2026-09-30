# PROGRESS.md

Shared memory between Claude Code sessions. Claude Code updates this at the end of every session. Hassan fills in checkpoint results (or pastes them in chat and Claude Code records them).

## Current status

- **Current step:** 6 (Supabase persistence, History, Vocab, keepalive cron, deploy)
- **State:** deployed to production (2026-09-30), at https://ielts-nclex-rn-trainer.vercel.app. Claude's smoke tests passed; waiting for Hassan's Stage 6c checks.
- **Waiting on:** Hassan's HUMAN_GUIDE 6c checks on the production URL (see "Checkpoint for Hassan").
- **Pushing:** Hassan approved pushing to main on 2026-09-30. Every push to GitHub `main` deploys to production. Keep running typecheck, tests, build and the bundle scan before each push.

## Step 6 plan (approved by Hassan 2026-09-30; built, see "Last session" and Decisions for how)

- **Migrations** (`supabase/migrations/0001_init.sql`), per SPEC 12:
  - The tables `profile`, `sessions`, `vocab`, `case_flags`, `usage` and `heartbeat`, with explicit GRANTs for `service_role` (SPEC 4). RLS is on, with no public policies.
  - Two RPCs:
    - `session_start_info()`: today's count, the last 5 sessions' Part 1 topic ids, the last 10 sessions' card ids, the profile row, and up to 30 saved words due for review.
    - `grade_admit(cap)`: an atomic increment-and-check.
    - Also built: `save_session(s)` (the upsert plus profile and vocab updates, one round trip) and `keepalive()`.
  - Hassan runs the SQL (Stage 6b).
- **Server** (`api/_lib/db.ts`): plain `fetch` to Supabase's REST/RPC endpoints with `SUPABASE_SECRET_KEY`, and a short timeout. No `supabase-js`, so cold starts stay light and nothing can leak into the browser bundle.
  - `/api/session-start`: the one RPC. It refuses at `DAILY_SESSION_CAP`, applies the repeat filter, and returns the level and saved words. If Supabase fails, it keeps today's behaviour.
  - `/api/grade`: `grade_admit` before the model call. Past the cap, it refuses with a Spanish message on the results screen.
  - `/api/sessions` (passphrase header): upsert by the client uuid, carrying the transcript, the metrics snapshot, the grade, the overall and `pause_p90`. The profile's `pause_p90` is updated, and `saved_words_used` counts toward mastery. The browser retries with backoff and keeps the finished checkpoint in localStorage until the save succeeds. Saving never blocks the results screen.
  - `/api/history`: the list, plus one session in full.
  - `/api/vocab`: list, save and the mastered toggle. Words saved in localStorage in step 5 are moved over once.
  - `/api/keepalive`: a Vercel Cron job, daily, checking `CRON_SECRET`, that updates the heartbeat.
- **Browser:**
  - A lazy History route. A small hand-drawn SVG line chart shows the overall and each criterion, with a 7.0 target line, from full tests only. Practice sessions appear as dots marked with their level. Tapping a session reopens its transcript and feedback.
  - A lazy Vocab route with exam tags and the mastered toggle.
  - Home shows up to 10 words due for review, and links to History and Vocab.
  - `personalBaseMs()` is applied from the profile's `pause_p90`.
- **Deploy:**
  - SPA rewrites (`/lab`, `/examen`, `/resultados`, `/transcripcion`, `/historial`, `/vocabulario`).
  - The passphrase gate: without a working passphrase, only the Spanish passphrase card shows.
  - The cron entry in `vercel.json`.
  - A check that no function answers without the token or passphrase.
  - Then the first push to GitHub, only once Hassan says so. After deploy, re-measure Part 3 AI and voice latency on the deployed site.
- **Tests:** the SQL-backed code with `fetch` mocked (cap refusal, repeat filter input, fallback when Supabase is down, upsert retries, keepalive auth, History chart data from full tests only). No real database or API in tests.
- **Checkpoint** = HUMAN_GUIDE Stage 6c.

## Deferred to later steps (don't forget)

Step 6 (Supabase, History, Vocab, deploy):
- [x] `/api/session-start`: the one RPC (today's count, recent topic ids, profile row); refuse a token at `DAILY_SESSION_CAP`; pass `recent` (last 5 sessions' Part 1 ids, last 10 sessions' card ids) to `selectItems`; return the level and up to 30 saved words due. On Supabase failure keep today's behaviour (token plus questions, no cap, no filter).
- [x] `/api/grade`: one atomic increment-and-check against the daily cap before calling the model.
- [x] Vocab: move words saved in localStorage (step 5 "Guardar") into the `vocab` table, then read and write through `/api/vocab`.
- [x] Profile: store `pause_p90` after each session and apply `personalBaseMs()` (already written and tested in `src/session/endpointing.ts`) to the next session's endpointing.
- [x] Save sessions (upsert by client uuid) with transcript, metrics snapshot and grade; keep the finished checkpoint in localStorage until the save succeeds.
- [x] Deploy (pushed 2026-09-30; production smoke-tested; the latency re-measure waits for Hassan's 6c report): SPA rewrite to `index.html` for `/lab`, `/examen`, `/resultados` and `/transcripcion` (now an alias of `/resultados`); the passphrase gate; keepalive cron; `.vercelignore` already excludes `/api` tests. Then re-measure Part 3 AI latency on the deployed iad1 function (open question below).
- [x] Grading: save the grade with the session (today it's in localStorage `exam.grade.v1`, last session only); send up to 30 saved words due for review in `savedWords` (the field and prompt line exist, always empty now); count `saved_words_used` toward mastery (3 correct uses).

Step 7 (levels, Ayuda, quick practice):
- [ ] Level from `profile` (placement from the first full test) instead of `DEFAULT_LEVEL`; the move-up / move-down suggestions. `/api/session-start` already returns `profile.level` (`sessionInfo()` in the browser), and nothing uses it yet. Placement needs a way to write `profile.level` / `placement_done` (no route for that yet).
- [ ] Settings: the optional IELTS test date (`profile.ielts_test_date`; session-start already uses it for the season), voice and accent, the manual level override.
- [ ] Send the card's `useful_words` and `help` (already in the bank, not yet in `IeltsItems`) to the browser for the cue card and the Ayuda panel; log Ayuda use per question and pass it to the grader.
- [ ] "Práctica rápida" mode (one card plus the first 2 questions of its Part 3 set) in the mode selector and `buildIeltsScript`.

## Step status

| Step | What | Status | Checkpoint result |
|---|---|---|---|
| 0 | Hassan's setup: repo, tools (HUMAN_GUIDE stage 0) | done | |
| 1 | Speech layer and `/lab` page | done | 2026-09-23: all tests passed on Edge and Chrome. The mic-selection problem was fixed, and the retest passed ("everything worked as expected"). |
| 2 | Engine: scripted opening, Part 1, Part 2; endpointing; voice commands | done | 2026-09-23: first run passed except "Sorry?" and the 40 s cut-off (headphone leak). A fix then broke pacing (VAD noise floor). Final retest: everything passed. Commit → examiner audio 125 / 449 ms (p50 / p95), 0 stalls, 0 barge-ins. |
| 3 | Part 3 examiner endpoint, speculative prefetch, fallback | done | 2026-09-24: Part 3 and follow-ups worked; problems with the Part 2 early finish and Wi-Fi recovery. 2026-09-25 retest: both passed. Commit → audio: scripted 250 / 710 ms, Part 3 AI 214 / 823 ms (n = 2). |
| 4 | Bank build and validation scripts, seasonal selection, `/api/session-start` | done | 2026-09-25: bank reviewed. Health Part 3 repetition, Spanish gender forms and a city name were fixed. Hassan: "everything worked, step 4 is a pass" (validation, modes, varied questions). |
| 5 | Grading (streamed, structured) and results screen | done | 2026-09-27 Test A (Hassan as himself): FC 7, LR 8, GR 7, overall 7.0: too low (bar 7.5). Prompt recalibrated; regrade FC 8, LR 8, GR 8, overall 8.0 (pass): first band 18.8 s after the request, 40 s total, 10.5k input / 3.8k output tokens. 2026-09-30 Test B (Hassan as a B1 speaker): FC 4, LR 4, GR 4, overall 4.0 (expected 4.5 to 5.5; the "off" line is above 6). 2026-09-30: Hassan confirmed the other checks (Reintentar, Guardar, Part 2 replay, partial practice) and called step 5 a pass. Test B first band 27.1 s after the request (exam end → first band 22.1 s), 45.6 s total. |
| 6 | Supabase persistence, History, Vocab, keepalive cron, deploy | built (deployed 2026-09-30; awaiting Hassan's 6c checks) | |
| 7 | Levels, "Ayuda", quick practice | pending | |
| 8 | Clinical mode | pending | |

Status values: pending, in progress, built (awaiting checkpoint), done, blocked.

## Hassan's setup checklist

| Item | Needed by | Done |
|---|---|---|
| GitHub repo created and cloned; SPEC.md, CLAUDE.md, PROGRESS.md, HUMAN_GUIDE.md, .env.example in root | step 1 | yes |
| Node.js LTS, Git, Claude Code installed; Edge and Chrome installed; headphones | step 1 | yes (Node 24.21) |
| Vercel account, CLI installed and logged in, project linked | step 3 | yes (2026-09-23; GitHub connected, so pushes deploy) |
| Anthropic API key created, monthly spend limit set, key added to Vercel env vars | step 3 | yes (2026-09-23; EXAMINER_MODEL and GRADE_MODEL set too; `.env.local` pulled) |
| APP_PASSPHRASE and SESSION_SECRET chosen and added to Vercel env vars | step 4 | yes (2026-09-24, pulled to .env.local) |
| Supabase project created (East US), secret key and URL added to Vercel env vars | step 6 | |
| Migrations run in Supabase | step 6 | |
| CRON_SECRET added; cron job visible in Vercel | step 6 | |
| Julio has the link and passphrase | after step 6 | |

## Last session

**2026-09-30 (fifth part): first deploy (Stage 6c, Claude's side).** Hassan said to push.

Before the push (all passed):
- typecheck, 378 tests, build;
- the bundle scan;
- `bank:validate`;
- 7 functions (the Hobby limit is 12);
- only `.env.example` tracked;
- `main` 44 commits ahead of `origin/main` and 0 behind (a fast-forward).

What went right:
- **Push and build:** pushed `fca2ba5..7d8fcf7`. Vercel built it in 20 s and aliased it to https://ielts-nclex-rn-trainer.vercel.app. All functions run in iad1.
- **Pages:** all SPA routes return the app (200): `/`, `/examen`, `/resultados`, `/transcripcion`, `/lab`, `/historial`, `/historial/<uuid>`, `/vocabulario`. Unknown paths return 404.
- **Auth:** every API refuses without credentials (401).
  - `session-start` with a wrong passphrase;
  - `examiner` and `grade` without a token;
  - `history`, `vocab` and `sessions` with a wrong passphrase;
  - `keepalive` with a wrong bearer.
- **Nothing extra deployed:** test files and `api/_lib` aren't routed (404).
- **Bundle:** both production JS bundles have 0 hits for keys, secret names, `@anthropic-ai` or `supabase-js`.
- **Cron:** registered (`vercel crons ls`: `/api/keepalive`, `0 12 * * *`). Triggered once with `vercel crons run`: the heartbeat moved from 19:16:23 to 19:23:30 UTC. That proves production has the right `CRON_SECRET`, `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, and that the grants work from iad1.
- **Logs:** no errors in the production runtime logs (only the smoke tests and the cron run).

What went wrong or needed a workaround (none of it affects the app):
- The Vercel MCP connector in these sessions can't see this project (`Project not found`, and an empty project search), so everything was done with the logged-in Vercel CLI: `vercel env ls`, `inspect`, `crons ls` / `run`, and `logs`.
- Git Bash turned `/api/keepalive` into `C:/Program Files/Git/api/keepalive` for `vercel crons run`. Prefixing the command with `MSYS_NO_PATHCONV=1` fixed it.
- `tsx -e` with top-level await fails (CommonJS); a `.mts` scratch file works (already a known gotcha).

Not verified by Claude (it needs the passphrase and a real mic; these are Hassan's 6c checks):
- a real graded session saved from production;
- History and Vocab against real rows;
- the phone view;
- the next day's automatic cron run;
- deployed latency (the Part 3 AI and voice-start open questions).

**2026-09-30 (fourth part): Stage 6b done and verified.**
- Hassan ran `0001_init.sql` in the Supabase SQL Editor ("Success. No rows returned").
- Read-only check with the secret key (nothing written, no values printed):
  - `session_start_info()` returns `{today: 0, profile: {id 1, level 2, pause_p90 null, placement_done false}, due_words: [], last_full: null, recent_part1/2: []}`.
  - The `profile` and `heartbeat` seed rows exist; `usage`, `sessions`, `vocab` and `case_flags` are empty.
  - The API exposes exactly the 6 tables and the 5 functions (`grade_admit`, `julio_today`, `keepalive`, `save_session`, `session_start_info`).
- `vercel env ls` (names only): all 9 variables the functions use are set for Production: `ANTHROPIC_API_KEY`, `EXAMINER_MODEL`, `GRADE_MODEL`, `APP_PASSPHRASE`, `SESSION_SECRET`, `DAILY_SESSION_CAP`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `CRON_SECRET`.
  - The Vercel MCP connector in this session can't see this project (it's likely scoped to others), so the CLI was used.
- Pre-push check: only `.env.example` is tracked, there are no key patterns in the tracked files, and `.gitignore` covers `.env*` and `.vercel`. There are 43 local commits not yet pushed.

**2026-09-30 (third part): step 6 built locally.**
- `npm run typecheck`, `npm test` (378 tests, up from 339) and `npm run build` pass. The bundle contains no SDK, zod, Supabase or secret names (checked).
- Hassan approved the plan and asked that every change be written down for future sessions; they're all under Decisions (2026-09-30, step 6).

Built:
- **Database:** `supabase/migrations/0001_init.sql` (not run yet; Stage 6b).
  - The six SPEC 12 tables, with RLS on, no policies, and explicit grants to `service_role`.
  - Functions: `julio_today()`, `session_start_info()`, `grade_admit(cap)`, `save_session(s jsonb)` and `keepalive()`, executable only by `service_role`.
  - It can be run again safely ("if not exists" / "or replace").
- **Server:**
  - `api/_lib/db.ts`: plain `fetch` to Supabase REST, secret key on the `apikey` header only (per Supabase's API-keys docs), with timeouts.
  - `api/_lib/auth.ts`: the passphrase header `x-app-passphrase`, and `dailyCap()`.
  - `api/_lib/persistence.ts`: validation and row mapping.
  - `/api/session-start`: one RPC (1.5 s timeout), refuses at the cap (429 `daily-cap`), applies the repeat filter, and returns `profile`, `dueWords` and `lastFull`. If Supabase fails, it returns a token and questions with no cap and no filter (tested).
  - `/api/grade`: `grade_admit` before the model call (429 past the cap). If the database fails, it grades anyway.
  - New routes: `/api/sessions` (POST, upsert), `/api/history` (GET the list, or one session with `?id=`), `/api/vocab` (GET; POST `save` or `mastered`) and `/api/keepalive` (GET, `Authorization: Bearer CRON_SECRET`).
- **Browser:**
  - `src/persistence/api.ts`: the passphrase-header client.
  - `src/persistence/save-client.ts`: the save queue in localStorage `sessions.pending.v1`, with backoff and retries.
  - Vocab "Guardar": saved locally, then synced to `/api/vocab`; step 5's localStorage words are sent on the next sync.
  - The exam session saves at the end, and again with the grade. Saved words due for review go to the grader and are counted toward mastery.
  - The personal pause calibration is applied from the profile.
  - The metrics store resets at each new exam.
  - Home: the passphrase gate, the daily-cap message (Start disabled), the last full-test band and distance to 7.0, up to 10 due words, and links to History and Vocab.
  - History (`/historial`, `/historial/<id>`): a hand-drawn SVG chart, the session list, and a detail view with the full grade and transcript (`GradeReport` is shared with the results screen).
  - Vocab (`/vocabulario`): tags, "Usada bien n de 3 veces", and the mastered toggle.
- **Deploy config:** `vercel.json` has explicit SPA rewrites and a daily cron (`/api/keepalive`, 12:00 UTC).

Checked:
- **Supabase credentials** (read-only probe, no values printed): the URL and `sb_secret_` key are accepted. The RPC and tables don't exist yet (PGRST202/205), as expected before Stage 6b.
- **`vercel dev`:** all new functions load and route. A wrong passphrase gets 401 on history, vocab, sessions and keepalive (and grade without a token). `/historial`, `/historial/<uuid>` and `/vocabulario` serve the app. No server errors.
- **Claude's browser, with stubbed APIs:**
  - With no passphrase, Home shows only the passphrase card.
  - After sign-in: the last band 6.5 ("Te faltan 0.5"), the due words and the links.
  - At the cap: the Spanish message, with Start disabled.
  - History: the chart (full tests as lines, a practice session as an "N2" dot, the dashed 7.0 line), the list, and the detail view.
  - Vocab: the list and the mastered toggle (POST).
  - No console errors.

Not tested yet:
- Anything against the real database (it needs Stage 6b).
- The deployed site: rewrites, cron and production env vars (Stage 6c, after Hassan says to push).
- `CRON_SECRET` is not in `.env.local`, but `vercel dev` does see it: keepalive answered 401, not "not configured". So it is set in Vercel.

**2026-09-30 (second part): step 5 done.**
- Hassan confirmed all remaining Stage 5 checks: "Reintentar", "Guardar" after a reload, the Part 2 replay, and a partial practice labelled "Muestra parcial".
- He called step 5 a pass and agreed to keep the natural voice (open question below).
- Test B timing: first band 27.1 s after the request, 45.6 s total, 9,032 input / 4,102 output tokens (about US$0.12). "Exam end → first band ready": 22.1 s, within 30 s. "Exam end → local stats on screen": 16 ms after the fix (the 334 ms sample was from before it).
- His metrics weren't reset between the tests, so the latency rows mix Test A and Test B. Two points from Test B:
  - 6 recognizer `network` errors. None of them switched to push-to-talk, and no text was lost.
  - One examiner timeout (13:25:19, fell back to the scripted question). That is probably the "Part 3 AI" p95 of 1,514 ms: the 1.2 s reply deadline plus the voice start, as predicted in the open question. It gets re-measured after deploy.
- The step 6 plan is written above and waiting for the go-ahead.

**2026-09-30: Test B result.**
- Hassan as a B1 speaker scored FC 4, LR 4, GR 4, overall 4.0. His stats: 1:52 speaking in total, 94 wpm, 11 pauses over 2 s, a Part 2 of 57 s, and many one-word Part 3 answers ("No.").
- That is half a band below HUMAN_GUIDE's expected 4.5 to 5.5. It is inside SPEC 7's B1 range (band 4.0 to 5.0), and far from the "off" line (above 6).
- The evidence is real and the advice is specific: it cites the 57 s long turn, "I enjoy help the people" and the repetition of "relax" / "safe".
- Grammar 4 versus 5 is the only close call. It follows "when torn, choose the lower band" (SPEC 11), so the prompt was not changed.
- Spread between the tests: 8.0 versus 4.0.
- Hassan viewed the page through Edge's automatic translation (English labels such as "Esteemed band"). That is not an app bug.

**2026-09-27 (second part): Test A regrade passes.**
- With the recalibrated prompt, Test A's regrade scored FC 8, LR 8, GR 8, overall 8.0.
- The evidence no longer counts the recogniser's errors, and the advice is specific and in Spanish.
- Timing: first band 18.8 s after the request, all 40.1 s. The first run's "exam end → first band" was 16.0 s. That number was already recorded before the fix; the earlier report showing n = 0 was copied before grading had finished.
- Cost: 10,515 input and 3,849 output tokens, about US$0.12 per grade.
- Fix: the model put its own quotation marks inside evidence items (shown as “"…"”), once used a measurement as an evidence item, and joined quotes with "/". The prompt now asks for one quote per item without quotation marks, and `normalizeGrade` strips any wrapping quotes (tested).
- Not an issue, but worth knowing: the upgraded answers are written at band 7 because feedback targets Nivel 2 (SPEC 7). For a band 8 speaker like Hassan that is below his level; for Julio it's the intended "one step up".

**2026-09-27: step 5 Test A result and calibration fixes.**

Hassan's Test A (himself, Edge 154, Yeti, Ava Multilingual Online Natural): FC 7, LR 8, GR 7, overall 7.0. A native speaker should score about 8+, so the grading is off by the Stage 5 rule. The evidence shows why:
1. **It counted recogniser errors as grammar errors.** "This facial expressions" was quoted under grammar even though the grader itself flagged it as "His facial expressions" under pronunciation. It also quoted "you you" and a stray full stop ("So. We were brought up."). Edge adds punctuation; the prompt said there was none.
2. **It treated a few one-off slips as systematic.** "costed" and "remember of" appeared in roughly 1,100 words of complex speech. Band 8 allows "a few basic errors may persist"; band 9 allows native-speaker "mistakes".
3. **It penalised "you know" / "right?" as filler and called short Part 1 answers underdeveloped.** Band 7 lists discourse markers as a strength, and Part 1 expects 1 to 3 sentences.

Prompt changes (`api/prompts/grade-ielts.md`; SPEC rules unchanged, including "when torn, choose the lower band"):
- Punctuation is the recogniser's.
- Check whether the recogniser could have produced an error before quoting it; anything flagged under pronunciation can't also count against grammar or vocabulary.
- Weigh errors against the amount of speech, and separate systematic errors from one-off slips (per the band 8 and 9 descriptors).
- Discourse markers only count against him when they replace content or fill silence.
- Complete Part 1 answers of 1 to 3 sentences are not a weakness.
- Julio's real problems (the same tense, agreement or article errors again and again) still count fully, so Test B should stay low. That's what Test B checks.

Measurement fixes:
- **"Exam end → first band" had n = 0 in his report**, and there was no `grade-done` event. Both were recorded by the results screen's render effects, which don't run while the tab is in the background (or they missed their moment). They're now recorded by the grading job itself (`watchGradeJob` in `exam-session.ts`). The row is renamed "Exam end → first band ready". `grade-done` now logs the time to first band, the total time, and the tokens billed (the server sends `usage` in the `done` event).
- **"Exam end → local stats on screen" was 334 ms** (limit 200). React holds a lazy route's content for about 300 ms after its fallback shows, even when the chunk is already loaded. Once prefetched, the results screen now renders directly: 5 ms from navigation in Claude's browser.
- **New dev-only "Volver a calificar" button** (only under `npm run dev`) rescores the last exam's saved transcript with the current prompt, so calibration doesn't need a new 13-minute test each time.

Typecheck, 338 tests and the build pass; the bundle is clean.

**2026-09-26: step 5 built.** `npm run typecheck` (app, `/api`, scripts), `npm test` (338 tests, up from 282) and `npm run build` all pass. The browser bundle contains no SDK, zod or secret names (checked). No model was called: every test mocks the SDK, and the browser checks used a stubbed stream.

Built:
- **Server:**
  - `api/grade.ts` checks the token and streams `GRADE_MODEL` with structured outputs (`zodOutputFormat`, SPEC 11 schema in stream order, `effort: "medium"`, `max_tokens` 32k). The browser receives newline-delimited JSON events: `delta`, `reset`, `done` and `error`.
  - One retry, only on `max_tokens`, a refusal, a network error or JSON that fails the schema; the browser is told to `reset`. Each attempt is capped at 140 s. `vercel.json` gives the function `maxDuration: 300` and the prompts.
  - `api/_lib/grade-prompt.ts` holds the input validation, the zod schema and the user message: session facts, then the transcript by part and question, each answer with its metrics line and outcome note.
  - `api/prompts/grade-ielts.md` holds the grading rules, and the verbatim descriptors are appended after it.
  - `/api/examiner` has a new `kind: "compare"` (Haiku, `max_tokens` 300, prompt `api/prompts/compare.md`): two lines of Spanish comparing the two attempts.
- **Shared contract:** `src/shared/grade.ts` has the types, `normalizeGrade` (whole bands 0 to 9, rounded down; enums case-insensitive; at most 3 fixes and 2 upgraded answers) and `overallBand` (mean of 3, rounded DOWN to 0.5).
- **Engine:**
  - Each committed answer now has `metrics`: speaking time (first to last recognised word), words, pauses over 1 s and over 2 s (VAD pauses in its turns), and time to first word (reset after a "Sorry?").
  - New hooks: `onClosing` (grading starts as the closing line begins), `onFinish` (grading starts at the end if "Terminar" skipped the closing) and `onMonologue` (Part 2 recording).
  - The checkpoint gains `feedbackLevel` (Nivel 2 until placement).
- **Browser:**
  - `src/grading/` holds:
    - `grade-client.ts`: one job per session; a finished grade is kept in localStorage so a reload doesn't pay again.
    - `partial-json.ts`: the forgiving stream parser.
    - `grade-view.ts`: which sections can show.
    - `fluency.ts`: local stats.
    - `part2-audio.ts`: MediaRecorder on the VAD stream, in memory only.
    - `retry.ts`: "Reintentar" and the comparison call.
    - `vocab-store.ts`: "Guardar" to localStorage.
  - The results screen (`/resultados`, lazy, prefetched during the exam) replaces the transcript page, and `/transcripcion` is an alias. It shows, in order:
    - local stats;
    - the overall ("Banda estimada, sin pronunciación", distance to 7.0);
    - the three criteria as each closes in the stream;
    - fixes and focus;
    - the pronunciation flags;
    - two upgraded answers side by side with "Reintentar";
    - vocabulary with "Guardar";
    - Part 2 replay;
    - the transcript.
  - Failures show a Spanish message with "Intentar de nuevo". Too little speech (under 30 words) makes no model call and explains why.
  - New latency rows in the overlay and "Copy report": `Exam end → local stats on screen` (100 / 200 ms) and `Exam end → first band on screen` (30 / 90 s). There are also report events `grade-start`, `grade-done` and `grade-error`.

Checked in Claude's browser pane with the grade stream stubbed (no model):
- Stats matched the seeded metrics.
- Criteria rendered one by one while the others showed "Calificando…"; the overall was 5.5 from 6/6/5.
- "Guardar" persisted.
- A reload showed the saved grade and words with no new request.
- The no-passphrase error showed its Spanish message and retry.
- "Reintentar" with a fake recognizer endpointed the answer, released the mic and showed the comparison.
- No console errors.

Untested (Hassan's checkpoint):
- a real grade from `claude-opus-5-5` (calibration, time to first band);
- the real `claude-haiku-4-5` comparison;
- Part 2 replay with a real mic on Edge;
- the examiner's voice on "Reintentar" (the pane has no voices).

**2026-09-25 (fifth part): step 5 prep and handoff.** Hassan approved the step 5 plan (defaults for Guardar, level and cap; see "Step 5 plan"). He supplied the official IELTS Speaking band descriptors PDF; its text was extracted verbatim into `api/prompts/ielts-descriptors.md` (bands 9 to 0, four criteria each, plus the two notes), and the PDF was moved to the Windows Recycle Bin as he asked. The session ended here because the chat context was nearly full. The next session starts building step 5.

**2026-09-25 (fourth part): step 4 done.** Hassan's Stage 4c review passed. Step 5 is planned and waiting for the go-ahead.

**2026-09-25 (third part): bank review fixes.** Hassan asked for a sample (8 cards, 5 topics). Three problems turned up; he approved the fixes:
1. **The health cards' Part 3 sets were nearly identical:** 14 of 15 asked "Why do some people ignore health advice…?", all 15 asked about prevention vs treatment, and 13 about technology. The cause was the example questions in the build prompt. The 15 sets were rebuilt with `bank:build --health --part3-only`: the cue cards were kept, and each new set was told which questions the other health sets use. Each now has its own theme (priorities and quick decisions, teaching and learning, teamwork, communities in a crisis, trusting new discoveries…). Cue cards, Part 1 topics and the other sets are unchanged (checked).
2. **Spanish help phrases used feminine forms for the speaker** ("honesta", "convencida", "cuidadosa"). Julio is "he" in the spec, so 6 strings were patched to masculine forms.
3. **One help phrase named Guadalajara** (in English and Spanish). Now "In big cities…" / "En las ciudades grandes…".
- **Prevention for future builds:**
  - The prompt asks for masculine forms, no city names, and Part 3 questions tied to each card's own theme, with at most one question about the future.
  - `bank:validate` warns about any Part 3 question used in 3 or more sets (none now).
  - `bank:build` gained `--health` and `--part3-only`.

**2026-09-25 (second part): step 4 built.** `npm run typecheck` (app, `/api`, scripts), `npm test` (282 tests), `npm run build` and `npm run bank:validate` all pass. The browser bundle is clean.

Built:
- **Seeds** (`data/bank/ielts/seeds/`, titles only):
  - `evergreen.txt`: 3 opening and 30 classic Part 1 topics, 18 general cards, and 14 health cards with NCLEX areas.
  - `2026-09.txt`: the 6 SPEC Part 1 seeds plus 11 more, and the 14 SPEC Part 2 seeds plus 13 more (and one season health card). The additions are the season's reported "new topics" from readingielts.com (Part 1 and Part 2 pages, checked 2026-09-25). Titles only.
- **The bank** (`data/bank/ielts/evergreen.json`, `season-2026-09.json`), built with `claude-opus-5-5` using structured outputs:
  - 50 Part 1 topics (3 opening), each with an intro and 4 questions.
  - 60 cards (28 current season, 15 health covering all 8 NCLEX areas), each with 3 bullets, an explain line, 2 round-off questions, 5 useful words and 3 help phrases.
  - 60 linked Part 3 sets of 5 questions (at least 2 concrete and 2 abstract), each question with a rephrase, 2 follow-ups and 3 help phrases.
  - A 4-item sample was built and checked for quality first; the other 106 followed, with no failures.
- **Scripts** (run with `tsx`):
  - `npm run bank:build`: estimate, confirmation, per-item checks with one retry, incremental atomic writes, re-runs build only what's missing; options `--dry-run`, `--limit`, `--only`, `--yes`.
  - `npm run bank:validate`: SPEC 16 counts, links, the concrete/abstract mix, glosses, health tagging, and seeds not yet built.
  - `npm run bank:sample`: a readable review of random cards and topics.
  - Pure modules in `scripts/bank/` (seeds, plan, prompts, validate), all tested.
- **Selection** (`api/_lib/select.ts`, `season.ts`):
  - Part 1: an opening topic (Work 50%, Home 25%, Hometown 25%) plus 2 season topics.
  - Part 2: 60% season / 25% health / 15% general; when the season has ended, its share goes to general.
  - A test date picks its own season file.
  - A repeat filter is ready for step 6's history.
  - Tested, including the draw proportions over 2,000 runs.
- **`/api/session-start`** now returns `items` and `season` alongside the token (`items: null` if the bank is unavailable). The bank ships with the function (`vercel.json` `includeFiles`). Checked locally against the real bank: three calls gave three different, well-formed selections.
- **Browser:**
  - Home prewarms a token plus questions (`prepareSession`); `startNewExam` uses them once, or the fixed set offline.
  - Mode selector "Examen completo / Solo Parte 1 / Partes 2 y 3" (remembered).
  - The script builder supports the practice modes: Part 1 only; Parts 2 and 3 with a short greeting. Both end with a practice closing line and run at Nivel 2 (the default level until placement).

**2026-09-25: step 3 done.** Hassan's retest passed both fixes:
- **Part 2:** the back-up prompt fired on a real 4 s silence (diagnostic "words changed 4042 ms ago"), and the long turn moved on by itself 12 s later.
- **Wi-Fi off in Part 3:** push-to-talk at 11:25:12, retry on `online` at 11:25:16, recognition back at 11:25:21; both examiner calls made while offline fell back instantly.
- **Latency:** within budget (scripted 250 / 710 ms; Part 3 AI 214 / 823 ms, n = 2; 0 stalls).
- **Metric fix:** "voice end → final text" showed a 52 s p95. That was the Wi-Fi outage counted as recognizer lag, so the first-interim and final-lag metrics now ignore waits over 10 s.
- Step 4 is planned and waiting for the go-ahead.

**2026-09-24: step 3 checkpoint result and fixes.**

Hassan's result (Edge 153, Yeti, headphones, voice Ava Multilingual Natural, `npm run dev` on port 3000):
- **Worked:** Part 3 ran and "felt good".
  - Two model follow-ups, both on point: "Why does it depend on the neighbor?" and "You mentioned that some people enjoy feeling surrounded by lots of activity – can you give an example of what kind of activity appeals to them?"
  - 4 speculative requests: 3 reused, 1 aborted.
  - The first examiner call timed out and fell back correctly.
- **Problem 1:** in Part 2, finishing before 2:00 didn't move on. The back-up prompt came (15:33:50); he answered briefly and waited; nothing happened until the 2:00 hard stop (15:34:44). Two stall restarts happened in that window.
- **Problem 2:** after the Wi-Fi test the transcript stopped and only the error banner showed. Wi-Fi off caused 3 recognizer `network` errors, then the switch to push-to-talk (15:36:39). Nothing switched it back when Wi-Fi returned, and the engine then repeat-skipped q3-follow-up to q6 as "no answer".

Numbers:

| Metric (ms) | n | p50 | p95 | Budget |
|---|---|---|---|---|
| Commit → examiner audio (scripted) | 16 | 255 | 845 | 400 / 800, **p95 over** |
| Commit → examiner audio (Part 3 AI) | 3 | 1,060 | 1,814 | 700 / 1,200, **over** |
| Examiner request → reply (model) | 2 | 1,619 | 2,056 | |
| Click → examiner speaking | 1 | 917 | 917 | 500 / 1,000 |

Diagnosis and fixes (commit 162dd3b):
1. **Silence clock:** it counted from the last recognizer *event*. Edge sends events that repeat the same text, and every restart (monologue-pause, stall) finalizes pending text with another event, so the 6 s never completed. It now counts from the last time the current turn's *words* changed (case and punctuation ignored). This is the most likely cause of problem 1, but it isn't proven. The report now records, at every back-up prompt, hard stop, time limit and no-speech repeat, what the silence clock saw (`vad …, words changed … ago, last event … ago, rec state/mode`), so the retest will confirm or refute it.
2. **Recovery after network failures:** after a `network`/`start` failure, the controller retries continuous recognition when the browser fires `online`, and every 20 s. If it fails again, 3 errors put it back in push-to-talk. Report events: `rec-retry`, `rec-recovered`. The Spanish banner now says the app will listen again by itself when the connection returns.
3. **No auto-skipping while the app can't hear** (push-to-talk): no-speech repeats and move-ons are suspended. Answers given by holding the button, or Space, still commit normally, and the Part 2 hard stop still applies.
- 252 tests; typecheck and build pass.

**2026-09-23 (eighth part): step 3 built.** `npm run typecheck` (browser and `/api` projects), `npm test` (246 tests) and `npm run build` pass. The browser bundle contains neither the Anthropic SDK nor any secret name (checked).

Built:
- **Server:**
  - `api/examiner.ts`: token check, input validation, `EXAMINER_MODEL` with `max_tokens` 80 and no thinking, streamed as plain text. The Anthropic client is created at module scope with retries off. A ping (`kind: "ping"`) makes no model call. The browser's abort cancels the model call.
  - `api/session-start.ts`, minimal: passphrase in, HMAC token out (45 min). Step 4 adds the daily cap and question selection.
  - `api/_lib/token.ts` (sign and verify tokens; constant-time passphrase compare), `api/_lib/examiner-prompt.ts` (validation plus a small prompt: Part 2 topic, Part 3 questions, Part 3 exchange only), and the prompt itself in `api/prompts/examiner.md`.
  - Shared types: `src/shared/examiner-api.ts`.
- **Browser:**
  - `src/session/part3.ts`: pure rules for reply validation (one question of 25 words or fewer, no praise or feedback, `[END]` only under 45 s), the follow-up allowance per level, Part 3 order per level, the Part 3 clock (end after the first answer past 4:30 with 4+ questions) and speculative reuse (3 words or fewer added).
  - `src/session/examiner-client.ts`: one request in flight, 40 per session, streamed read that decides `[NEXT]`/`[END]` early, and deadlines. Every failure resolves so the engine can fall back.
  - `src/session/token-client.ts`: passphrase kept in localStorage; token refreshed after 30 min.
- **Engine:**
  - A Part 3 "discussion" phase: scripted link sentence plus listed questions.
  - A speculative examiner request after 1.0 s of silence, cancelled if Julio keeps talking.
  - On commit: reuse the speculative reply or re-request, 1.2 s deadline, then the scripted next question.
  - A model follow-up is spoken with `source: "ai"`; the answer to a follow-up goes straight to the next listed question with no model call.
  - Repeats use the bank's rephrase. Part 3 answers are 3.5 s endpointed.
  - Resume continues at the next listed question.
  - The examiner function is pinged at the start of Part 2 prep.
  - New metrics: `examiner_reply` latency; counters `spec_fired`, `spec_reused`, `spec_aborted`, `spec_discarded`, `followups`, `examiner_fallback:<reason>`; events `ai-reply` and `ai-fallback`.
- **Content:** a hand-written Part 3 set for the noisy-place card (2 concrete and 4 abstract questions, each with a rephrase and 2 follow-ups).
- **Home:** a Spanish passphrase card (shown only when there's no working passphrase), plus token prewarm.
- **Dev setup:**
  - `npm run dev` now runs `vercel dev` on http://localhost:3000, through `scripts/dev.mjs` because Vercel refuses a `dev` script that calls `vercel dev` itself; `vercel.json`'s `devCommand` starts Vite.
  - `npm run dev:vite` is the old UI-only server.
  - `.vercelignore` keeps `/api` test files from deploying as functions.

Checked locally with `vercel dev`: the pages load, and both functions compile and answer `{"error":"not-configured"}` because `SESSION_SECRET`/`APP_PASSPHRASE` aren't set yet. Test files aren't routed.

Untested: a real model call. It needs Stage 4a, and it's Hassan's checkpoint.

**2026-09-23 (seventh part): step 2 done.** Hassan's final retest (Edge 153, Yeti mic, headphones, Sonia Natural) passed everything:
- pacing without Space;
- "Sorry?" repeated twice (`repeat_requests: 2`);
- the 40 s cut-off (`time_limits: 1`, 112-word answer);
- quick answers kept.

Numbers: commit → examiner audio 125 / 449 ms; click → speaking 878 ms (n = 1, over the 500 ms target but under the 1 s limit); voice onset → first interim 919 / 1,942 ms; 0 stalls; 0 barge-ins; 1 isolated `network` error. Step 3 is planned and waiting for the go-ahead.

**2026-09-23 (sixth part): retest regression and fix.**

Hassan's retest: answers no longer moved on by themselves; he had to press Space every time. His report covered one minute:
- 5 stall restarts, all in turn #3 (his first answer).
- The VAD stream reopened once at 16:30:48 (a Windows device change).
- Only 2 "first interim" samples (p95 9.5 s).
- No commits.

Diagnosis:
- The VAD called the room's steady noise "voice". Its noise floor only rose 1 dB/s while it thought it heard voice, so noise ~25 dB above the starting floor read as voice for about 20 s. The reopen at 16:30:48 started that over.
- Endpointing silence is min(VAD silence, time since last words), so a VAD stuck on "voice" meant silence never started and nothing committed.
- The same stuck VAD fired stall restarts every 5 s during his answer, each cutting recognition for 0.5 to 2 s.
- The step 2 fix didn't cause this; the Yeti's hiss or room noise that day exposed it.

Fix:
1. **VAD noise floor** = the 10th percentile of the last 4 s of levels, plus ~330 ms of calibration when the mic opens. Speech dips between words, so it still reads as voice (tested), while steady noise becomes the floor within a few seconds, and opening the mic into a noisy room no longer reads as voice. Also, the voice threshold can now go up to floor + 12 dB with a ceiling of -20 dBFS, instead of -30.
2. **Endpointing trusts the recognizer after 5 s without new words**, even if the VAD still hears "voice" (`effectiveSilenceMs`).
3. **The VAD can postpone the no-speech repeat by at most one extra 8 s period**, so noise can't hold a turn forever.
4. **Stall back-off:** the cooldown doubles for each stall in a row with no text in between (5 s, 10 s, 20 s, capped at 30 s), so a restart that didn't help can't keep cutting recognition.
- 183 tests; typecheck and build pass.

**2026-09-23 (fifth part): step 2 checkpoint result and fix.**

Hassan's result (Edge 153, Yeti USB mic, headphones, voice Sonia (Natural, en-GB)):
- Passed: opening, pacing, "because" pause, saying nothing, and all of Part 2 (the back-up prompt and the 2:00 hard stop both fired).
- Problems: "Sorry?" didn't make the examiner repeat the first time (the second time "worked", but that was the 8 s no-answer rule). A long answer wasn't cut off at 40 s; it kept listening.

Numbers (reset before the exam):

| Metric (ms) | n | p50 | p95 | Budget |
|---|---|---|---|---|
| Click → examiner speaking | 3 | 322 | 393 | 500 / 1,000, ok |
| Commit → examiner audio (scripted) | 23 | 287 | **822** | 400 / 800, **p95 over** |
| speak() → voice start | 63 | 267 | 784 | |
| Recognizer restart gap | 29 | 419 | 1,543 | |
| Voice onset → first interim | 43 | 886 | 2,359 | |
| Voice end → final text | 23 | 847 | 1,238 | |

Counters: **17 stalls**, **3 barge-ins**, 0 repeat requests, 0 time limits, 2 no-speech repeats, 1 back-up prompt, 1 hard stop, 14 space commits.

Diagnosis:
- The integration checks in Claude's browser (the real app, with a scripted recognizer) showed "Sorry?" and the 40 s limit both work with clean input.
- A reproduction with the examiner's words "leaking" into the mic showed the failure exactly. The recognizer puts Julio's quick answer into the same result as the leaked audio. That result began during the examiner's turn, so it was ignored. His turn stayed empty: no repeat request, no text for the 40 s limit, and the no-answer rule fired 8 s later.
- The sensitive Yeti near headphones fits this, and so do the 3 barge-ins nobody asked for and the 17 stalls. Stall restarts during examiner lines can also swallow the first word of an answer.

Fix (commit after 76cb9bc):
1. **Headphones:** when the examiner stops, text the recognizer hasn't finished yet moves into Julio's turn. The existing echo trim strips the examiner's words ("are you a student sorry" → "sorry"). Without headphones, nothing changes: speech during examiner audio is still ignored (SPEC 6).
2. **Stall detection only while Julio has the floor:** not during examiner audio or ignored turns, and never counting from before his turn began.
3. **Barge-in ignores the examiner's own words:** it needs 2 recognized words that aren't in the examiner's line, so leaked audio can't cut the examiner off.
4. **Report:** events are kept across page loads with wall-clock times. "Copy report" now lists exam events (each commit with its first words, repeat requests, no-speech repeats, time limits, back-up prompts, carried text, echo trims, barge-ins, stalls), so a report copied from any page shows what happened.
- Also fixed: the echo-trim log line showed the text after trimming instead of before.
- New controller tests cover points 1 and 2's turn handling. 175 tests; typecheck and build pass.

**2026-09-23 (fourth part): step 2 built.** `npm run typecheck`, `npm test` (169 tests) and `npm run build` all pass.

Built:
- `src/exams/`:
  - `types.ts`: the generic Step list any exam compiles to.
  - `ielts.ts`: examiner lines, endpointing values, and `buildIeltsScript()`.
  - `ielts-fixed-set.ts`: the hand-written set (Work, Shoes, Computers; the "noisy place" card).
  - `toefl.ts`: an empty placeholder so another exam can plug in later.
- `src/levels/levels.ts`: the SPEC 7 table as data. `conditionsLevel()` makes a full test always run at Nivel 3.
- `src/session/`:
  - `endpointing.ts`: pure rules for Part 1 turns (silence, continuation cues, no-speech repeat and move-on, the 40 s time limit) and the Part 2 long turn (hard stop, back-up prompt about an unused bullet, 6 s end). Also personal calibration: p90 of pauses, logged as `pause_p90_ms` but not yet applied.
  - `voice-commands.ts`: whole-utterance repeat requests of 6 words or fewer.
  - `engine.ts`: runs the steps through explicit states and phases, on the controller's single tick.
  - `checkpoint.ts`: saves to localStorage after every commit; handles resume.
  - `exam-session.ts`: creates and holds the running exam.
- UI:
  - Home: "Empezar examen", the mic check (shown until done once, then on demand), a resume card, and mic-permission prewarm.
  - `/examen`: the state pill, mic meter, live transcript, part and Part 2 timers, cue card and notes, "Repetir pregunta", "Terminar", and the spacebar hint.
  - `/transcripcion`: the transcript by part, with notes such as "interrupted for time".
  - All strings are in `src/i18n/es.ts`.
- Speech controller additions: `examinerAudible` (drives "pensando" vs "hablando"), `voicedRecently()`, a per-session examiner voice for resume, and the `micCheckDone` pref.

Checked in Claude's embedded browser, with the voice stubbed and the mic blocked:
- Home renders and shows the Spanish "mic blocked" banner.
- "Empezar examen" speaks the opening sentence by sentence.
- Pressing Space walks through all 12 Part 1 questions to Part 2 prep (cue card, 1:00 countdown, notes).
- "Terminar" leads to the transcript.
- After a reload mid-exam, Home offers "Continuar examen", which says "Let's continue." and asks the next unanswered question.
- No console errors.

Untested (needs a human): real speech. That covers the pacing after answers, repeat requests by voice, the 40 s cut-off, the Part 2 back-up prompt and hard stop, barge-in during the exam, and real latency numbers.

**2026-09-23 (third part):** Hassan's mic-fix retest passed, so step 1 is done. He didn't paste the retest's "Copy report", so the stall count on the right mic wasn't recorded; watch the stall counter during the step 2 checkpoint. Step 2 is planned and waiting for his go-ahead.

**2026-09-23 (second part): checkpoint 1 result and mic fix.**

Hassan's result: everything worked as expected on Edge and Chrome. One problem: he had to change the mic in Edge's site permissions and reload the page before it took effect. Numbers (Edge 153, Natural voice "Eric", headphones):

| Metric (ms) | n | p50 | p95 | Budget |
|---|---|---|---|---|
| Click → examiner speaking | 2 | 144 | 699 | 500 / 1,000, ok |
| Commit → examiner audio (scripted) | 7 | 190 | 342 | 400 / 800, ok |
| speak() → voice start | 35 | 196 | 708 | |
| Gap between examiner sentences | 20 | 196 | 305 | |
| Recognizer restart gap | 21 | 423 | 586 | |
| Voice onset → first interim | 36 | 828 | 1,654 | |
| Voice end → final text | 5 | 997 | 8,545 | |

Counters:
- restarts: 5 ended, 2 monologue-pause, 1 preempt-examiner, **12 stall**
- 5 `network` errors and **1 automatic switch to push-to-talk**
- `on_device_model`: downloadable
- `avg_confidence`: 1, with 0 zero-confidence results

Hassan didn't notice when the stalls and the push-to-talk switch happened.

Fix built:
- The mic check shows "Micrófono en uso: …", with Spanish instructions for choosing another mic (the site icon, then Micrófono, then reload the page).
- The lab status bar shows the mic too, and "Copy report" includes `mic`.
- The page can't pick the recognizer's mic, and Edge only applies a new site mic after a reload, so those instructions are the fix for that case.
- When a mic is plugged in or unplugged mid-session (for example headphones), the controller reopens the mic-level stream. If the physical device changed, it also restarts the recognizer (restart reason `mic-change`). No reload needed.
- "Copy report" now ends with the notable events and their timestamps (stalls, recognizer errors and failures, mic changes, voice fallbacks), so we can see when stalls happen.
- Typecheck, 77 tests and build pass. Commit 9717fd0.

**2026-09-23 (first part): step 1 built.** `npm run typecheck`, `npm test` (74 tests) and `npm run build` all pass.

Built:
- Scaffold: Vite 8 + React 19 + Tailwind 4 + TypeScript 7 (strict) + Vitest 5. A small hand-written router (no router library). `npm run dev` is plain Vite for now.
- `src/speech/`:
  - `recognizer.ts`: always-on recognition. It restarts on `end` and handles forced, pre-emptive (examiner starts speaking and the session is older than 40 s), monologue (first 700 ms pause after 45 s) and stall restarts. Three network errors in 60 s, or `not-allowed`, switch it to push-to-talk. When a session ends before its last text is final, that text is kept anyway, so restarts never lose words.
  - `transcript.ts`: tags each recognized result with the turn it started in.
  - `synthesizer.ts`: one utterance per sentence. The watchdog is words × 0.5 s + 2 s, counted from the voice's `start` event. An online voice that hasn't started after 1.5 s switches to a local voice for the rest of the line. A local voice stuck for 3 s skips that sentence, so the exam never stalls.
  - `voices.ts`: voice ranking, accent rotation, examiner name.
  - `vad.ts` / `vad-detector.ts`: mic level sampled at 30 Hz, with an adaptive noise floor.
  - `echo-guard.ts`: echo trim and the barge-in rule.
  - `controller.ts`: wires the pieces together. The step 2 engine will drive the exam through it.
- `src/metrics/`: latency store with p50/p95 against the section 3 budget. Its `snapshot()` has the shape `sessions.metrics` will use in step 6. For now it persists to localStorage.
- `/lab` page, the Shift+D overlay, and the Spanish mic check and recognition-failure banner (strings in `src/i18n/es.ts`).

Untested (needs a human with a mic):
- Everything audio: recognition quality, restart gaps, barge-in, echo on speakers, ducking, Natural-voice start latency.
- The page did render with no console errors in Claude's embedded browser (Chromium; only local en-US voices there).

Half-done: nothing.

## Checkpoint for Hassan

**Now: HUMAN_GUIDE Stage 6c checks on production (about 15 minutes).** URL: https://ielts-nclex-rn-trainer.vercel.app (the production domain; preview URLs may ask for a Vercel login).

1. Open it in Edge. It's a new address, so the browser asks for the passphrase once. Do the mic check if asked, then a full test ("Examen completo"). It costs about US$0.13, like the local tests.
2. On the results page, press "Guardar" on one or two words.
3. Check:
   - [ ] Supabase, Table Editor, `sessions`: the session is there with `grade` and `overall` filled in (it's saved when the exam ends and again when the grade arrives).
   - [ ] `vocab`: the saved words are there. `usage`: today's row shows 1.
   - [ ] In the app, "Mi historial" shows the session with its band and a chart point, and tapping it shows the feedback and transcript. "Mi vocabulario" shows the words.
   - [ ] On your phone, open the same URL and enter the passphrase: "Mi historial" shows the same session.
   - [ ] Vercel, Settings, Cron Jobs shows `/api/keepalive`. Tomorrow after 12:00 UTC (7:00 Houston time), the `heartbeat` row's `beat_at` has changed. (Claude already triggered it once today: 19:23:30 UTC.)
4. Report back:
   - anything odd;
   - "Copy report" from `/lab` on the production site, after the test. The report now covers that exam only, and gives the deployed latency for the Part 3 AI and voice-start open questions.

**After the 6c checks and before sending Julio the link (6d): run `supabase/manual/reset-before-julio.sql`** in the Supabase SQL Editor. Hassan's test sessions are saved like Julio's, so they would otherwise show in his History, chart and "last score", skip those topics in his repeat filter, seed his pause calibration, and could count as his "first full test" for step 7's placement. The script deletes all sessions, vocab, usage and case flags, resets the profile (level 2, no pause_p90, placement not done), and ends with a check query (all counts 0). Run it once, and never after Julio has started.

## Decisions

Decisions made before the build, from the planning chats:

- English test assumed to be IELTS Academic (Interstaff names it on its TN Mexico timeline). TOEFL kept as a seam only.
- Speaking first; Reading, Writing, Listening and NCLEX written practice later.
- Browser Web Speech API for recognition and speechSynthesis for the voice. No Deepgram. Edge preferred for its natural voices.
- Hassan's Anthropic key behind Vercel functions, passphrase gate, daily cap. Julio never handles a key.
- Supabase free tier, server-side only, so history follows Julio across devices and Hassan can check progress.
- Separate GitHub repo and Vercel project (not inside Hassan's "spanish" repo).
- Laptop is the main device; phone is fine for History and Vocab.
- Hugging Face IELTS dataset dropped; seasonal bank built from reported topic titles instead.
- Health cards about 25% of Part 2 draws (down from 40% in v1).
- Three difficulty levels change support and feedback, never topics; full tests always at real-exam conditions.

New decisions during the build go below with a date.

- 2026-09-23: **No pushes to GitHub until step 4's passphrase gate and session tokens work** (Hassan). GitHub is connected to Vercel and every push deploys publicly.
- 2026-09-23 (step 3 plan): the examiner endpoint verifies a session token from the start. A minimal `/api/session-start` (passphrase in, 45-minute token out) is built in step 3; step 4 adds the daily cap and question selection. The Part 3 set for the noisy-place card is hand-written until the step 4 bank.

- 2026-09-23: The `/lab` page's controls and readouts are in English (it's Hassan's tool). The parts Julio will see (mic check, headphones question, error banners) are in Spanish from `src/i18n`. (Hassan agreed.)
- 2026-09-23: `env.example` and `gitignore` renamed to `.env.example` and `.gitignore`. (Hassan agreed.)
- 2026-09-23 (implementation choices within the spec):
  - Echo trim needs at least 2 matching words, so "What do you like about it?" followed by "It is…" keeps "It".
  - The 1.5 s no-start fallback applies to any online voice (including Chrome's Google voices), not only Natural ones.
  - A local voice stuck for 3 s skips that sentence.
  - Stall detection is paused while the examiner speaks without headphones, because the VAD hears the examiner there.
  - Silence for committing an answer is the shorter of the VAD silence and the time since the last recognition result, so a quiet voice the VAD misses can't end a turn early.
  - The lab's 2.5 s commit is a stand-in; real endpointing is step 2.

- 2026-09-23 (step 2 plan, Hassan agreed):
  - The opening ID check waits for any reply. The general no-answer rule still applies (8 s: repeat; 8 more s: move on), so it can't stall.
  - The fixed question set for steps 2 and 3 is hand-written in IELTS style: Work, Shoes and Computers for Part 1, and the "noisy place" card for Part 2. The real bank comes in step 4.
  - For now Home has "Empezar examen", the mic check and the banners. The mode picker, level and last score come in steps 4 to 7.
  - Part 2: if Julio says nothing after "Please start speaking now", repeat it once after 8 s, then move on after 8 more s. The 4 s back-up prompt only applies once he has started speaking.
  - Personal pause calibration is computed and logged now; the standard silence settings stay in use until the profile table exists (step 6).

- 2026-09-23 (step 2 implementation choices within the spec):
  - A whole-utterance repeat request ("Sorry?") commits after the base silence without the +1.5 s short-answer extension, since it isn't an answer.
  - A second repeat request on the same question moves on (the question is repeated once only).
  - The "Repetir pregunta" button doesn't use up that one repeat.
  - Part 2 asks one round-off question (the spec says one or two).
  - If Julio says nothing after the Part 2 start line, the 2:00 clock restarts from the repeated "Please start speaking now".
- 2026-09-23 (step 2 fix, within the spec):
  - With headphones, results that are still open when the examiner stops move into Julio's turn.
  - Stall detection only runs while Julio has the floor.
  - Barge-in needs 2 recognized words that aren't in the examiner's own line (the spec says "at least 2 recognized words"; the examiner's words leaking into the mic don't count).

- 2026-09-23 (step 3, within the spec):
  - The model is called only when a follow-up is still allowed: not after a follow-up answer (at most one per listed question) and not past the level's allowance. Otherwise the scripted next question is instant.
  - When the model is slow, fails or returns something invalid, the fallback is always the next listed question. The bank's pre-written follow-ups are used for the fixed set only as data, for now.
  - Speculative requests count toward the 40-per-session cap, so a very halting Part 3 could reach it. After that, Part 3 is scripted.
  - When the model reply decides what comes next (follow-up, `[NEXT]` or `[END]`), the latency counts as "Part 3 AI", fallbacks included.
  - A minimal passphrase card on Home (Spanish), shown only until a passphrase works. It does not block practice: without a token, Part 3 is scripted. The real gate comes in step 6.
  - `npm run dev` goes through `scripts/dev.mjs` (Vercel refuses a `dev` script that calls `vercel dev`) and serves on port 3000.

- 2026-09-25 (step 4 plan, Hassan agreed):
  - Claude compiles the reported Sep–Dec 2026 Part 2 titles from 2–3 prep sites (titles only, sources noted here) to complete the season file; Hassan reviews them in 4c.
  - The database-dependent parts of `/api/session-start` (daily cap, repeat filter over the last 5/10 sessions, saved level and saved words) wait for step 6. Until then it runs SPEC 4's "Supabase unreachable" path: token plus questions, no cap, no filter.
  - The Home mode selector gets "Examen completo / Solo Parte 1 / Partes 2 y 3" in step 4. "Práctica rápida" and the level display come in step 7.

- 2026-09-30: **Test data vs Julio's data:** there is no "test mode". Hassan tests on production like Julio would, then wipes everything once with `supabase/manual/reset-before-julio.sql` (outside `migrations/` on purpose) before Julio's first session. From then on, Hassan should not run graded sessions with the production passphrase; he can use `npm run dev` locally, which saves to the same database. So any local test after Julio starts also lands in his data. If that becomes a need, a separate Supabase project for development is the fix, to propose then.

- 2026-09-30: **Pushing to GitHub `main` approved** (Hassan: "you're good to push"). Every push deploys to production at https://ielts-nclex-rn-trainer.vercel.app. Before each push: typecheck, tests, build and the bundle scan.

- 2026-09-30 (step 6 implementation choices within SPEC 4, 9 and 12; Hassan: "make sure if you make any changes, you note it down"):
  - **Supabase access:** plain `fetch` to its REST API from the server functions, with no `supabase-js`. The `sb_secret_` key goes on the `apikey` header only; Supabase's docs say secret keys aren't JWTs and must not be sent as `Authorization: Bearer`.
  - **Schema additions beyond SPEC 12:**
    - `profile.id` (always 1, a single row);
    - `sessions.saved_at`;
    - `vocab.created_at` (for "due" ordering);
    - `case_flags.id`;
    - `heartbeat.id` and `beat_at`.
    - Words are the `vocab` primary key, checked to be lowercase.
  - **Daily cap:**
    - "Today" is Julio's day (America/Mexico_City), so the count resets at his midnight.
    - `usage.sessions` counts graded sessions: `grade_admit` adds one and refuses (undoing it) past `DAILY_SESSION_CAP`. Regrades and "Intentar de nuevo" count too, since they cost the same.
    - `/api/session-start` refuses a token when today's count is at or over the cap. Home then shows a Spanish message and disables "Empezar examen"; the mic check still works.
    - If the database can't answer, both routes go ahead (SPEC 4 "Resilience"). The client guard of one grade per session still applies.
  - **Repeat filter:** `sessions.topic_ids` holds the Part 1 topic ids plus the Part 2 card id the mode used. It covers the last 5 IELTS sessions for Part 1 and the last 10 for Part 2, in any mode.
  - **Saving:**
    - Each session is saved twice, both upserts by its uuid: when the exam ends (no grade) and when the grade arrives.
    - `save_session` never lets a save without a grade erase one. It counts saved-word reviews only the first time a graded save arrives: `times_seen` +1 for each due word sent to the grader; `times_used_correctly` +1 for each word in `saved_words_used`; mastered at 3. It also stores `pause_p90` on the profile.
    - Pending saves wait in localStorage `sessions.pending.v1` (at most 5), with retries after 2, 5, 15 and 60 s, on `online`, and on each Home visit. A 400 (malformed) is dropped rather than retried forever.
  - **Session fields:** `sessions.level` is the conditions level (a full test is 3); the level feedback aimed at is in `transcript.feedbackLevel`. `metrics` is the metrics snapshot plus `fluency` (the local stats); the browser, voice, mic and recogniser are in its `info`.
  - **Per-exam metrics:** starting a new exam (not a resume) resets the metrics store, so the Shift+D overlay, "Copy report" and `sessions.metrics` cover that exam only. This is also the fix for the unreset numbers in Test B's report.
  - **"Due for review":** words not yet mastered, ordered by fewest correct uses, then fewest times seen, then oldest. Up to 30 go to the grader and up to 10 show on Home.
  - **Personal pause calibration (SPEC 8):** applied to the opening, Part 1 and round-off questions (default 2.5 s) and to Part 3 answers (3.5 s), via `personalBaseMs()`. The Part 2 long turn keeps its own rules. The value is stored on the checkpoint, so a resumed exam uses the same one.
  - **The level from the profile** is returned but not applied yet. That's step 7 (placement); feedback still aims at Nivel 2.
  - **Test date:** session-start uses the test date the browser sends, else `profile.ielts_test_date`. The settings screen to set it is step 7.
  - **Passphrase routes:** `/api/sessions`, `/api/history` and `/api/vocab` take the header `x-app-passphrase` (SPEC 4). The passphrase is never put in a URL.
  - **The passphrase gate:** Home shows only the passphrase card until a passphrase has worked on this computer, or when the server says it's wrong. An unreachable server doesn't lock out a passphrase that worked before. `/lab` isn't gated: it makes no paid calls, and every API route checks the token or passphrase itself.
  - **"Guardar":** the word is saved in localStorage at once (so it works offline), then sent to `/api/vocab`. Unsent words, including step 5's, are sent on each Home or Vocab visit. The server ignores duplicates.
  - **History chart:** a hand-drawn SVG on a 0 to 9 scale. It draws the overall (thick) and the three criteria as lines for graded full tests, a dashed 7.0 line, and graded practice sessions as hollow dots labelled "N<level>" (the conditions level). Ungraded sessions appear in the list only.
  - **Vocab's "Términos NCLEX" tab** (SPEC 10) waits for Clinical mode (step 8), which builds `vocab-seed.json`.
  - **SPEC 9 says session-start returns the examiner voice and accent pick.** That stays in the browser (step 1's rotation) because the voice list only exists there.
  - **Deploy:** explicit SPA rewrites (`/lab`, `/examen`, `/resultados`, `/transcripcion`, `/historial`, `/historial/:id`, `/vocabulario`) and a daily cron at 12:00 UTC (Hobby allows daily).

- 2026-09-30: **Step 5 passed** (Hassan). **Examiner voice start latency:** keep the online Natural voice (option a) and re-measure on Julio's connection after deploy (option c). The scripted p95 over 800 ms comes from the voice service, not the app.

- 2026-09-27 (step 5 calibration, following HUMAN_GUIDE Stage 5 "Claude Code can adjust the prompt"): the grading prompt's recogniser, error-weighting, discourse-marker and Part 1-length rules, as described under "Last session". SPEC 11's rules are unchanged.

- 2026-09-26 (step 5 implementation choices within the spec and the approved plan):
  - The grader doesn't receive the opening (name, identification): IELTS doesn't assess it, and it keeps Julio's name out of the request.
  - Under 30 words in all answers, no model call; the results screen explains in Spanish.
  - Grading starts at the closing line. If "Terminar" skips it, grading starts at the end. A results page opened after a reload doesn't grade on its own: it offers "Calificar mi examen", so a reload during grading can't silently pay twice. A finished grade is reused from localStorage.
  - Stream order on screen: each criterion as soon as its object closes; the fixes and focus as they close; the pronunciation flags, upgraded answers and vocabulary with the final grade (they come last in the stream anyway).
  - Speaking time is measured from the first to the last recognised word. The recogniser's lag at both ends roughly cancels out.
  - "Reintentar" endpointing:
    - Part 1 uses the exam's rules (2.5 s, 40 s limit).
    - Part 2 ends on 6 s of silence or at 2:00.
    - Part 3 uses 3.5 s, capped at 2:00.
    - All at his level's extra patience, with one repeat on "Sorry?".
  - Comparisons have a 20 s timeout and a cap of 10 per page.
  - The latency row "Exam end → local stats on screen" uses 100 ms as the target, standing in for SPEC 3's "instant" (limit 200 ms).
  - Retries follow SPEC 11 (once, on max_tokens, a refusal, a network error or invalid JSON). The API's server-side refusal-fallback option isn't used.
  - `/transcripcion` stays as an alias of the new `/resultados`.

## Open questions

- **Examiner voice start latency (decided 2026-09-30: keep the natural voice, re-measure after deploy).** "Commit → examiner audio (scripted)" was 378 / 1,000 ms (p50 / p95, n = 20) against 400 / 800, and "click → examiner speaking" was 1,045 ms (n = 1, limit 1,000). Both are Edge's online Natural voice starting slowly ("speak() → voice start" p95 1,043 ms), not our code. This is the second run over the p95 limit (the first was 822 ms). The options:
  - (a) Accept it for the online Natural voice.
  - (b) Lower the no-start fallback from 1.5 s to about 0.6 s, so a slow sentence switches to a local voice. The p95 would be met, but the voice would sometimes change mid-line and sound robotic.
  - (c) Keep watching it on Julio's connection after deploy.
  - Recommendation: (c) with (a) as the default. The natural voice matters more to Julio than 200 ms on 1 line in 20; revisit if his numbers are worse.

- **Part 3 AI latency** (2026-09-25: within budget on the retest, 214 / 823 ms with n = 2, because the speculative replies were ready at commit; re-measure once deployed in step 6). Earlier notes:
  - **The numbers:** commit → examiner audio (AI) was 1,060 / 1,814 ms (p50 / p95, n = 3) against 700 / 1,200. The model's reply took 1.6 to 2.1 s end to end. That was under `vercel dev` on Hassan's PC, where the function runs locally and compiles on first use, so the deployed iad1 function may well be faster.
  - **Built in by design:** SPEC 8's 1.2 s deadline is on the *reply*. Adding the voice's own start time (~0.3 to 0.8 s), a fallback line can reach ~1.8 s, so the SPEC 3 limit of 1.2 s for *audio* can't be met whenever the deadline is used.
  - **Options:** (a) lower the reply deadline to about 0.8 s so a fallback still starts within ~1.2 s, at the cost of more scripted fallbacks; (b) keep 1.2 s and accept a slower fallback; (c) decide after measuring the deployed function in step 6.
  - **Recommendation:** (c), then (a) if deployed replies still miss.

- "Commit → examiner audio (scripted)" p95 was 822 ms in the first step 2 run, then 449 ms in the final retest. It's driven by how fast Edge's online voice starts. Keep watching; if it goes over again, Hassan decides between accepting it and using a local voice when the online one is slow.
- Echo trim (SPEC 6) strips a leading run of the answer that matches the end of the question. A real answer that repeats the question's last words ("Do you like buying shoes?" / "Buying shoes is fun") loses them ("is fun"). It's rare and the spec is followed as written; restricting the trim to text that began during the examiner's audio would avoid it. To propose to Hassan after the retest.

- Part 1's wait after a continuation word ("because") is 4.0 s by the spec's numbers (2.5 + 1.5). HUMAN_GUIDE Stage 2 asks for a 4-second pause not to move on, which is borderline in Part 1. Section 16's 4-second test is for Part 3 (5 s there). Keep the spec numbers unless Hassan wants Part 1 more patient.

- Resolved 2026-09-23: Edge's Natural voices do fit the budget on Hassan's connection. Commit → examiner audio was 190 / 342 ms (p50 / p95); speak() → start was 196 / 708 ms.
- Stall restarts: the retest passed, but its counts weren't captured. Recheck the stall counter at the step 2 checkpoint.

## Known issues

- Part 2 replay records from the mic-level (VAD) stream. If that stream can't open, or is reopened mid-turn by a mic change, the replay is missing or ends early. Nothing else depends on it.
- The "Exam end → …" latency rows are measured only when the results page follows an exam on the same page load (not after a reload).

- The bank:build cost estimate is conservative: it assumed 6k output tokens per card, while Opus 5.5 at medium effort used about 2k. The real cost was a third of the estimate.

- SPA routes (`/lab`, `/examen`, `/transcripcion`) need a rewrite to `index.html` on the deployed site. `vercel dev` serves them through Vite, so this only matters at deploy (step 6).

- Edge reports a recognition confidence of 1 for every result, so confidence isn't a useful signal on Edge (SPEC 11's "low-confidence words" input for grading will be empty there). Grading must lean on words that make no sense in context. Check Chrome's numbers at the retest.
- Edge sometimes finalizes text late: the "voice end → final text" p95 was 8.5 s (only 5 samples). For step 2, endpointing must commit on silence using interim text and never wait for a final result. Late finals still land in the right turn.
- The page can't choose the mic the recognizer uses; the browser's own setting decides. The app shows the mic in use and explains how to change it.

- The lab page (and the overlay) only repaints while the tab is visible: rendering is tied to animation frames (SPEC 13). The speech layer itself keeps running in the background.
- Intermediate commit 437da71 doesn't build on its own (it imports files from the next commit). The branch head builds fine.

## Cost log

| Date | What | Approx. cost |
|---|---|---|
| 2026-09-25 | Bank build sample, 4 items (claude-opus-5-5) | US$0.11 |
| 2026-09-25 | Bank build, remaining 106 items (145k input, 128k output tokens) | US$3.14 |
| 2026-09-25 | Rebuild of the 15 health cards' Part 3 sets (estimated ~$0.50; more because of the avoid list) | US$1.06 |
| 2026-09-23 to 25 | Part 3 examiner testing (Haiku 4.5, a few dozen calls) | under US$0.10 (estimate) |
| 2026-09-26 | Step 5 build: no model calls (all mocked or stubbed) | US$0 |
| 2026-09-27 | Hassan's Test A: 1 grade (claude-opus-5-5) + Part 3 examiner calls | about US$0.15 (estimate; tokens weren't logged yet) |
| 2026-09-27 | Test A regrade (10,515 input / 3,849 output tokens at $4 / $20 per million) | US$0.12 |
| 2026-09-30 | Test B grade (9,032 input / 4,102 output tokens) + Part 3 examiner calls + Reintentar comparisons | about US$0.13 |
