# PROGRESS.md

Shared memory between Claude Code sessions. Claude Code updates this at the end of every session. Hassan fills in checkpoint results (or pastes them in chat and Claude Code records them).

## Current status

- **Current step:** 1 (speech layer and `/lab` page)
- **State:** built, awaiting checkpoint
- **Waiting on:** Hassan's lab test on Edge (headphones and speakers) and Chrome. See "Checkpoint for Hassan" below.

## Step status

| Step | What | Status | Checkpoint result |
|---|---|---|---|
| 0 | Hassan's setup: repo, tools (HUMAN_GUIDE stage 0) | done | |
| 1 | Speech layer and `/lab` page | built (awaiting checkpoint) | |
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

**2026-09-23: step 1 built.** `npm run typecheck`, `npm test` (74 tests) and `npm run build` all pass.

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

Matching guide section: **HUMAN_GUIDE.md, Stage 1: Test the speech lab.** Budget about 30 minutes.

**Start it:** in the repo folder run `npm run dev`, then open **http://localhost:5173/lab** in **Edge** (later repeat in Chrome). Click "Start mic" and allow the microphone. Press **Shift+D** at any time for the numbers overlay.

**Edge, headphones on:**
1. **Mic check** (top left, in Spanish): read the notice, then "Grabar 3 segundos", say a sentence, and listen to the playback. The transcript should match what you said. Answer "Sí, uso audífonos", and the examiner speaks one line.
2. **Examiner voice:** the voice list should show `[Natural]` voices. Pick a British, an American and an Australian one and press "Test voice" for each. Note how natural each sounds and its "voice start delay" (shown next to the button).
3. **Conversation test:** "Start conversation" and answer the 6 questions normally. Each answer should commit about 2.5 s after you stop (or press Space), and the next question should start quickly. Then press "Examiner reads a long line" and talk over it: the examiner should stop within a second, and your words should show as your turn.
4. **2-minute monologue:** "Start monologue", then read a news article aloud for the full 2:00. Afterwards, "Copy transcript" and compare it with the article. Orange ⟲ marks show where the recognizer restarted; check for missing words around them (usually 45 to 60 s in).
5. **Forced restart:** while talking (the conversation test works for this), press "Force recognizer restart" in Settings mid-sentence and keep talking. Note any lost words.

**Edge, laptop speakers (headphones unplugged):**
6. Untick "Headphones" in Settings. Run the conversation test again. In "Live transcript", the examiner's own words may appear in grey as "heard during examiner audio (ignored)". That is correct. They must **not** appear in your "You:" lines.
7. Talk over "Examiner reads a long line". It should **not** stop.
8. **Volume test:** "Run volume test" and listen. At 4 s the mic stream opens, and at 10 s recognition starts. Does the voice get quieter at either point? If it does, untick "VAD stream echoCancellation" and run it again. If it still drops, set Windows Sound > Communications to "Do nothing" and run it once more. Report which step fixed it.

**Chrome, headphones on:** repeat steps 1 to 5. The voices will be Google or Microsoft ones, not Natural; that's expected.

**Good looks like:**
- Transcripts match your speech.
- No lost words at the ⟲ marks.
- On speakers, the examiner never leaks into your "You:" lines.
- Barge-in works with headphones and is off without them.
- In the "Numbers" table, "Commit → examiner audio (scripted)" is p50 ≤ 400 ms and p95 ≤ 800 ms (green), and "Click → examiner speaking" is ≤ 1,000 ms.

**Report back:** use the KICKOFF.md template 3:
- pass/fail per test and browser
- any lost words and roughly when
- how the voices felt (natural or robotic, speed)
- the volume test result
- and paste **"Copy report"** from the Numbers card once per browser. It includes the recognition engine, whether an on-device model is present, average confidence, restart counts and every latency figure.

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

- Do Edge's Natural (online) voices start fast enough for the 800 ms p95 "commit → examiner audio" budget? The lab measures it (the "speak() → voice start" row). If they don't, we'll need to choose between voice quality and speed.

## Known issues

- The lab page (and the overlay) only repaints while the tab is visible: rendering is tied to animation frames (SPEC 13). The speech layer itself keeps running in the background.
- Intermediate commit 437da71 doesn't build on its own (it imports files from the next commit). The branch head builds fine.

## Cost log

| Date | What | Approx. cost |
|---|---|---|
