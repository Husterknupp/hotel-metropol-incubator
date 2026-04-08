// gh-adapter.js
// Thin wrapper around the `gh` CLI. Kept intentionally simple —
// the real complexity lives in index.js, which is where the tests focus.

const { execSync } = require("child_process");

function ghJson(args) {
  const raw = execSync(`gh ${args}`, { encoding: "utf8" });
  return JSON.parse(raw);
}

function ghExec(args) {
  execSync(`gh ${args}`, { encoding: "utf8" });
}

/**
 * Returns all unread notifications for the authenticated user.
 */
function getNotifications() {
  return ghJson("api notifications");
}

/**
 * Adds an emoji reaction to a comment or issue.
 * content: one of +1, -1, laugh, confused, heart, hooray, rocket, eyes
 */
function addReaction({ owner, repo, commentId, content }) {
  ghExec(
    `api repos/${owner}/${repo}/issues/comments/${commentId}/reactions ` +
      `-f content=${content} -X POST`
  );
}

/**
 * Removes an emoji reaction from a comment or issue.
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
  addReaction,
  removeReaction,
  markThreadRead,
  getReactions,
};
