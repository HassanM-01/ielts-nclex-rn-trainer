# Messages for Claude Code

Paste these into Claude Code as written. Replace anything in [brackets].

## 1. First session (paste once)

```
Read CLAUDE.md, then SPEC.md in full, then PROGRESS.md.

We're starting build step 1 (speech layer and the /lab page). Before writing code:
1. Summarize in a few lines what you understand the app to be and what step 1 includes.
2. List any questions or problems you see in the spec, especially anything in sections 3, 6 and 17.
3. Give me a short plan for step 1: files you'll create, how the recognizer, synthesizer and VAD fit together, and what the lab page will show me.

Wait for my go-ahead before building. After step 1 is built and typecheck, tests and build pass, update PROGRESS.md with the checkpoint instructions and stop so I can test the lab page on Edge and Chrome.
```

## 2. Every later session (resume)

```
Read CLAUDE.md and PROGRESS.md, then the SPEC.md sections for the current step. Tell me where things stand and what you need from me, then continue.
```

## 3. Reporting a checkpoint result

Copy the matching checklist from HUMAN_GUIDE.md, fill it in, and paste it with this on top:

```
Checkpoint result for step [N]. Record this in PROGRESS.md.

Passed:
- [what worked]

Problems (in order of importance):
- [what happened, which browser, headphones or speakers, what you expected]

Numbers from the Shift+D overlay:
- [paste them]

Fix the problems, then tell me what to retest. If there are no problems, mark the step done and plan the next step, then wait for my go-ahead.
```

## 4. Starting the next step

```
Step [N] is done. Plan step [N+1]: what you'll build, anything you need from me first (keys, accounts, decisions), and what I'll test at the end. Wait for my go-ahead.
```

## 5. If Claude Code drifts

Use any of these when needed:

- `Stop. Check SPEC.md section [X] before continuing; what you're doing doesn't match it.`
- `Don't change the stack or scope. Propose the change and why, and wait for me.`
- `Before anything else, update PROGRESS.md with where you are.`
- `That's outside the current step. Note it in PROGRESS.md under open questions and keep going with step [N].`
