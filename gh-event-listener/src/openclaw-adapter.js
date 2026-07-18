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

function sendEvent(text, { deliver = true } = {}) {
  const deliverFlag = deliver ? " --deliver" : "";
  execSync(
    `openclaw agent --session-key ${MAIN_SESSION_KEY} --message "${text}"${deliverFlag}`,
    { encoding: "utf8", timeout: 300000 }
  );
}

module.exports = { sendEvent };
