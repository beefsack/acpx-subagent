import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { constants, homedir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

const root = join(homedir(), ".acpx"), lock = join(root, "acpx-subagent.lock");
const owner = join(lock, String(process.pid)), stamp = join(root, "acpx-subagent.last");
const [interval, separator, command, ...args] = process.argv.slice(2), seconds = Number(interval);
const abort = new AbortController();
let held = false, child, interrupted = 0;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  interrupted = 128 + constants.signals[signal];
  abort.abort();
  child?.kill(signal);
});

try {
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 86400 || separator !== "--" || !command)
    throw new Error("Usage: gate.mjs <seconds: 1..86400> -- <command...>");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  try { mkdirSync(lock, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const entries = readdirSync(lock), pid = Number(entries[0]);
    if (entries.length !== 1 || !Number.isSafeInteger(pid) || pid < 1) throw new Error("Gate busy; owner not published");
    try { process.kill(pid, 0); throw new Error("Gate busy"); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
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
  const windows = process.platform === "win32";
  const quote = (value) => /\s/.test(value) ? `"${value}"` : value;
  child = spawn(windows ? quote(command) : command, windows ? args.map(quote) : args, {
    stdio: "inherit", shell: windows,
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve(code ?? (signal ? 128 + constants.signals[signal] : interrupted || 1)));
  });
} catch (error) {
  if (!interrupted) console.error(`${error.message}; gate: ${lock}`);
  process.exitCode = interrupted || 1;
} finally {
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
