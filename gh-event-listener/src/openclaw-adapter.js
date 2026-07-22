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

// 2026-07-22 incident: every warning since the isolation fix above shipped
// (both real untrusted-actor events that occurred after) failed with
// "GatewayClientRequestError: Discord recipient is required" and never
// reached Benjamin. `--deliver` on `agent:main:main` works with no extra
// flags because that session already has a bound Discord recipient from
// ordinary use; the isolated gh-warnings session is brand new and has no
// such binding, so `--deliver` has nowhere to route to. An explicit
// reply target restores delivery without going back to sharing the main
// session's transcript. No default for OPENCLAW_WARN_REPLY_TO: it identifies
// a specific person, so every deployment must set its own rather than
// inheriting one baked into the repo (2026-07-22, repo went public). Read
// lazily inside sendWarning (not as a module-level const) so tests can set
// the env var per-case without needing to re-require the module.

function sendEvent(
  text,
  { deliver = true, sessionKey = MAIN_SESSION_KEY, replyChannel, replyTo } = {}
) {
  const deliverFlag = deliver ? " --deliver" : "";
  const replyFlags =
    replyChannel && replyTo
      ? ` --reply-channel ${replyChannel} --reply-to "${replyTo}"`
      : "";
  execSync(
    `openclaw agent --session-key ${sessionKey} --message "${text}"${deliverFlag}${replyFlags}`,
    { encoding: "utf8", timeout: 300000 }
  );
}

// Untrusted-actor warnings: always delivered, always on the isolated
// gh-warnings session — never the main session doing PR/issue work. Always
// carries an explicit reply target since the isolated session has no
// pre-existing channel binding of its own to fall back on.
function sendWarning(text) {
  const replyChannel = process.env.OPENCLAW_WARN_REPLY_CHANNEL || "discord";
  const replyTo = process.env.OPENCLAW_WARN_REPLY_TO || null;
  if (!replyTo) {
    console.error(
      "sendWarning: OPENCLAW_WARN_REPLY_TO is not set — delivery will likely fail " +
        "with \"Discord recipient is required\" (see README.md)."
    );
  }
  sendEvent(text, {
    deliver: true,
    sessionKey: WARN_SESSION_KEY,
    replyChannel,
    replyTo,
  });
}

module.exports = { sendEvent, sendWarning };
