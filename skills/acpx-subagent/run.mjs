import { spawn } from "node:child_process";
import { appendFileSync, closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { constants, homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";

const root = join(homedir(), ".acpx");
const lock = join(root, "acpx-subagent.lock");
const owner = join(lock, String(process.pid));
const stamp = join(root, "acpx-subagent.last");
const windows = process.platform === "win32";
const abort = new AbortController();
const options = [];
const flags = { interval: "15" };
const timeScale = Number(process.env.ACPX_SUBAGENT_TIME_SCALE ?? "1");
const waitLimit = 30 * 60 * 1000 * timeScale;
const timeoutMessage = "Unfinished tool calls after 30 minutes waiting";
const ending = 'Run builds and tests synchronously in the foreground. No background daemons or unsolicited plan/artifact files. Return "## Summary" first: concise bullets for changed files, verification, decisions, and unresolved issues. Follow with "## Detailed Notes".';
const followup = 'The command is still running. Keep checking its status and do not reply until it has finished, then give the final report with "## Summary" first.';
const tools = new Map();
let held = false;
let child;
let interrupted = 0;
let temporary;
let prompt;
let log;
let output;
let session;
let created = false;
let reply = "";
let deadline;

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

function short(text) {
  const line = String(text).replace(/\s+/g, " ").trim();
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

function activity(text) {
  process.stdout.write(`${text}\n`);
}

function unfinished() {
  return [...tools.values()].some((tool) => !["completed", "failed"].includes(tool.status));
}

function event(message, turn) {
  if (log !== undefined) appendFileSync(log, `${JSON.stringify(message)}\n`);
  const update = message.params?.update;
  if (update?.sessionUpdate === "user_message_chunk") reply = "";
  if (update?.sessionUpdate === "agent_message_chunk" && update.content?.type === "text")
    reply += update.content.text;
  if (update?.sessionUpdate === "agent_thought_chunk" && update.content?.text)
    activity(`Thought: ${short(update.content.text)}`);
  if (["tool_call", "tool_call_update"].includes(update?.sessionUpdate)) {
    const previous = tools.get(update.toolCallId);
    const title = update.title ?? previous?.title ?? update.toolCallId;
    const status = update.status ?? previous?.status ?? "pending";
    if (previous?.title !== title || previous?.status !== status)
      activity(`Tool: ${short(title)} [${status}]`);
    tools.set(update.toolCallId, { title, status });
  }
  if (message.method === "session/request_permission")
    activity(`Permission: ${short(message.params?.toolCall?.title ?? "request")} (${message.params?.options?.map((option) => option.kind).join(", ") ?? ""})`);
  if (message.error) throw new Error(`acpx: ${JSON.stringify(message.error)}`);
  if (message.result?.stopReason) {
    turn.stopped = true;
    activity(`Stop: ${message.result.stopReason}`);
    if (message.result.usage) {
      const usage = message.result.usage;
      activity(`Usage: ${usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)} tokens`);
    }
  }
}

async function run(args, turn = {}, expires) {
  if (interrupted) throw new Error("Interrupted");
  const argv = ["-y", "acpx@latest", "--format", "json"];
  if (flags.model !== undefined) argv.push("--model", flags.model);
  argv.push(flags.agent, ...args);
  if (windows && argv.some((value) => /[^a-zA-Z0-9 .:\\/@=,+_~-]/.test(value)))
    throw new Error("Windows arguments must contain only letters, digits, spaces, or . : \\ / @ = , + - _ ~");
  const command = ["npx", ...argv].map((value) => / |^$/.test(value) ? `"${value}"` : value).join(" ");
  child = windows ? spawn(command, { shell: true, stdio: ["ignore", "pipe", "inherit"] })
    : spawn("npx", argv, { stdio: ["ignore", "pipe", "inherit"] });
  let expired = false;
  const timer = expires === undefined ? undefined : globalThis.setTimeout(() => {
    if (!unfinished()) return;
    expired = true;
    child?.kill("SIGTERM");
  }, Math.max(0, expires - performance.now()));
  let parseError;
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    if (!line.trim() || parseError) return;
    try { event(JSON.parse(line), turn); }
    catch (error) { parseError = error; }
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve(code ?? (signal ? 128 + constants.signals[signal] : interrupted || 1)));
  }).finally(() => clearTimeout(timer));
  child = undefined;
  if (expired) throw new Error(timeoutMessage);
  if (code) throw Object.assign(new Error(`acpx exited with code ${code}`), { exitCode: code });
  if (parseError) throw parseError;
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  interrupted = 128 + constants.signals[signal];
  abort.abort();
  child?.kill(signal);
});

