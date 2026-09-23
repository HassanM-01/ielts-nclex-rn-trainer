# Julio's Speaking Trainer: SPEC v2.1

Build spec for Claude Code. Read it fully before writing code. It replaces v1; a summary of what changed is at the end. v2.1 adds difficulty levels (section 7) and a quick practice mode.

## 1. Purpose: two exams, one voice engine

Julio is a Mexican nurse on Interstaff's TN visa track. He has two exams ahead:

- **NCLEX-RN**, the US licensure exam. The 2026 NCLEX-RN Test Plan applies from April 1, 2026 to March 31, 2029: computer adaptive, 85 to 150 items in five hours, including three 6-item clinical judgment case studies, with content drawn from eight Client Needs areas. Interstaff gives him a free 3-month UWorld review. Julio says this is what he is preparing for now.
- **IELTS Academic**, the English test for the VisaScreen certificate. Registered nurse minimum: 6.5 overall and 7.0 Speaking. HRSA's May 12, 2026 update kept these IELTS numbers. It must be the test-center version: TruMerit (formerly CGFNS) does not accept at-home tests.

Interstaff's published Mexico timeline puts NCLEX first (day 180) and IELTS second (day 270), though some state boards ask for English scores earlier. Either way, both exams matter now.

Speaking is Julio's weakest skill and 7.0 Speaking is his highest bar, so the core of v1 is a hands-free IELTS Speaking simulator. The same voice engine also runs a Clinical mode built on the 2026 NCLEX-RN Test Plan, so practice time builds English for both exams. NCLEX written-item practice is Phase 2. Reading and Writing come later.

**Alignment rule:** every question maps to a real exam spec. IELTS items follow the real test's format and examiner wording, and most come from the reported question pool for the season Julio will test in. Clinical items map to an NCLEX Client Needs area and a clinical judgment step.

## 2. Users

- **Julio:** native Spanish speaker, working nurse (two jobs), laptop with Microsoft Edge (preferred) or Chrome. Not technical: opens a URL and starts. Interstaff's Language Program offers one-on-one speaking sessions; if he uses them, this app supplies the daily repetitions in between.
- **Hassan:** owner. Pays for the API and checks progress directly in Supabase.

## 3. Performance budget

The build is judged against this table. Log every number into `sessions.metrics` and show them live in a hidden debug overlay (Shift+D).

| Moment | Target (p50) | Limit (p95) |
|---|---|---|
| Answer committed -> examiner audio starts (scripted line) | 400 ms | 800 ms |
| Answer committed -> examiner audio starts (Part 3 AI line) | 700 ms | 1,200 ms, then scripted fallback |
| Click "Empezar examen" -> examiner speaking | 500 ms | 1 s |
| Exam ends -> local fluency stats on screen | instant | 200 ms |
| Exam ends -> criterion bands on screen | 30 s | 90 s |

How the budget is met:

1. **Scripted by default.** The opening, Part 1, Part 2 and every transition are built on the client from the exam definition and the selected bank items. No network, no model. This is also how the real test works: IELTS examiners read Part 1 questions and Part 2 instructions from a fixed script. Clinical mode turns are scripted too. The model is called only for Part 3 turns and for grading.
2. **Speculative Part 3 calls.** After 1.0 s of silence, send the examiner request with the answer so far, and abort it if Julio keeps talking. By the time his turn commits, the reply is usually already there.
3. **Never wait.** Every model call has a deadline and a scripted fallback (the next question, or a pre-written follow-up from the bank).
4. **No database in the turn loop.** One call before the exam (`/api/session-start`), one save after. Usage counting runs after the response via `waitUntil` from `@vercel/functions`.
5. **Prewarm on Home.** As soon as Home loads, fetch the session token and questions for the selected mode (again if the mode changes, or if the token is older than 30 minutes), load the voice list and request mic permission. The "Empezar examen" click is the user gesture that unlocks audio; it starts the recognizer and speaks the opening line at once. Ping the examiner function at the start of Part 2 prep so a warm instance is ready for Part 3.
6. **Small prompts.** Part 3 requests carry only the Part 2 topic, the Part 3 question list and the Part 3 exchange so far, never Parts 1 and 2. Skip prompt caching for examiner turns: Haiku 4.5 only caches prefixes of 4,096 tokens or more, and a short prompt is the faster fix.
7. **Reuse connections.** Create the Anthropic client at module scope so warm function instances reuse the open connection to the API instead of paying a new TLS handshake per turn.
8. **Client guard.** At most one examiner request in flight, and at most 40 per session, so a bug can't loop API calls.

## 4. Stack (fixed, do not substitute)

- Vite + React + Tailwind, TypeScript.
- Vercel: static frontend plus Node.js functions in `/api`. Fluid compute is on by default for new projects; the Hobby plan caps function duration at 300 s. Keep functions in the default region (iad1, Washington D.C.) and create the Supabase project in AWS us-east-1 so server hops stay in one region.
- Claude API via `@anthropic-ai/sdk`, server side only, key in `ANTHROPIC_API_KEY`. Never ship the key to the browser. Models come from env vars:
  - `EXAMINER_MODEL=claude-haiku-4-5-20251001`: the fastest model. No thinking, `max_tokens` 80.
  - `GRADE_MODEL=claude-opus-5-5`: Anthropic's recommended default, default effort (medium). Its thinking is always on, so if the first band misses the budget in section 3, set `output_config.effort` to low before changing models. Claude Fable 5.1 is stronger but slower and 2.5 times the price; switch only if grading calibration disappoints.
  - Rough cost at list prices: 10 to 16 cents per full test, almost all of it grading; about 11 cents per Clinical session. At the default daily cap the worst case is about $2 a day. Also set a monthly spend limit in the Claude Console as the backstop.
