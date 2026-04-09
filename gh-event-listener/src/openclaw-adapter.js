// openclaw-adapter.js
// Triggers the OpenClaw agent via the CLI.

const { execSync } = require("child_process");

function sendEvent(text) {
  execSync(`openclaw system event --text "${text}" --mode now`, {
    encoding: "utf8",
  });
}

module.exports = { sendEvent };
