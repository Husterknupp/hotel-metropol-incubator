// gh-adapter.js
// Thin wrapper around the `gh` CLI.
// All functions throw on gh CLI errors so callers can log and handle them.

const { execSync } = require("child_process");

function ghJson(args) {
  try {
    const raw = execSync(`gh ${args}`, { encoding: "utf8" });
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`gh CLI error (${args.split(" ")[0]}): ${err.message}`);
  }
}

function ghExec(args) {
  try {
    execSync(`gh ${args}`, { encoding: "utf8" });
  } catch (err) {
    throw new Error(`gh CLI error (${args.split(" ")[0]}): ${err.message}`);
  }
}

/**
 * Returns all unread notifications for the authenticated user.
 */
function getNotifications() {
  return ghJson("api notifications");
}

/**
 * Fetches a resource by its full API URL and returns .user.login.
 * Used to determine who triggered an event (comment author, issue creator, etc).
 *
 * The GitHub Notifications API does NOT include an actor field.
 * We must follow subject.url or latest_comment_url to find who acted.
 */
function getActorFromUrl(apiUrl) {
  const result = ghJson(`api "${apiUrl}" --jq '.user.login'`);
  // gh --jq returns the raw string, already parsed by ghJson
  return typeof result === "string" ? result : null;
}

/**
 * Adds an emoji reaction to a comment.
 * content: one of +1, -1, laugh, confused, heart, hooray, rocket, eyes
 */
function addReaction({ owner, repo, commentId, content }) {
  ghExec(
    `api repos/${owner}/${repo}/issues/comments/${commentId}/reactions ` +
      `-f content=${content} -X POST`
  );
}

/**
 * Removes an emoji reaction from a comment.
 */
function removeReaction({ owner, repo, commentId, reactionId }) {
  ghExec(
    `api repos/${owner}/${repo}/issues/comments/${commentId}/reactions/${reactionId} -X DELETE`
  );
}

/**
 * Marks a notification thread as read.
 */
function markThreadRead(threadId) {
  ghExec(`api notifications/threads/${threadId} -X PATCH`);
}

/**
 * Lists reactions on a comment to check for existing locks.
 */
function getReactions({ owner, repo, commentId }) {
  return ghJson(
    `api repos/${owner}/${repo}/issues/comments/${commentId}/reactions`
  );
}

module.exports = {
  getNotifications,
  getActorFromUrl,
  addReaction,
  removeReaction,
  markThreadRead,
  getReactions,
};