- Auth: the frontend sends `APP_PASSPHRASE` once to `/api/session-start`, which returns a signed session token (HMAC with `SESSION_SECRET`, 45 min TTL). `/api/examiner` and `/api/grade` verify the token without touching the database. History and vocab routes take the passphrase header. Keep the passphrase in localStorage so Julio types it once.
- Daily cap: `DAILY_SESSION_CAP` (default 12). `/api/session-start` reads today's count and refuses a token at the cap. `/api/grade` runs one atomic increment-and-check before calling the model (a 50 ms read is invisible next to grading) and refuses past the cap, so a client bug can't loop grading calls. v1 counted every request; with scripted turns a session makes few calls, so graded sessions are the unit that costs money.
- Resilience: if Supabase is unreachable, `/api/session-start` still returns a token and questions (skipping the repeat filter and the cap), and the client keeps the finished session in localStorage until a save succeeds.
- Supabase (free tier), server side only with the secret key; the browser bundle contains no Supabase client. Migrations must include explicit GRANTs for the role the server key uses, because new Supabase projects stopped exposing new public tables to the Data API by default on May 30, 2026. Free projects pause after 7 days of low activity, so add a daily Vercel Cron to `/api/keepalive` (checks `CRON_SECRET`) that updates a heartbeat row.
- Speech: browser Web Speech API for recognition and `speechSynthesis` for the examiner. No Deepgram. See section 6.

## 5. Repo layout

```
/src
  /app          routing, layout, passphrase gate
  /exams        exam definitions: ielts.ts (active), clinical.ts, toefl.ts (stub)
  /levels       level definitions, placement and level-change rules
  /session      engine: state machine, endpointing, timers, prefetch, voice commands
  /speech       recognizer.ts, synthesizer.ts, vad.ts (Web Audio), echo-guard.ts
  /metrics      fluency stats and latency telemetry
  /grading      streaming grade client, progressive rendering
  /history      sessions list and charts (lazy-loaded route)
  /vocab        saved words and review
  /i18n         Spanish UI strings
/api
  session-start.ts   passphrase -> token, daily cap, question selection
  examiner.ts        Part 3 turns and "Reintentar" comparisons (streaming, EXAMINER_MODEL)
  grade.ts           IELTS and Clinical grading (streaming, structured output, GRADE_MODEL)
  sessions.ts        save / list / get
  vocab.ts           list / upsert / toggle mastered
  keepalive.ts       daily cron heartbeat
  /prompts           examiner.md, grade-ielts.md, ielts-descriptors.md, grade-clinical.md
/data/bank
  ielts/evergreen.json
  ielts/season-2026-09.json
  ielts/seeds/*.txt        topic titles per season (input to the build script)
  clinical/cases.json
  vocab-seed.json          NCLEX terminology and question-stem phrases
/scripts
  build-bank.ts      expands seeds into full items with Claude, writes JSON
  validate-bank.ts   schema, counts, links, distribution
/supabase/migrations
SPEC.md
```

The bank ships with the server functions, not the browser bundle. `/api/session-start` returns only the items selected for that session (a few KB).

## 6. Speech layer (build and tune this first)

### Recognition

- `SpeechRecognition` / `webkitSpeechRecognition`, `lang = "en-US"`, `continuous = true`, `interimResults = true`.
- **Always on.** Start it once when the exam starts and keep it running. The engine gates results by state instead of stopping and starting per turn, which avoids clipped first words.
- **Restarts.** Chrome ends sessions after silence and after about a minute of listening. Restart immediately on `end` unless the engine asked to stop. Final results are appended to the current turn buffer by turn id, so no text is ever lost.
- **Pre-emptive restarts.** When the examiner starts speaking and the recognition session is older than 40 s, restart it then, so forced cut-offs rarely land mid-answer. During the Part 2 monologue, restart at the first pause of 700 ms or more after 45 s.
- **Stall detection.** If the VAD hears voice for 3 s with no interim result, restart and log a stall.
- **Failure.** Three `network` errors within 60 s, or `not-allowed` / `service-not-allowed`: switch to push-to-talk and show a Spanish banner suggesting the other browser. Edge 134 (March 2025) shipped with recognition returning network errors, so assume it can happen again.
- **Record the engine.** Log the browser, whether `SpeechRecognition.available({ langs: ["en-US"], processLocally: true })` reports an installed on-device model, and average confidence. Chrome routes to an installed on-device model by itself; Edge's on-device model is Canary/Dev only (as of June 2026). Don't force either, and never call `SpeechRecognition.install()`: once a model is installed, Chrome prefers it for every site and there is no way back to cloud recognition.
- **No contextual biasing** (`phrases`) during exam turns. It helps the recognizer "hear" target words even when they are mispronounced, which would hide the pronunciation signal the grader relies on.
- **Echo trim.** Strip a leading run of words from Julio's first result in a turn if it matches the tail of the examiner's last line.
- **Tell him once.** The first mic check says in Spanish that while the mic is on, the browser sends his audio to Google (Chrome) or Microsoft (Edge) to turn it into text, and that headphones and a quiet room give the best results.

