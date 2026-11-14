---
name: acpx-subagent
description: Delegate a bounded task to an external ACP agent through acpx. Use when asked to use acpx or an external ACP coding agent, including named-session follow-ups.
---

## Prepare

- Require Node.js >=22.13 with npm/npx, the requested ACP agent on PATH, and completed sign-in. Never substitute the requested agent, model, or options.
- Check `git status` and `git diff`; preserve existing changes. Create a private OS-temporary directory for the task prompt, reply, and event log.
- Write only the self-contained task to the prompt file: scope, source paths, constraints, acceptance checks. Keep the caller anonymous: exclude caller/role/skill names, session logs, XML scaffolding, and references to parent configuration or handovers.

## Run

Resolve the adjacent `run.mjs` to an absolute path without changing cwd:

```sh
node "<skill-directory>/run.mjs" --agent <alias> --prompt "<task file>" --output "<reply file>" [--log "<event log>"]
```

- Stdout streams terse activity, never reply text or tool output bodies, and ends with the reply file path. Stderr contains diagnostics. Optional `--log` records complete events and thoughts; tell the user its path so they can watch it with `tail -f` or their OS equivalent.
- Use a long or disabled tool timeout; calls can take many minutes. On non-zero exit or timeout, stop and report the exit status and file paths. Do not retry, switch agents, or delete the lock.
- Add `--model <exact-id>` or repeat `--option <key>=<value>` only as requested; values pass through unchanged. Use `--session <name>` for persistent follow-ups with the same agent and cwd. Otherwise the wrapper creates and soft-closes a unique session; stored history remains.
- The wrapper appends foreground-only build/test and report-format instructions, waits for unfinished tools using up to five follow-up turns, and requires a final `## Summary` heading. No background execution or approval-bypass flags.
- On Windows, argument values must contain only letters, digits, spaces, or `. : \ / @ = , + - _ ~`.

## Inspect

- Read the first 60 reply lines; expand as needed. Check `git status` and `git diff` afterward and verify claimed checks.
- One OS-user gate under `~/.acpx` covers all agents/repos. Keep the same home directory. Live owners fail immediately; dead PIDs are reclaimed, never by age. Cooldown is 15 seconds after release (`--interval` overrides it), including between internal follow-ups.
- Exit and handled interruption release the gate. Forced termination can leave children running; client exit does not prove remote completion.
