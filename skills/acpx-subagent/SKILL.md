---
name: acpx-subagent
description: Delegate a bounded task to an external ACP agent through acpx. Use when asked to use acpx or an external ACP coding agent, including named-session follow-ups.
---

## Prepare

- Require Node.js >=22.13 with npm/npx, the requested ACP agent on PATH, and completed sign-in. Use its configured alias or built-in; never substitute agent, model, or effort.
- Check `git status` and `git diff`; preserve existing changes. Create a private OS-temporary directory for prompt and output files.
- Write a self-contained prompt: scope, source paths, constraints, acceptance checks. Exclude harness/role/skill names, session logs, XML scaffolding, and references to parent configuration or handovers.
- End with:

  > Run builds and tests synchronously in the foreground. No background daemons or unsolicited plan/artifact files. Return "## Summary" first: concise bullets for changed files, verification, decisions, and unresolved issues. Follow with "## Detailed Notes".

## Run

Resolve the adjacent `gate.mjs` to an absolute path without changing cwd. Wrap every agent-contacting command, including session creation and `set`:

```sh
node "<skill-directory>/gate.mjs" 15 -- npx -y acpx@latest --format quiet <agent> exec --file "<prompt path>" > "<output path>" 2>&1
```

- Calls may take many minutes: use a long tool timeout or disable it. A timed-out call may still be running; stop and inspect before further calls.
- Always send prompt text through `--file`. On Windows the gate rejects arguments with shell metacharacters.
- Keep the prefix, redirection, and wrapper for all commands. `exec` saves no session. For follow-ups, run `<agent> sessions ensure --name <name>`, check success, then replace `exec` with `-s <name>`. Keep the same agent, cwd, and name.
- Add global `--model <exact-id>` only when requested. For effort, verify advertised option IDs/values: one-off `exec --config-option <key>=<value>`, or gated `<agent> set <key> <value> -s <name>`. Check the [CLI reference](https://github.com/openclaw/acpx/blob/main/docs/CLI.md) or current help when needed; never guess.
- No `--no-wait`, background shell execution, automatic retries, or approval-bypass flags.

## Inspect

- Read the first 60 output lines; expand only as needed. Quiet format suppresses tool/thinking events, not errors or npm diagnostics.
- Check `git status` and `git diff` afterward; verify claimed checks. External edits are outside the calling harness's undo.
- On quota, authentication, rate-limit, unavailable-agent, or uncertain-completion failures, stop and report status/output path; do not retry or switch agents.

## Gate

- One OS-user gate covers all agents/repos, waits 15 seconds after release, and releases on exit or handled interruption. Keep the same home directory. Live owners fail immediately; dead PIDs are reclaimed, never by age.
- `~/.acpx/acpx-subagent.lock` contains a PID-named owner file. Forced termination can leave children running; client exit does not prove remote completion. Never delete locks or retry blindly.
