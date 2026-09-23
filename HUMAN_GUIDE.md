# Hassan's Build Guide

What you do, and when, while Claude Code builds Julio's trainer. Claude Code writes the code; you handle accounts and keys, test the parts only a human can test (talking and listening), review the generated questions, and bring Julio in.

Plan on 3 or 4 sittings. Each stage below says when it happens, roughly how long it takes you, what to do, and what to report back. The messages to paste into Claude Code are in KICKOFF.md.

## How a sitting works

1. Open a terminal in the repo folder and run `claude` (or open the folder in the Claude desktop app).
2. Paste the resume message from KICKOFF.md (the kickoff message the first time).
3. Read its plan. Say "go" or correct it.
4. Let it build. Approve commands when it asks. Anything that touches your accounts or keys, you do yourself from this guide.
5. When it stops at a checkpoint, run the test in the matching stage below and paste the result using the report template in KICKOFF.md.

If a session gets long or confused, end it and start a fresh one with the resume message. PROGRESS.md carries everything over.

---

## Stage 0: Before the first session (about 20 minutes)

**Tools** (skip what you already have):
- Node.js LTS (nodejs.org). Check with `node -v`.
- Git. Check with `git --version`.
- Claude Code. Check with `claude --version`.
- Microsoft Edge and Google Chrome.
- Wired or Bluetooth headphones with a mic, or headphones plus the laptop mic.

**Repo:**
1. On GitHub, create a new **private** repo, for example `julio-english`. No template.
2. Clone it: `git clone <repo URL>` and `cd` into it.
3. Put these files in the root: `SPEC.md`, `CLAUDE.md`, `PROGRESS.md`, `HUMAN_GUIDE.md`, `KICKOFF.md`, `.env.example`.
4. Commit and push them: `git add . && git commit -m "Planning docs" && git push`.

**Start:** run `claude` in the folder and paste message 1 from KICKOFF.md.

---

## Stage 1: Test the speech lab (after build step 1, about 20 minutes)

This is the most important checkpoint. If the voice feels wrong here, everything after it feels wrong. Take your time.

Claude Code will tell you the command (probably `npm run dev`) and the URL (probably `http://localhost:5173/lab`).

