# PROGRESS.md

Shared memory between Claude Code sessions. Claude Code updates this at the end of every session. Hassan fills in checkpoint results (or pastes them in chat and Claude Code records them).

## Current status

- **Current step:** 1 (speech layer and `/lab` page)
- **State:** not started
- **Waiting on:** nothing. Ready to begin.

## Step status

| Step | What | Status | Checkpoint result |
|---|---|---|---|
| 0 | Hassan's setup: repo, tools (HUMAN_GUIDE stage 0) | pending | |
| 1 | Speech layer and `/lab` page | pending | |
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
| GitHub repo created and cloned; SPEC.md, CLAUDE.md, PROGRESS.md, HUMAN_GUIDE.md, .env.example in root | step 1 | |
| Node.js LTS, Git, Claude Code installed; Edge and Chrome installed; headphones | step 1 | |
| Vercel account, CLI installed and logged in, project linked | step 3 | |
| Anthropic API key created, monthly spend limit set, key added to Vercel env vars | step 3 | |
| APP_PASSPHRASE and SESSION_SECRET chosen and added to Vercel env vars | step 4 | |
| Supabase project created (East US), secret key and URL added to Vercel env vars | step 6 | |
| Migrations run in Supabase | step 6 | |
| CRON_SECRET added; cron job visible in Vercel | step 6 | |
| Julio has the link and passphrase | after step 6 | |

## Last session

(none yet)

## Checkpoint for Hassan

(Claude Code fills this in when a step is built: what to test, how, what good looks like, what to report.)

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

## Open questions

(none)

## Known issues

(none)

## Cost log

| Date | What | Approx. cost |
|---|---|---|