try {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index].slice(2);
    const value = args[index + 1];
    if (!args[index].startsWith("--") || !["agent", "prompt", "output", "log", "model", "option", "session", "interval"].includes(key) || value === undefined)
      throw new Error("Usage: run.mjs --agent <alias> --prompt <file> --output <file> [--log <file>] [--model <id>] [--option <key>=<value>]... [--session <name>] [--interval 15]");
    if (key === "option") {
      const separator = value.indexOf("=");
      if (separator < 1) throw new Error("--option requires key=value");
      options.push([value.slice(0, separator), value.slice(separator + 1)]);
    } else flags[key] = value;
  }
  const seconds = Number(flags.interval);
  if (!Number.isFinite(timeScale) || timeScale <= 0 || timeScale > 1) throw new Error("Invalid time scale");
  if (!flags.agent || !flags.prompt || !flags.output || !Number.isSafeInteger(seconds) || seconds < 1 || seconds > 86400)
    throw new Error("Require --agent, --prompt, --output and --interval 1..86400");
  const task = readFileSync(flags.prompt, "utf8");
  output = openSync(flags.output, "w", 0o600);
  if (flags.log !== undefined) log = openSync(flags.log, "w", 0o600);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  try { mkdirSync(lock, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const entries = readdirSync(lock);
    const pid = Number(entries[0]);
    if (entries.length !== 1 || !Number.isSafeInteger(pid) || pid < 1) throw new Error("Gate busy; owner not published");
    if (alive(pid)) throw new Error("Gate busy");
    // Only the caller that removes this exact dead PID may remove the directory.
    unlinkSync(join(lock, entries[0]));
    rmdirSync(lock);
    mkdirSync(lock, { mode: 0o700 });
  }
  held = true;
  writeFileSync(owner, "", { mode: 0o600 });
  let last = 0;
  try { last = statSync(stamp).mtimeMs; } catch (error) { if (error.code !== "ENOENT") throw error; }
  await setTimeout(Math.max(0, last + seconds * 1000 - Date.now()), undefined, { signal: abort.signal });
  temporary = mkdtempSync(join(tmpdir(), "acpx-subagent-"));
  prompt = join(temporary, "prompt.txt");
  writeFileSync(prompt, `${task}\n\n${ending}\n`, { mode: 0o600 });
  session = flags.session ?? `task-${randomUUID()}`;
  await run(["sessions", "ensure", "--name", session]);
  created = true;
  for (const [key, value] of options) await run(["set", key, value, "-s", session]);
  for (let count = 0; ; count++) {
    reply = "";
    const turn = {};
    await run(["-s", session, "--file", prompt], turn, deadline);
    if (!turn.stopped) throw new Error("acpx ended without a stop reason");
    if (!unfinished()) break;
    deadline ??= performance.now() + waitLimit;
    const delay = Math.max(seconds, Math.min(15 * 2 ** Math.min(count, 3), 120)) * 1000 * timeScale;
    await setTimeout(Math.max(0, Math.min(delay, deadline - performance.now())), undefined, { signal: abort.signal });
    if (performance.now() >= deadline) throw new Error(timeoutMessage);
    const notice = `Follow-up: ${followup}`;
    activity(notice);
    if (log !== undefined) appendFileSync(log, `${notice}\n`);
    writeFileSync(prompt, `${followup}\n`, { mode: 0o600 });
  }
  if (!/^## Summary\s*$/m.test(reply))
    throw Object.assign(new Error('Final reply has no "## Summary" heading'), { exitCode: 2 });
} catch (error) {
  if (!interrupted) console.error(`${error.message}; gate: ${lock}`);
  process.exitCode = interrupted || error.exitCode || 1;
} finally {
  if (created && flags.session === undefined && !interrupted) {
    try { await run(["sessions", "close", session]); }
    catch (error) {
      console.error(`Session cleanup: ${error.message}`);
      process.exitCode ||= error.exitCode || 1;
    }
  }
  if (output !== undefined) {
    try { writeFileSync(output, reply); closeSync(output); activity(`Output: ${flags.output}`); }
    catch (error) { console.error(`Output: ${error.message}`); process.exitCode ||= 1; }
  }
  if (temporary) {
    try { unlinkSync(prompt); rmdirSync(temporary); }
    catch (error) { console.error(`Prompt cleanup: ${error.message}`); process.exitCode ||= 1; }
  }
  if (log !== undefined) closeSync(log);
  if (held) {
    try {
      writeFileSync(stamp, "", { mode: 0o600 });
      unlinkSync(owner);
      rmdirSync(lock);
    } catch (error) {
      console.error(`${error.message}; gate cleanup: ${lock}`);
      process.exitCode = 1;
    }
  }
}
