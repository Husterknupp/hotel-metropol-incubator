// openclaw-adapter.js
// Thin wrapper around the `openclaw system event` CLI call.

const { execSync } = require("child_process");

/**
 * Sends an event to the OpenClaw main agent.
 * @param {string} text - The message to send.
 */
function sendEvent(text) {
  execSync(`openclaw system event --text "${text}" --Mode now`, {
    encoding: "utf8",
  });
}

module.exports = { sendEvent };
