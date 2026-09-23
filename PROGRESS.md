# PROGRESS.md

Shared memory between Claude Code sessions. Claude Code updates this at the end of every session. Hassan fills in checkpoint results (or pastes them in chat and Claude Code records them).

## Current status

- **Current step:** 2 (engine: scripted opening, Part 1, Part 2; endpointing; voice commands)
- **State:** planned, not started
- **Waiting on:** Hassan's go-ahead on the step 2 plan (and the answers to its open questions).

## Step status

| Step | What | Status | Checkpoint result |
|---|---|---|---|
| 0 | Hassan's setup: repo, tools (HUMAN_GUIDE stage 0) | done | |
| 1 | Speech layer and `/lab` page | done | 2026-09-23: all tests passed on Edge and Chrome. The mic-selection problem was fixed, and the retest passed ("everything worked as expected"). |
| 2 | Engine: scripted opening, Part 1, Part 2; endpointing; voice commands | pending | |
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
| Vercel account, CLI installed and logged in, project linked | step 3 | |
| Anthropic API key created, monthly spend limit set, key added to Vercel env vars | step 3 | |
| APP_PASSPHRASE and SESSION_SECRET chosen and added to Vercel env vars | step 4 | |
| Supabase project created (East US), secret key and URL added to Vercel env vars | step 6 | |
| Migrations run in Supabase | step 6 | |
| CRON_SECRET added; cron job visible in Vercel | step 6 | |
| Julio has the link and passphrase | after step 6 | |

## Last session

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

Step 1 is done. The step 2 checkpoint will be written when step 2 is built (HUMAN_GUIDE.md Stage 2).

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

- 2026-09-23: The `/lab` page's controls and readouts are in English (it's Hassan's tool). The parts Julio will see (mic check, headphones question, error banners) are in Spanish from `src/i18n`. (Hassan agreed.)
- 2026-09-23: `env.example` and `gitignore` renamed to `.env.example` and `.gitignore`. (Hassan agreed.)
- 2026-09-23 (implementation choices within the spec):
  - Echo trim needs at least 2 matching words, so "What do you like about it?" followed by "It is…" keeps "It".
  - The 1.5 s no-start fallback applies to any online voice (including Chrome's Google voices), not only Natural ones.
  - A local voice stuck for 3 s skips that sentence.
  - Stall detection is paused while the examiner speaks without headphones, because the VAD hears the examiner there.
  - Silence for committing an answer is the shorter of the VAD silence and the time since the last recognition result, so a quiet voice the VAD misses can't end a turn early.
  - The lab's 2.5 s commit is a stand-in; real endpointing is step 2.

## Open questions

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
