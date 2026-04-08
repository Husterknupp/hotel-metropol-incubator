// index.js
// Polls GitHub notifications and triggers the OpenClaw agent for relevant events.
// Intended to be run via cron every ~60 seconds.
//
// Environment / config:
//   TRUSTED_ACTOR   GitHub username whose events should trigger the agent (default: Husterknupp)
//   LOCK_REACTION   Emoji reaction used as a distributed lock (default: eyes)
//   WARN_CHANNEL    Discord channel ID for third-party event warnings (default: 1477664071061999818)

const gh = require("./gh-adapter");
const openclaw = require("./openclaw-adapter");

const TRUSTED_ACTOR = process.env.TRUSTED_ACTOR || "Husterknupp";
const LOCK_REACTION = process.env.LOCK_REACTION || "eyes";
const WARN_CHANNEL = process.env.WARN_CHANNEL || "1477664071061999818";

function log(outcome, detail = "") {
  const ts = new Date().toISOString();
  console.log(JSON.stringify({ ts, outcome, detail }));
}

/**
 * Classify a notification into one of: comment | issue | pr | unknown
 */
function classifyNotification(notification) {
  const reason = notification.reason;
  const type = notification.subject?.type;

  if (reason === "mention") return "comment";
  if (reason === "assign" && type === "Issue") return "issue";
  if (reason === "review_requested" && type === "PullRequest") return "pr";
  return "unknown";
}

/**
 * Extract owner and repo from a notification's repository full_name.
 */
function parseRepo(notification) {
  const [owner, repo] = notification.repository.full_name.split("/");
  return { owner, repo };
}

/**
 * Build the agent event message for a given notification.
 */
function buildEventMessage(kind, notification) {
  const repoFull = notification.repository.full_name;
  const number = notification.subject?.url?.split("/").pop();

  if (kind === "comment") {
    return `React to ${TRUSTED_ACTOR}'s GitHub comment (repo ${repoFull})`;
  }
  if (kind === "issue") {
    return `Work on issue #${number} (repo ${repoFull})`;
  }
  if (kind === "pr") {
    return `Review PR #${number} (repo ${repoFull})`;
  }
  return null;
}

/**
 * Attempt to set the lock reaction on the notification's latest comment.
 * Returns the comment ID used for locking, or null if no comment URL available.
 */
function acquireLock(notification, ghAdapter) {
  const { owner, repo } = parseRepo(notification);
  const latestCommentUrl = notification.subject?.latest_comment_url;
  if (!latestCommentUrl) return null;

  const commentId = latestCommentUrl.split("/").pop();

  // Check if already locked
  const existing = ghAdapter.getReactions({ owner, repo, commentId });
  const alreadyLocked = existing.some(
    (r) => r.content === LOCK_REACTION
  );
  if (alreadyLocked) {
    return null; // Another run is handling this
  }

  ghAdapter.addReaction({ owner, repo, commentId, content: LOCK_REACTION });
  return commentId;
}

/**
 * Release the lock by removing the reaction.
 */
function releaseLock(notification, commentId, ghAdapter) {
  const { owner, repo } = parseRepo(notification);
  const reactions = ghAdapter.getReactions({ owner, repo, commentId });
  const ours = reactions.find((r) => r.content === LOCK_REACTION);
  if (ours) {
    ghAdapter.removeReaction({
      owner,
      repo,
      commentId,
      reactionId: ours.id,
    });
  }
}

/**
 * Main processing loop for one poll run.
 */
function run(ghAdapter = gh, oclAdapter = openclaw) {
  let notifications;

  try {
    notifications = ghAdapter.getNotifications();
  } catch (err) {
    log("error", `Failed to fetch notifications: ${err.message}`);
    return;
  }

  if (!notifications || notifications.length === 0) {
    log("no_op");
    return;
  }

  for (const notification of notifications) {
    const actor = notification.subject?.actor?.login || "unknown";
    const kind = classifyNotification(notification);

    if (kind === "unknown") {
      log("no_op", `Skipping unclassified notification: ${notification.id}`);
      ghAdapter.markThreadRead(notification.id);
      continue;
    }

    if (actor !== TRUSTED_ACTOR) {
      log("error", `Untrusted actor: ${actor}`);
      try {
        oclAdapter.sendEvent(
          `Warning: GitHub event by untrusted actor "${actor}" in repo ${notification.repository.full_name}. ` +
            `Send a warning to Discord channel ${WARN_CHANNEL}.`
        );
      } catch (err) {
        log("error", `Failed to send warning: ${err.message}`);
      }
      ghAdapter.markThreadRead(notification.id);
      continue;
    }

    // Acquire lock
    let commentId;
    try {
      commentId = acquireLock(notification, ghAdapter);
    } catch (err) {
      log("error", `Failed to acquire lock: ${err.message}`);
      continue;
    }

    if (!commentId) {
      log("no_op", `Already locked or no comment URL: ${notification.id}`);
      continue;
    }

    // Build and send event
    const message = buildEventMessage(kind, notification);
    if (!message) {
      log("no_op", `Could not build event message for: ${notification.id}`);
      releaseLock(notification, commentId, ghAdapter);
      continue;
    }

    try {
      oclAdapter.sendEvent(message);
      ghAdapter.markThreadRead(notification.id);
      log(kind, message);
    } catch (err) {
      log("error", `Failed to send event or mark read: ${err.message}`);
      // Release lock so next cron run retries
      try {
        releaseLock(notification, commentId, ghAdapter);
      } catch (releaseErr) {
        log("error", `Failed to release lock: ${releaseErr.message}`);
      }
    }
  }
}

module.exports = {
  run,
  classifyNotification,
  buildEventMessage,
  acquireLock,
  releaseLock,
};

// Entry point when run directly
if (require.main === module) {
  run();
}
