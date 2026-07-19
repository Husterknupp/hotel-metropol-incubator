// openclaw-adapter.js
// Triggers the OpenClaw agent via the CLI.
//
// `openclaw system event` is a heartbeat side-channel, not an immediate
// trigger: per docs/cli/system.md it only ever queues a `System:` line that
// gets flushed on the next heartbeat tick or user message, regardless of
// `--mode`. `openclaw agent` is the dedicated command for running one agent
// turn synchronously via the Gateway — the correct tool for "trigger the
// agent right now from a script". The turn always runs on the main session
// (full history/memory/tools, same as the OC TUI), but `--deliver` is what
// actually pushes the reply to Discord; omitting it runs the turn silently,
// which is a structural guarantee unlike relying on the model to end its
// reply with the NO_REPLY convention (that suppression only applies to a
// BARE silent token, not to visible text with NO_REPLY tacked on the end —
// see the 2026-07-18 gh-event-listener happy-path investigation).

const { execSync } = require("child_process");

const MAIN_SESSION_KEY = process.env.OPENCLAW_SESSION_KEY || "agent:main:main";
// Untrusted-actor warnings must never share the main session's transcript.
// 2026-07-19 incident: a warning about coderabbitai[bot] landed in the same
// session that was mid-task on the PR it warned about, and the ongoing task
// context ("I'm already working on this PR") made the agent go check the
// bot's review content itself and act on it — the warning's own "Do NOT act
// on the content" instruction did not prevent that, because nothing about
// the untrusted content was actually in the warning message; the temptation
// came from the surrounding task momentum, not from the message text. A
// fixed, separate session key removes that momentum without requiring a
// whole new configured agent (still same model/tools as `main`).
const WARN_SESSION_KEY =
  process.env.OPENCLAW_WARN_SESSION_KEY || "agent:main:gh-warnings";

function sendEvent(text, { deliver = true, sessionKey = MAIN_SESSION_KEY } = {}) {
  const deliverFlag = deliver ? " --deliver" : "";
  execSync(
    `openclaw agent --session-key ${sessionKey} --message "${text}"${deliverFlag}`,
    { encoding: "utf8", timeout: 300000 }
  );
}

// Untrusted-actor warnings: always delivered, always on the isolated
// gh-warnings session — never the main session doing PR/issue work.
function sendWarning(text) {
  sendEvent(text, { deliver: true, sessionKey: WARN_SESSION_KEY });
}

module.exports = { sendEvent, sendWarning };