### Voice activity (Web Audio)

- A separate `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })` feeding an AnalyserNode, RMS sampled at about 30 Hz.
- Uses: live mic meter, pause measurement for fluency stats, stall detection, barge-in confirmation, and the source for the optional Part 2 recording.
- If this second stream fails, run without it; nothing else may break.

### Synthesis

- Voice order: voices whose name includes "Natural" with an `en-*` lang (Edge's Online Natural voices), then Google `en-*`, then any `en-*`. Rotate the examiner's accent per session across en-GB, en-US and en-AU when available (real IELTS examiners are not all American), with a setting to pin one. Give the examiner a first name that fits the voice. Persist the choice in localStorage.
- Wait for `voiceschanged` before picking (Chrome loads voices asynchronously).
- The first `speak()` must follow a click: do it in the mic check, which doubles as the prewarm.
- One utterance per sentence. Keep a reference to each utterance until `end` (Chrome can garbage-collect it and never fire `end`). Watchdog: treat an utterance as finished after (word count x 0.5 s + 2 s).
- If an online Natural voice has not fired `start` within 1.5 s, cancel and retry with a local voice (network hiccup).
- Rate comes from Julio's level (section 7): 0.85, 0.9 or 1.0 (real exam pace).

### Barge-in and echo

- The mic check asks "¿Usas audífonos?" (Are you using headphones?) and strongly recommends them.
- With headphones: barge-in on. Speech during examiner audio (VAD energy plus at least 2 recognized words) cancels synthesis and becomes Julio's turn.
- Without headphones: barge-in off, and results that arrive while the examiner is speaking are ignored. Laptop speakers leak the examiner's voice into the mic and would trigger fake barge-ins.
- Examiner interruptions (the Part 1 time limit, the Part 2 hard stop) always ignore barge-in, and Julio's speech after them is discarded until the next question starts.

### Lab page (`/lab`)

Mic check, voice picker, headphones on/off, forced restart, a 2-minute monologue test, and live latency readouts. Also confirm the examiner's volume does not drop when the mic opens (Windows communications ducking). If it does, first try opening the VAD stream with `echoCancellation: false`; if that doesn't help, the setup screen tells Julio to set Windows Sound > Communications to "Do nothing". Get this right on Edge with headphones and with speakers, and on Chrome, before building anything else.

## 7. IELTS Speaking: format, examiner rules and levels

Total 11 to 14 minutes, three parts, one examiner. Write all examiner lines in the neutral, formulaic style of the real test.

- **Opening (scripted):** greeting, the examiner's name, asks Julio's full name, asks to see his identification, then introduces Part 1.
- **Part 1, 4 to 5 min (scripted):** three topics, 3 to 5 questions each (about 11 or 12 questions). The first topic is an opening topic: Work (most often, since Julio works), Home/accommodation or Hometown. Questions are read verbatim. If Julio asks, repeat once, verbatim; never explain a word. If an answer runs past about 40 s, interrupt politely and move on, as real examiners do to keep time. No comments on answers beyond a neutral transition.
- **Part 2, 3 to 4 min (scripted):** instructions, then the cue card on screen (prompt, three bullets under "You should say", one "and explain" line). Exactly 1 minute of preparation with the notes box (lower levels get more; see the table below). "Please start speaking now." Hard stop at 2:00 ("Thank you."). Before his level's speaking goal, a 4 s silence triggers one back-up prompt ("Can you tell me any more about ...?") using an unused bullet. Then one or two rounding-off questions from the card.
- **Part 3, 4 to 5 min (AI-assisted):** a scripted link sentence, then 4 to 6 abstract questions from the linked set. The examiner may rephrase on request, ask a follow-up that picks up on what Julio said, or push for reasons and examples. This is the only IELTS part that calls the model.
- **Close (scripted):** "Thank you. That is the end of the speaking test."
- The examiner never teaches, corrects or praises during the test.

Modes: Full test (default), Part 1 only, Parts 2 and 3, Quick practice, Clinical (section 10). Quick practice takes about 5 minutes: one Part 2 card and the first two questions of its Part 3 set, for days between shifts. Partial modes are graded too, labeled as a partial sample.

### Difficulty levels (Niveles)

On the real test everyone gets the same kind of questions; the band reflects how well they answer. So levels never change which topics Julio gets. They change how much support he gets, how hard the examiner pushes, and what the feedback aims at. IELTS's own CEFR mapping: B1 is about band 4.0 to 5.0, B2 5.5 to 6.5, C1 7.0 to 8.0. His 7.0 Speaking target is the bottom of C1.

| | Nivel 1 (B1 to B2) | Nivel 2 (B2 to C1) | Nivel 3 (Examen real) |
|---|---|---|---|
| Examiner speech rate | 0.85 | 0.9 | 1.0 |
| Part 2 preparation | 2 min | 1.5 min | 1 min |
| Part 2 speaking goal (hard stop stays 2:00) | 1 min | 1.5 min | 2 min |
| Useful words on the cue card | always | first 2 times he sees a card | never |
| "Ayuda" (Help) button | yes | yes | no |
| Part 3 questions | concrete first, at most 1 abstract | 2 concrete, then abstract | as in the real test |
| Part 3 follow-ups ("Why?", "Can you give an example?") | at most 1 per part | at most 1 per 2 questions | up to 1 per question |
| Extra endpointing patience | +1.0 s | +0.5 s | none |
| Upgraded answers written at | band 6 | band 7 | band 7.5 |
| Clinical vignette | 50 to 60 words, text shown while read, key terms glossed in Spanish | 60 to 90 words, text after reading, glosses on tap | 60 to 90 words, text after reading, no glosses |
| Clinical cases drawn | difficulty 1 and 2 | difficulty 1 to 3 | difficulty 2 and 3 |

- **Honest scores.** Grading uses the same descriptors and rules at every level; only the upgraded answers and the advice change. "Examen completo" (Full test) always runs under Nivel 3 conditions, whatever his level, so its bands stay comparable over time and show truthfully how close he is to 7.0. Its feedback is still aimed at his level.
- **Advice by level.** Nivel 1 advice focuses on answering at length, linking ideas and basic accuracy. Nivel 2 on range: less common vocabulary, complex sentences, fewer repetitions. Nivel 3 on the band 7 descriptors: flexible, precise vocabulary, idiomatic language, mostly error-free complex sentences.
- **Placement.** His first full test sets the level: 5.0 or below is Nivel 1, 5.5 to 6.5 is Nivel 2, 7.0 or above is Nivel 3. Until then, start at Nivel 2.
- **Moving up.** After three graded sessions in a row at or above the next level's floor (5.5 for Nivel 2, 6.5 for Nivel 3), the results screen suggests moving up. He accepts or declines. Never move him automatically.
- **Moving down.** After three sessions in a row a full band below his level's floor, suggest stepping down, worded as a normal adjustment, not a failure.
- **Manual override.** He can change level any time in settings.
- **Ayuda.** Opens a panel with 3 useful English phrases for the current question, each with a Spanish gloss, pre-written at bank build time so it opens instantly. While it's open the silence timer pauses. Each use is logged, noted in results, and passed to the grader.
- **Where levels plug in.** The level is stored in the `profile` table, returned by `/api/session-start`, applied by the engine (rate, timers, endpointing, help), passed to `/api/examiner` (follow-up allowance) and `/api/grade` (upgraded-answer target, advice focus), and saved on each session.

## 8. Session engine

Explicit state machine, not ad hoc booleans:

`idle -> warmup -> opening -> part1 -> part2_prep -> part2_speak -> part2_roundoff -> part3 -> closing -> grading -> results`

That list is the IELTS definition. The engine itself is generic: each exam in `/src/exams` supplies its own states, scripts and endpointing values, so Clinical mode and a future TOEFL mode run on the same engine.

### Turn loop

1. Examiner line: scripted lines go straight to the synthesis queue. Part 3 lines come from the prefetch below, or fall back to scripted.
2. When synthesis ends, the engine switches to listening (the recognizer is already running).
3. Endpointing (below) commits Julio's answer.
4. The next examiner line starts within the budget.

### Endpointing

- The silence timer starts only after Julio has started speaking.
- Base silence to commit: 2.5 s in Part 1, 3.5 s in Part 3 and Clinical mode.
- Add 1.5 s if the last word is a continuation cue (and, but, because, so, or, then, like, the, a, my, um, uh, eh, "for example", "I think"), or if the answer so far is under 6 words.
- Personal calibration: after each session, store the 90th percentile of Julio's mid-answer pauses in `profile`. Next session's base = max(default, that value + 0.4 s), capped at default + 1.5 s. The level's extra patience is added on top.
- No speech at all: after 8 s, repeat the question once (Part 1 verbatim, Part 3 with the bank's rephrase). After 8 more seconds, move on.
- Optional "Listo" (Done): the spacebar commits immediately. Never required.
- Part 2: commit at the 2:00 hard stop, or after a 6 s silence once his level's speaking goal has passed or the back-up prompt has been used. Before the goal, a 4 s silence triggers the back-up prompt.

### Voice commands (zero latency)

While listening, an utterance of 6 words or fewer whose whole text is a repeat request ("sorry?", "pardon?", "can you repeat that", "could you say that again", "repeat the question, please", "what do you mean") is not an answer. Match the whole utterance, not a word inside it: "Sorry, I don't really like shoes" is an answer. The examiner repeats: Part 1 verbatim, once; Part 3 with the bank's rephrase. The "Repetir pregunta" (Repeat question) button replays the last line verbatim.

### Part 3 examiner call (`/api/examiner`)

- Input: the Part 2 prompt, the Part 3 question list and current index, the Part 3 exchange so far, seconds left in Part 3, follow-ups already used, and the follow-up allowance for his level.
- Output (plain text, streamed), exactly one of: `[NEXT]`; `[END]` (only allowed with under 45 s left); or one follow-up question of 25 words or fewer that refers to something Julio said. At most one follow-up per listed question.
- Engine: `[NEXT]` -> scripted transition plus the next listed question (known in advance, so instant). Follow-up -> speak it. `[END]` -> closing.
- Speculative: fire at 1.0 s of silence with the interim transcript, and cancel with `AbortController` if speech resumes. Reuse the reply if the committed answer added 3 words or fewer; otherwise re-request with a 1.2 s deadline, then fall back to scripted.
- Validate the output (a single question, no praise, no feedback). Anything else -> scripted next question.
- The engine owns timing, not the model: Part 3 ends after the first answer that finishes past 4:30, with at least 4 listed questions asked.

### Timers, notes and safety

- Visible timers: part timer, Part 2 prep countdown, Part 2 speaking countdown. The notes box appears in Part 2 prep and stays visible while he speaks.
- Checkpoint the transcript to localStorage after every commit. On reload, offer to resume or to grade what exists.

## 9. IELTS question bank

### Why v1's source is dropped

The Hugging Face dataset from v1 (`qwertyuiopasdfg/IELTs-Speaking-answer`) has 216 rows from the September to December 2024 question season. Its card says it was generated by ChatGPT from a PDF. It has no Part 3 and no cue card bullets, and its sample answers are written from a Chinese candidate's life. It could never reach v1's 40/40/40 target and is two years stale. Don't use it, and drop `answers.json`: band-7 rewrites of Julio's own answers (section 11) are better model answers.

### Seasonal bank

IELTS prep sites track the reported question pool in three seasons a year: January to April, May to August, September to December. Most practice should come from the season Julio will test in. Settings take an optional IELTS test date: selection uses the season file that contains that date when it exists, and the current season otherwise. On Interstaff's timeline his test is likely a season or two away, so the refresh below matters.

- `ielts/evergreen.json`: the classic Part 1 topics and Part 2 categories (a person, a place, an object, an event, an experience) that recur every year, plus the health-tagged cards.
- `ielts/season-2026-09.json`: the current season. Seed titles to start from, then complete the list from current season reports:
  - Part 1: Computers, Lost and found, Secondary school, Paper, Shoes, Advertisements.
  - Part 2: a noisy place you have been to; someone older than you whom you admire; an activity you do regularly that you think wastes time; a time you received good service in a shop; a city you would like to visit again; someone who did something difficult and succeeded; a famous person in your area; a time you changed an important decision; a happy person you know; a very organized person you know; a natural place in your city; a skill you learned as a child; a risk that turned out well; a place where you have taken photos more than once.
- Take only topic titles from outside sources. `scripts/build-bank.ts` writes everything else in IELTS style with Claude: Part 1 questions, cue card bullets and "explain" line, rounding-off questions, and a full Part 3 set for every card. Don't copy sample answers or long passages from prep sites.
- Refresh each season: add `seeds/2027-01.txt`, run the script, review, commit. Season lists get reported in the first weeks of January, May and September.

### Health cards serve both exams

Health cards drop from v1's 40% of draws to about 25%: the real IELTS test won't be about health, the reported topics (shoes, advertisements, a noisy place) are the harder and more test-specific practice, and Clinical mode now covers the nursing side. Write health cards as real IELTS prompts a nurse can answer from experience, and tag each with the NCLEX Client Needs area whose language it exercises. Examples:

- a time you had to decide quickly who needed help first -> Management of Care
- a time you taught someone to do something important -> Health Promotion and Maintenance
- a safety rule at your workplace that you think matters -> Safety and Infection Prevention and Control
- a time you calmed down someone who was worried or upset -> Psychosocial Integrity
- a small change you noticed that turned out to be important -> Reduction of Risk Potential
- a mistake you made and what you learned from it -> Safety and Infection Prevention and Control

Their Part 3 sets stay abstract and general (prevention versus treatment, why people ignore health advice), as in the real test.

### Shape

```json
{
  "season": "2026-09",
  "ends": "2026-12-31",
  "part1": [
    { "id": "p1-shoes", "topic": "Shoes", "opening": false, "tags": ["season"],
      "questions": ["..."] }
  ],
  "part2": [
    { "id": "p2-noisy-place", "prompt": "Describe a noisy place you have been to.",
      "bullets": ["where it was", "when you went there", "what made it noisy"],
      "explain": "and explain how you felt about the noise.",
      "roundoff": ["..."], "tags": ["season"], "nclex_area": "none", "part3_id": "p3-noise",
      "useful_words": [ { "en": "deafening", "es": "ensordecedor" } ],
      "help": [ { "en": "What really stood out was...", "es": "Lo que más me llamó la atención fue..." } ] }
  ],
  "part3": [
    { "id": "p3-noise", "theme": "Noise and cities",
      "questions": [ { "q": "...", "kind": "concrete", "rephrase": "...", "followups": ["...", "..."],
                       "help": [ { "en": "...", "es": "..." } ] } ] }
  ]
}
```

Pre-written `rephrase`, `followups`, `useful_words` and `help` make repeats, fallbacks and help instant. Each card gets 5 useful words and 3 help phrases; each Part 3 question gets 3 help phrases and a `kind` of concrete (about people's own experience or their country, "Do people in your city...") or abstract (causes, comparisons, the future, society, "Why do some societies..."). Every Part 3 set has at least 2 of each kind.

### Selection (server side, in `/api/session-start`)

- Part 1: one opening topic (rotate Work, Home, Hometown) plus two others, preferring the current season, none from the last 5 sessions.
- Part 2: about 60% target season, 25% health cards, 15% evergreen general; no card from the last 10 sessions; its linked Part 3 set. Once the season file is past its `ends` date, its share moves to evergreen general.
- Part 3: order the linked set's questions by his level (table in section 7).
- One database round trip: an RPC that returns today's session count, the recent topic ids and the `profile` row.
- Returns the token, the selected items, the level, the examiner voice and accent pick, and up to 30 saved words due for review.

## 10. Clinical mode (NCLEX-aligned, spoken)

Goal: help with the second exam without competing with UWorld's question volume. Train what UWorld doesn't: understanding clinical English by ear, reasoning out loud in English, and the exact terms NCLEX uses. It trains the language and reasoning, not the item formats (Phase 2).

- Session: 3 cases, about 10 minutes.
- Each case: the examiner voice reads a vignette (age, setting, history, vital signs, findings); length, reading speed, when the text appears and Spanish glosses follow his level (section 7). Then 3 of these 4 prompts, which follow the NCSBN Clinical Judgment Measurement Model steps: "Which findings concern you most?" (recognize cues); "What do you think is happening?" (analyze cues, prioritize hypotheses); "What would you do first, and why?" (take action); "How would you know it is working?" (evaluate outcomes).
- Turns are fully scripted (no model calls during the case) and use the same engine with 3.5 s endpointing.
- Feedback is allowed here, since this is practice and not a mock exam, but it must not interrupt the flow: each case is graded in the background by `GRADE_MODEL` while the next case plays, so the feedback cards are ready when the session ends. Put the shared grading instructions in a cached system block (Opus 5.5 caches prefixes from 512 tokens), so cases 2 and 3 read it from cache.
- Per-case output (structured): verdict (correct, partial or incorrect), missed cues, key action and rationale in Spanish, an English version of his answer at his level's upgrade band, English notes in Spanish, and 2 or 3 NCLEX terms with Spanish glosses.
- Case bank (`clinical/cases.json`, generated by the build script with `GRADE_MODEL`): a second, independent model pass answers each case without seeing the key, and cases where the two disagree are dropped. Each case is tagged with its Client Needs area, CJMM steps, key findings, priority action, Spanish rationale, terms, and a difficulty from 1 (one clear problem, textbook cues) to 3 (competing priorities, subtle cues, more distractors). Each case stores a short version (50 to 60 words) and a full version (60 to 90 words). Prefer common scenarios whose correct action is stable across guidelines; avoid obscure dosing. Distribution follows the 2026 test plan's mid-points: Management of Care 18%, Pharmacological and Parenteral Therapies 16%, Physiological Adaptation 14%, Safety and Infection Prevention and Control 13%, Reduction of Risk Potential 12%, Health Promotion and Maintenance 9%, Psychosocial Integrity 9%, Basic Care and Comfort 9%.
- Language: use NCLEX's own terms (client, primary health care provider, prescription versus order, unlicensed assistive personnel) and its question-stem phrases (first, priority, most important, requires follow-up, further teaching is needed, select all that apply). Include the US units he will meet (°F, lb) next to metric.
- A "Reportar" (Report) button on each feedback card flags a case Julio thinks is clinically wrong. He is a working nurse, so his flags are the best review there is. Store flags for Hassan.
- `vocab-seed.json`: about 150 NCLEX terms and stem phrases with Spanish glosses and Client Needs areas, derived from the 2026 test plan's activity statements. The Vocab screen has a "Términos NCLEX" (NCLEX terms) tab listing them by area, each with "Guardar" (Save) to add it to review.

## 11. Grading (IELTS)

- `/api/grade` streams from `GRADE_MODEL` with structured outputs (`output_config.format` with a JSON schema, generally available), so parse failures can't happen. Retry once only on `max_tokens`, a refusal or a network error. `maxDuration` 300.
- Start the request when the closing line begins, not when it ends. Parse the stream with a partial-JSON parser and render each criterion as soon as its object closes.
- The first grade after a schema change, or after 24 hours without grading, pays a one-time grammar compile; the p95 in section 3 absorbs it.
- Inputs: the transcript labeled by part and question; per-turn metrics (speaking time, words, words per minute, pauses over 1 s and over 2 s, time to first word, average recognizer confidence, low-confidence words); the saved words due for review; his level; and which questions he used "Ayuda" on.
- Prompt rules:
  - Include the official public IELTS Speaking band descriptors verbatim (download from ielts.org into `api/prompts/ielts-descriptors.md`).
  - Per criterion: quote evidence first, then assign a whole band. When torn between two bands, choose the lower one: the tool must not flatter when the bar is 7.0.
  - The transcript is machine-recognized: no punctuation, fillers removed, some words wrong. Don't penalize grammar for obvious recognition errors. Treat words that make no sense in context as possible pronunciation problems.
  - Use the fluency metrics for Fluency and Coherence; a transcript alone hides pauses.
- The overall score is computed in code, not by the model: the mean of the three graded criteria, rounded down to the nearest half band, labeled "Banda estimada, sin pronunciación" (Estimated band, without pronunciation).
- Schema: every field required, no nulls or union types (this stays well inside the structured-output complexity limits), and ordered so the screen fills in as it streams. Structured outputs keep schema order, so `evidence` comes before `band` and the model commits to quotes before it scores:

```json
{
  "fluency_coherence":   { "evidence": ["..."], "band": 6, "advice_es": "..." },
  "lexical_resource":    { "evidence": ["..."], "band": 6, "advice_es": "..." },
  "grammatical_range":   { "evidence": ["..."], "band": 6, "advice_es": "..." },
  "pronunciation_proxy": { "flagged": [ { "heard": "...", "likely": "..." } ], "note_es": "..." },
  "top_fixes_es": ["...", "...", "..."],
  "next_focus_es": "...",
  "upgraded_answers": [ { "part": 2, "question": "...", "original": "...", "better": "...", "why_es": "..." } ],
  "saved_words_used": ["..."],
  "vocab_to_learn": [ { "word": "...", "es": "...", "example": "...", "exam": "ielts", "nclex_area": "none" } ]
}
```

- `exam` is one of ielts, nclex or both; `nclex_area` is one of the eight Client Needs areas or none. Compare enum values case-insensitively.
- `upgraded_answers`: 2 of his weakest answers, rewritten at his level's target (band 6, 7 or 7.5), never band 9. He needs a model one step above him, not one he can't reach. `top_fixes_es` and `next_focus_es` follow the level's advice focus.
- A saved word counts toward mastery each time it appears in `saved_words_used`; 3 correct uses marks it mastered.
- All advice in Spanish; evidence quotes stay in English.

## 12. Persistence (Supabase)

- `profile`: one row: level, ielts_test_date, pause_p90, placement_done bool, updated_at.
- `sessions`: id (uuid generated on the client; upsert, so retries are safe), started_at, exam (ielts, clinical, toefl), mode, level, season, topic_ids text[], transcript jsonb, metrics jsonb (latency, fluency, recognizer engine, voice), grade jsonb, overall numeric.
- `vocab`: word (unique, lowercase), es, example, exam_tags text[], nclex_area, first_seen_session, times_seen, times_used_correctly, mastered bool.
- `case_flags`: case_id, session_id, note, created_at.
- `usage`: day, sessions.
- `heartbeat`: one row, updated daily by the cron.
- Save once at the end with retry and backoff. Saving never blocks the results screen.
- History: sessions with overall band and level; a line chart of overall and each criterion with a 7.0 target line, drawn from full tests only (practice sessions appear as separate dots marked with their level, since support at lower levels makes them easier); tap in to reread the transcript and feedback. Vocab: saved words with exam tags and a mastered toggle; Home shows up to 10 words due for review.
- Hassan reads the Supabase project directly; no admin UI in v1.

## 13. UI

- Spanish UI throughout, with correct accents. Exam content and the examiner voice stay in English.
- Home: "Empezar examen" (Start exam); mode selector with "Examen completo" (Full test), "Solo Parte 1" (Part 1 only), "Partes 2 y 3" (Parts 2 and 3), "Práctica rápida" (Quick practice) and "Clínico NCLEX" (Clinical NCLEX); his level ("Nivel 2") with a one-line Spanish description; last full-test score and distance to 7.0; mic check (runs on first use and on demand: records 3 s, plays it back, shows the transcript and a level meter, asks about headphones, speaks one examiner line). Settings: voice and accent, level (manual override), headphones, and the optional IELTS test date.
- Level changes: when the rules in section 7 suggest moving up or down, the results screen shows a short Spanish card with "Subir de nivel" (Move up) or "Bajar de nivel" (Move down) and "Todavía no" (Not yet).
- Exam screen: minimal. State indicator "hablando / escuchando / pensando" (speaking / listening / thinking), mic level, live interim transcript, timers, cue card in Part 2, "Repetir pregunta" (Repeat question), "Ayuda" (Help) at Niveles 1 and 2, "Terminar" (End), and a small spacebar hint for "Listo" (Done). No feedback of any kind.
- Results: local stats instantly (speaking time, words per minute, long pauses, time to first word), then criteria stream in, top 3 fixes, upgraded answers side by side with a "Reintentar" (Try again) button: the examiner re-asks that question, Julio answers again, and a quick `EXAMINER_MODEL` call compares the two attempts in two lines of Spanish. Vocab list with "Guardar" (Save) per word. Optional replay of his Part 2 answer (MediaRecorder, kept in memory, never uploaded).
- Keep the exam route small: no chart library and no Supabase client in it. History is a lazy-loaded route.
- Render the interim transcript at most once per animation frame; one timer tick drives every clock.
- Mobile layout is not required for v1, but don't break at narrow widths.
- First-run banner if the browser is not Edge or Chrome: explain in Spanish that the app needs Edge or Chrome for speech recognition, and that Edge has the most natural voices.

## 14. Non-goals for v1

- No Reading, Writing or Listening modules, and no NCLEX written-item practice (Phase 2).
- No user accounts beyond the passphrase. No audio sent to our servers (the browser's own recognizer is the only thing that sends audio anywhere). No pronunciation band.
- No TOEFL mode, but keep the seam at the exam-definition level (`/src/exams`), not just the JSON. The TOEFL iBT Speaking section changed on January 21, 2026 to Listen and Repeat (7 items) and Take an Interview (4 questions, 45 s each, no preparation), scored 1 to 6, and VisaScreen now asks RNs for 4.5 overall and 4.5 Speaking. A TOEFL swap means a new script and rubric.

## 15. Phase 2 preview: NCLEX written practice (don't build; leave seams)

NGN item formats (multiple response or select all that apply, matrix, drop-down cloze, drag-and-drop, bowtie, highlight) and 6-item case studies that follow the six clinical judgment steps; Spanish rationales; a stem decoder that highlights what each question is really asking; tap-to-translate on any term; missed terms flow into the shared vocab table tagged nclex. The v1 seams: the `exam` column, the shared vocab table, `/src/exams`, and Client Needs tags on cards and cases.

## 16. Definition of done

- A full test runs hands-free on Edge, with headphones and with laptop speakers, with no clicks between turns.
- Latency meets section 3: p50 on target, p95 examiner-after-commit at or under 1.2 s, numbers visible in the debug overlay and saved in metrics.
- A 2-minute Part 2 monologue in Chrome loses no text across recognizer restarts.
- In Part 3, a 4-second pause right after "because" does not end the turn.
- Cutting the network during Part 3 doesn't stall the exam (scripted fallback), and the session saves when the network returns.
- Grading always returns schema-valid JSON, and the criteria appear progressively.
- `validate-bank.ts` passes: at least 40 Part 1 topics; at least 50 Part 2 cards, each with a linked Part 3 set that has rephrases and follow-ups; at least 20 current-season cards; at least 12 health cards, each with an NCLEX area; every card has 5 useful words and 3 help phrases; every Part 3 set has at least 2 concrete and 2 abstract questions, each with help phrases.
- Clinical: at least 60 cases that passed the independent check, distributed per the test plan weights, each with a key action, a Spanish rationale, short and full versions, and a difficulty; at least 15 cases at each difficulty.
- Levels: switching level visibly changes speech rate, Part 2 timing, help, Part 3 order and upgraded-answer band; a full test runs at Nivel 3 conditions from any level; placement and move-up/move-down suggestions follow section 7 on seeded test data.
- A 5-word utterance starting with "Sorry" that is a real answer is committed as an answer, not treated as a repeat request.
- Sessions, grades, vocab and case flags persist; History and Vocab work; the keepalive cron is deployed; the passphrase gate and daily cap work.

## 17. Build order

1. Speech layer and the `/lab` page: recognizer, synthesizer, VAD, echo handling, latency logging. Get it right on Edge (headphones and speakers) and on Chrome first.
2. Engine with the scripted opening, Part 1 and Part 2 on a hardcoded set; endpointing; voice commands.
3. Part 3 examiner endpoint with speculative prefetch and fallback.
4. Bank build and validation scripts, seasonal selection, `/api/session-start` (token, cap, selection).
5. Grading (streamed, structured) and the results screen with local stats and "Reintentar".
6. Supabase persistence, History, Vocab, keepalive cron; deploy with the passphrase gate and cap. Julio can start using it here.
7. Levels, "Ayuda" and quick practice (the level values live in `/src/levels`, so this is mostly wiring).
8. Clinical mode on the same engine, with its level settings.

## Changes from v1

- Exam facts re-verified in September 2026: IELTS minimums unchanged by HRSA's May 12, 2026 update; the 2026 NCLEX-RN Test Plan applies; the TOEFL Speaking section was redesigned in January 2026; Interstaff lists NCLEX before IELTS.
- Speed: Parts 1 and 2 are scripted with no model calls; Part 3 uses speculative prefetch with a scripted fallback; the database is out of the turn loop; stateless session tokens; the cap counts graded sessions instead of requests.
- Speech: an always-on recognizer with pre-emptive restarts and stall detection, adaptive endpointing, voice "repeat" commands, VAD, echo handling, TTS watchdogs, accent rotation.
- Questions: the Hugging Face dataset is dropped; a seasonal bank is built from reported topic titles, refreshed each season and matched to Julio's test date; every Part 2 card has a Part 3 set with rephrases and follow-ups; health cards drop from 40% to about 25% of draws and are tagged with NCLEX areas.
- New Clinical mode aligned to the 2026 NCLEX-RN Test Plan, with independently checked cases and an NCLEX terms list.
- Grading: `claude-opus-5-5` with structured outputs, streamed and rendered progressively; fluency metrics feed the grader; a conservative overall is computed in code.
- Cost safety: the cap is checked at grading time, a client guard limits examiner calls, and a Console spend limit backs both.
- Supabase: server-only access, explicit grants, keepalive cron, and the app keeps working if the database is down.
- v2.1: three difficulty levels that change support, pacing and feedback targets but never the topics, with placement, suggested level changes and full tests always at real-exam conditions; a Spanish "Ayuda" panel; a 5-minute quick practice mode; clinical cases tagged by difficulty; a one-time note to Julio about headphones, a quiet room and where the audio goes.

## Reference links

- Interstaff TN program and timeline: https://www.interstaffinc.com/tn-visa-program-mexico/
- TruMerit VisaScreen (at-home tests not accepted): https://www.trumerit.org/services/certification/visascreen-visa-credentials-assessment/
- HRSA English test scores for foreign health care workers: https://www.hrsa.gov/office-global-health/foreign-healthcare-worker-requirements
- 2026 NCLEX-RN Test Plan: https://www.nclex.com/test-plans.page
- Claude models: https://platform.claude.com/docs/en/models/overview
- Structured outputs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Prompt caching: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- Vercel function duration: https://vercel.com/docs/functions/configuring-functions/duration
- Supabase free project pausing: https://supabase.com/docs/guides/platform/free-project-pausing
- Web Speech API (MDN): https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