**Test on Edge with headphones:**
- [ ] The mic check records 3 seconds, plays it back, and shows what you said correctly.
- [ ] The examiner voice sounds natural (a "Natural" Microsoft voice is selected in the voice picker). Try a British, American and Australian voice.
- [ ] Say a few normal sentences. The live transcript keeps up and nothing is missing.
- [ ] 2-minute monologue test: read a news article out loud for the full 2 minutes. Afterwards, compare the transcript to the article. Note any missing words or sentences, especially around the 45 to 60 second mark (that's where restarts happen).
- [ ] Barge-in: while the examiner is talking, start talking. It should stop and let you speak.
- [ ] Forced restart button: press it mid-sentence. Keep talking. Note if any words got lost.

**Test on Edge with laptop speakers (no headphones):**
- [ ] Turn headphones off in the lab settings. Let the examiner talk. Its voice should **not** show up in your transcript.
- [ ] Barge-in should be off. Talking over the examiner should not cut it off.
- [ ] Volume: when the mic turns on, does the examiner get quieter? If yes, report it. (Fix to try: Windows Control Panel > Sound > Communications tab > "Do nothing". Tell Claude Code whether that fixed it.)

**Repeat the headphone tests on Chrome.** The voices will sound more robotic in Chrome; that's expected. What matters is that recognition works.

**Report back:**
- Which tests passed and failed, per browser.
- Any lost words in the monologue test (roughly where).
- The latency numbers from the Shift+D overlay.
- How the voice felt: natural or robotic, too fast or slow.

---

## Stage 2: Test the scripted exam (after build step 2, about 20 minutes)

This runs the opening, Part 1 and Part 2 with a fixed set of questions. No AI yet, so the examiner should respond almost instantly.

Use Edge with headphones. Answer like a real candidate would.

- [ ] Opening: greets you, asks your name, asks to see ID, moves to Part 1.
- [ ] After you finish an answer and go quiet, the next question comes in about 2.5 to 3 seconds. Not so fast it cuts you off, not so slow it feels dead.
- [ ] Say "I think it's important because..." then pause for 4 seconds. It should **not** move on.
- [ ] Say only "Sorry?" It should repeat the question word for word.
- [ ] Say "Sorry, I don't really like shoes." It should count that as your answer, not repeat the question.
- [ ] Talk for more than 40 seconds on one Part 1 answer. The examiner should politely cut in and move on, and it shouldn't pick up your leftover words as the next answer.
- [ ] Part 2: cue card appears with 3 bullets and an "explain" line; 1 minute prep with a notes box; "Please start speaking now"; stops you at exactly 2:00.
- [ ] Stop talking early in Part 2 (around 1:00). After about 4 seconds it should give one prompt to continue.
- [ ] Press spacebar mid-silence. It should move on immediately.
- [ ] Reload the page mid-exam. It should offer to resume.

**Report back:** what passed, what failed, how the pacing felt, and the Shift+D numbers.

---

## Stage 3: Vercel and Anthropic setup, then test Part 3 (before and after build step 3, about 30 minutes)

Claude Code will ask for this before it starts step 3, because Part 3 is the first part that calls the AI.

### 3a. Anthropic API key (10 minutes)

1. Go to the Claude Console at platform.claude.com and sign in.
2. Make sure billing is set up and has credit. $20 covers the whole build and many weeks of Julio's practice.
3. Create a new API key named `julio-trainer`. (If you like keeping things separate, create a workspace for this app first and make the key inside it.) Copy the key somewhere safe; you only see it once.
4. In the Console's limits settings, set a monthly spend limit. $25 is plenty to start.

### 3b. Vercel project (15 minutes)

1. Go to vercel.com, sign in with GitHub.
2. Add New > Project > import the `julio-english` repo. Framework preset: Vite. Deploy. (The first deploy may be a bare page; that's fine.)
3. Project > Settings > Environment Variables. Add, for all environments:
   - `ANTHROPIC_API_KEY` = your key
   - `EXAMINER_MODEL` = `claude-haiku-4-5-20251001`
   - `GRADE_MODEL` = `claude-opus-5-5`
4. On your computer, in the repo folder:
   - `npm i -g vercel`
   - `vercel login`
   - `vercel link` (choose the project you just made)
   - `vercel env pull .env.local` (this brings the variables down for local testing; it's already ignored by git, but double-check `.env.local` is in `.gitignore`)
5. Tell Claude Code: "Vercel is linked and ANTHROPIC_API_KEY, EXAMINER_MODEL and GRADE_MODEL are set. .env.local is pulled."

### 3c. Test Part 3 (after step 3 is built, about 15 minutes)

- [ ] Part 3 questions are about the same theme as the Part 2 card.
- [ ] Sometimes the examiner asks a follow-up about something **you** said ("You mentioned X. Why do you think...?"). It should never praise you or correct you.
- [ ] The gap after your answer in Part 3 feels about as quick as Part 1. Check the Shift+D overlay: the Part 3 number should mostly be under about 1 second.
- [ ] Turn off Wi-Fi in the middle of Part 3. The exam should keep going with the next question from the bank, not freeze. Turn Wi-Fi back on.
- [ ] Part 3 ends after about 4 to 5 minutes with "That is the end of the speaking test."

**Report back:** pass/fail, whether follow-ups felt natural, and the Part 3 latency numbers.

---

## Stage 4: Passphrase, then review the question bank (before and after build step 4, about 45 minutes)

### 4a. Before step 4 (5 minutes)

1. Pick the passphrase Julio will type. Make it easy to type on a Spanish keyboard (no ñ, no accents), for example `enfermero2027`.
2. Generate a session secret. In a terminal: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. Add to Vercel env vars: `APP_PASSPHRASE`, `SESSION_SECRET`, `DAILY_SESSION_CAP` = `12`. Run `vercel env pull .env.local` again.

### 4b. Approve the bank build

Claude Code will show an estimated cost before generating the question bank. Expect roughly $5 to $15 one time, covering the IELTS questions, clinical cases (built in step 8, possibly generated now) and the NCLEX term list. Approve if it's in that range; ask why if it's much higher.

### 4c. Review a sample (30 minutes)

Ask Claude Code: "Show me 8 random Part 2 cards with their Part 3 sets, and 5 random Part 1 topics, in a readable format." Check:

- [ ] Cards read like real IELTS cue cards: "Describe a ...", then "You should say:" with 3 bullets, then "and explain ...".
- [ ] Part 3 questions are on the card's theme but broader (society, comparisons, the future), not personal repeats of Part 2.
- [ ] Each Part 3 set has some concrete questions ("Do people in your country...") and some abstract ones ("Why do some societies...").
- [ ] Help phrases sound like something a strong candidate would actually say.
- [ ] The Spanish glosses look right. You read Spanish well enough to catch obvious mistakes; if unsure, ask Claude Code to double-check any gloss.
- [ ] Nothing reads as copied from a prep website (long model answers, site names).
- [ ] The season file includes the September to December 2026 topics listed in SPEC.md section 9.

Also run `npm run bank:validate` yourself and confirm it passes.

**Report back:** anything that sounds off, with the card ID.

---

## Stage 5: Calibrate the grading (after build step 5, about 40 minutes)

Two full tests, played as two different people. This tells you whether the scores can be trusted.

**Test A, as yourself.** Answer naturally and fully. Expected: bands around 8 or higher. (Pronunciation isn't scored, so the estimate uses the other three criteria.)

**Test B, as a B1 speaker.** Short answers, simple present tense, basic vocabulary, a few mistakes ("I go to hospital yesterday"), long pauses. Expected: around 4.5 to 5.5.

For both:
- [ ] Local stats (speaking time, words per minute, pauses) appear instantly.
- [ ] The first band shows up within about 30 seconds and the rest stream in.
- [ ] Evidence quotes are things you actually said.
- [ ] Advice is in Spanish and specific ("usa conectores como...", not "practica mas").
- [ ] Upgraded answers are one step above: not wildly fancier than what you said.
- [ ] "Reintentar": the examiner asks the same question, you answer again, and you get a 2-line comparison in Spanish.

If Test A scores below 7.5 or Test B above 6, the grading is off. Report both scores and paste one criterion's evidence and band so Claude Code can adjust the prompt.

**Report back:** both scores per criterion, time to first band, anything odd.

---

## Stage 6: Supabase, deploy, and bring in Julio (before and after build step 6, about 45 minutes)

### 6a. Supabase (15 minutes)

1. Go to supabase.com, sign in, New project, name it `julio-trainer`.
2. Region: **East US (North Virginia)** (same area as the Vercel functions, for speed).
3. Save the database password somewhere safe (you won't need it day to day).
4. Project Settings > API Keys: copy the **secret** key (starts with `sb_secret_`). Never use it anywhere except Vercel env vars.
5. Copy the project URL (Project Settings > Data API, or the project home page).
6. Add to Vercel env vars: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`. Generate another random string (same command as 4a) and add it as `CRON_SECRET`. Run `vercel env pull .env.local`.

### 6b. Run the database setup (5 minutes)

Claude Code will write migration files in `/supabase/migrations`. Ask it: "Give me the full SQL to run, in order." In Supabase, open SQL Editor, paste, Run. Tell Claude Code it succeeded (or paste the error).

### 6c. Deploy and check (15 minutes)

1. Tell Claude Code it can push to GitHub. Vercel deploys automatically.
2. Open the **production** URL (Vercel project page, "Domains"; it looks like `julio-english.vercel.app`). Preview URLs may ask for a Vercel login; production doesn't.
3. On Edge: enter the passphrase, do a full test.
- [ ] The session appears in Supabase (Table Editor > sessions).
- [ ] History shows it with the band and a chart point.
- [ ] Saving a vocab word shows up in Vocab and in the `vocab` table.
- [ ] Open the same URL on your phone: History shows the same session.
- [ ] Vercel project > Settings > Cron Jobs shows the keepalive job. The next day, the `heartbeat` row's timestamp has changed.

### 6d. Bring in Julio

Send him the link and passphrase. A draft you can send:

> Oye Julio, ya esta lista la app para practicar el speaking del IELTS. Entra desde la compu con Edge: [link]. La clave es: [passphrase]. Usa audifonos si puedes y busca un lugar tranquilo. La primera vez haz la prueba del microfono y luego un examen completo, asi la app sabe tu nivel. Si algo se ve raro o no funciona, me mandas captura.

> (Hey Julio, the app to practice IELTS speaking is ready. Open it on the computer with Edge: [link]. The password is: [passphrase]. Use headphones if you can and find a quiet place. The first time, do the microphone test and then a full exam, so the app knows your level. If anything looks weird or doesn't work, send me a screenshot.)

After his first session, check Supabase: the session saved, his transcript looks like what he'd say (if it's full of nonsense words, recognition is struggling; ask him about his mic and room), and the Shift+D-style metrics in `sessions.metrics` are within budget on his connection.

**Report back to Claude Code:** anything Julio mentions, plus his latency numbers from `sessions.metrics`.

---

## Stage 7: Test levels (after build step 7, about 20 minutes)

In settings, switch between Nivel 1, 2 and 3 and run "Partes 2 y 3" each time.

- [ ] Nivel 1: slower voice, 2 minutes of prep, useful words on the card, "Ayuda" button works and pauses the timer, Part 3 starts with concrete questions, fewer follow-ups.
- [ ] Nivel 3: normal speed, 1 minute of prep, no words on the card, no Ayuda, abstract Part 3 questions, follow-ups like the real test.
- [ ] Upgraded answers get more advanced from Nivel 1 to 3.
- [ ] "Examen completo" runs at Nivel 3 conditions even when set to Nivel 1.
- [ ] "Práctica rápida" takes about 5 minutes and gets graded.
- [ ] Ask Claude Code to seed fake sessions to show you the "Subir de nivel" (Move up) suggestion.

---

## Stage 8: Clinical mode (after build step 8, about 20 minutes)

You can't judge the nursing content, so this stage is split between you and Julio.

**You:**
- [ ] A session plays 3 cases; the vignette is read aloud, then shown.
- [ ] Your answers are recorded and the next case starts without waiting for grading.
- [ ] Feedback cards are ready at the end, in Spanish, with the key action and 2 or 3 NCLEX terms.
- [ ] "Reportar" on a feedback card saves a row in `case_flags`.
- [ ] The Vocab screen has the "Términos NCLEX" tab.

**Julio:** ask him to try it and to use Reportar on anything clinically wrong.

> Oye, le agregue a la app un modo clinico para el NCLEX. Te lee un caso de un paciente en ingles y tu contestas en voz alta que te preocupa y que harias primero. Pruebalo cuando puedas, y si ves algo que clinicamente esta mal, dale al boton de Reportar. Tu sabes mas de enfermeria que la app, entonces tus reportes me ayudan mucho.

> (Hey, I added a clinical mode to the app for the NCLEX. It reads you a patient case in English and you answer out loud what worries you and what you'd do first. Try it when you can, and if you see something that's clinically wrong, hit the Report button. You know more about nursing than the app, so your reports help me a lot.)

Every week or two, check `case_flags` and ask Claude Code to fix or remove flagged cases.

---

## Ongoing

**Weekly (5 minutes):**
- Glance at `sessions` in Supabase: how often he practices, and whether `overall` on full tests is trending up.
- Check `case_flags` for new reports.
- Check spend in the Claude Console.

**Each new IELTS season (early January, May and September, about 30 minutes):**
1. Search "IELTS speaking topics [January to April 2027]" and collect the new Part 1 topics and Part 2 cue card titles from 2 or 3 prep sites.
2. Put the titles (titles only) in `data/bank/ielts/seeds/2027-01.txt`.
3. In Claude Code: "New IELTS season. Build the season bank from seeds/2027-01.txt, set its dates, validate, and show me 8 cards to review." Review like stage 4c, then push.

**When Julio books his IELTS date:** set it in the app's settings so practice focuses on that season.

**If something breaks:**
- "Invalid passphrase" for Julio: check `APP_PASSPHRASE` in Vercel; changing it needs a redeploy.
- App loads but history is empty or saving fails: Supabase may be paused (free projects pause after a quiet week). Open the Supabase dashboard and restore it; then check the keepalive cron.
- Grading errors: check the Claude Console for billing or spend-limit issues.
- For anything else: open Claude Code, paste the resume message, describe what Julio saw, and ask it to check the Vercel logs with you.
