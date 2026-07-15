// openclaw-adapter.js
// Triggers the OpenClaw agent via the CLI.
//
// `openclaw system event` is a heartbeat side-channel, not an immediate
// trigger: per docs/cli/system.md it only ever queues a `System:` line that
// gets flushed on the next heartbeat tick or user message, regardless of
// `--mode`. `openclaw agent` is the dedicated command for running one agent
// turn synchronously via the Gateway and (with `--deliver`) sending the reply
// straight to the channel — the correct tool for "trigger the agent right
// now from a script".

const { execSync } = require("child_process");

const MAIN_SESSION_KEY = process.env.OPENCLAW_SESSION_KEY || "agent:main:main";

function sendEvent(text) {
  execSync(
    `openclaw agent --session-key ${MAIN_SESSION_KEY} --message "${text}" --deliver`,
    { encoding: "utf8", timeout: 300000 }
  );
}

module.exports = { sendEvent };
