# PROGRESS.md

Shared memory between Claude Code sessions. Claude Code updates this at the end of every session. Hassan fills in checkpoint results (or pastes them in chat and Claude Code records them).

## Current status

- **Current step:** 3 (Part 3 examiner endpoint, speculative prefetch, fallback)
- **State:** in progress
- **Waiting on:** nothing to start. Before the step 3 checkpoint, Hassan needs to do HUMAN_GUIDE Stage 4a (`APP_PASSPHRASE`, `SESSION_SECRET` in Vercel, then `vercel env pull .env.local`) so the examiner endpoint's token check can run locally.
- **DO NOT PUSH.** GitHub is connected to Vercel, so every push to GitHub deploys publicly. Nothing gets pushed until the passphrase gate and session tokens (step 4) are working and Hassan says so.

## Step status

| Step | What | Status | Checkpoint result |
|---|---|---|---|
| 0 | Hassan's setup: repo, tools (HUMAN_GUIDE stage 0) | done | |
| 1 | Speech layer and `/lab` page | done | 2026-09-23: all tests passed on Edge and Chrome. The mic-selection problem was fixed, and the retest passed ("everything worked as expected"). |
| 2 | Engine: scripted opening, Part 1, Part 2; endpointing; voice commands | done | 2026-09-23: first run passed except "Sorry?" and the 40 s cut-off (headphone leak). A fix then broke pacing (VAD noise floor). Final retest: everything passed. Commit → examiner audio 125 / 449 ms (p50 / p95), 0 stalls, 0 barge-ins. |
| 3 | Part 3 examiner endpoint, speculative prefetch, fallback | pending | |
| 4 | Bank build and validation scripts, seasonal selection, `/api/session-start` | pending | |
| 5 | Grading (streamed, structured) and results screen | pending | |
| 6 | Supabase persistence, History, Vocab, keepalive cron, deploy | pending | |
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
| APP_PASSPHRASE and SESSION_SECRET chosen and added to Vercel env vars | step 4 | |
| Supabase project created (East US), secret key and URL added to Vercel env vars | step 6 | |
| Migrations run in Supabase | step 6 | |
| CRON_SECRET added; cron job visible in Vercel | step 6 | |
| Julio has the link and passphrase | after step 6 | |

## Last session

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

Step 2 is done. The step 3 checkpoint will be written when step 3 is built (HUMAN_GUIDE.md Stage 3c).

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

## Open questions

- "Commit → examiner audio (scripted)" p95 was 822 ms in the first step 2 run, then 449 ms in the final retest. It's driven by how fast Edge's online voice starts. Keep watching; if it goes over again, Hassan decides between accepting it and using a local voice when the online one is slow.
- Echo trim (SPEC 6) strips a leading run of the answer that matches the end of the question. A real answer that repeats the question's last words ("Do you like buying shoes?" / "Buying shoes is fun") loses them ("is fun"). It's rare and the spec is followed as written; restricting the trim to text that began during the examiner's audio would avoid it. To propose to Hassan after the retest.

- Part 1's wait after a continuation word ("because") is 4.0 s by the spec's numbers (2.5 + 1.5). HUMAN_GUIDE Stage 2 asks for a 4-second pause not to move on, which is borderline in Part 1. Section 16's 4-second test is for Part 3 (5 s there). Keep the spec numbers unless Hassan wants Part 1 more patient.

- Resolved 2026-09-23: Edge's Natural voices do fit the budget on Hassan's connection. Commit → examiner audio was 190 / 342 ms (p50 / p95); speak() → start was 196 / 708 ms.
- Stall restarts: the retest passed, but its counts weren't captured. Recheck the stall counter at the step 2 checkpoint.

## Known issues

- Edge reports a recognition confidence of 1 for every result, so confidence isn't a useful signal on Edge (SPEC 11's "low-confidence words" input for grading will be empty there). Grading must lean on words that make no sense in context. Check Chrome's numbers at the retest.
- Edge sometimes finalizes text late: the "voice end → final text" p95 was 8.5 s (only 5 samples). For step 2, endpointing must commit on silence using interim text and never wait for a final result. Late finals still land in the right turn.
- The page can't choose the mic the recognizer uses; the browser's own setting decides. The app shows the mic in use and explains how to change it.

- The lab page (and the overlay) only repaints while the tab is visible: rendering is tied to animation frames (SPEC 13). The speech layer itself keeps running in the background.
- Intermediate commit 437da71 doesn't build on its own (it imports files from the next commit). The branch head builds fine.

## Cost log

| Date | What | Approx. cost |
|---|---|---|
