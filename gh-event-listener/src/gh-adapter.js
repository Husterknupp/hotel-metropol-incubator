// gh-adapter.js
// Thin wrapper around the `gh` CLI.
// All functions throw on gh CLI errors so callers can log and handle them.

const { execSync } = require("child_process");

const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';

function ghJson(args) {
  try {
    const command = `gh ${args}`;
    const raw = execSync(command, { encoding: "utf8" });
    if (DEBUG) {
	console.debug(`[DEBUG]: command '${command}'\n[DEBUG]: yielded ${raw}`);
    }
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`gh CLI error (${args.split(" ")[0]}): ${err.message}`);
  }
}

function ghRaw(args) {
  try {
    const command = `gh ${args}`;
    const raw = execSync(command, { encoding: "utf8" });
    if (DEBUG) {
	console.debug(`[DEBUG]: command '${command}'\n[DEBUG]: yielded ${raw}`);
    }
    return raw.trim();
  } catch (err) {
    throw new Error(`gh CLI error (${args.split(" ")[0]}): ${err.message}`);
  }
}

function ghExec(args) {
  try {
    const command = `gh ${args}`;
    execSync(command, { encoding: "utf8" });
    if (DEBUG) {
        console.debug(`[DEBUG]: command '${command}' (answer not relevant for script)`);
    }
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
  // gh --jq returns a bare, unquoted string for scalar fields — not JSON, so use ghRaw, not ghJson
  const result = ghRaw(`api "${apiUrl}" --jq '.user.login'`);
  return result || null;
}

/**
 * Adds an emoji reaction to a comment.
 * content: one of +1, -1, laugh, confused, heart, hooray, rocket, eyes
 */
function addReaction({ owner, repo, commentId, content }) {
  ghExec(
    `api 'repos/${owner}/${repo}/issues/comments/${commentId}/reactions' ` +
      `-f content=${content} -X POST`
  );
}

/**
 * Removes an emoji reaction from a comment.
 */
function removeReaction({ owner, repo, commentId, reactionId }) {
  ghExec(
    `api 'repos/${owner}/${repo}/issues/comments/${commentId}/reactions/${reactionId}' -X DELETE`
  );
}

/**
 * Returns the latest PR review comment (inline diff comment) for a pull request.
 * Returns null if no review comments exist.
 * Note: PR review comments use /pulls/comments endpoint, not /issues/comments.
 */
function getLatestPrReviewComment({ owner, repo, prNumber }) {
  const comments = ghJson(
    `api 'repos/${owner}/${repo}/pulls/${prNumber}/comments?per_page=1&sort=created&direction=desc'`
  );
  return Array.isArray(comments) && comments.length > 0 ? comments[0] : null;
}

/**
 * Returns the issue/PR timeline (assignments, review requests, comments, …),
 * oldest first. PRs share the issues timeline endpoint. Used to find who
 * ASSIGNED us — the notification payload only exposes the subject's creator,
 * which is a different person whenever we file our own tickets.
 * Capped at 100 events (one page); the resolver reads the latest matching
 * event, so only issues with >100 timeline entries before the final assignment
 * would miss it.
 */
function getIssueTimeline({ owner, repo, issueNumber }) {
  const events = ghJson(
    `api 'repos/${owner}/${repo}/issues/${issueNumber}/timeline?per_page=100'`
  );
  return Array.isArray(events) ? events : [];
}

/**
 * Returns ALL inline review comments for a pull request, oldest first.
 * A submitted review bundles many inline comments under one notification, so we
 * need the full list to process every one (issue #8), not just the newest.
 * Capped at 100 per run (one page); a review with more comments than that is
 * handled across successive polls as earlier comments get marked done.
 */
function getPrReviewComments({ owner, repo, prNumber }) {
  const comments = ghJson(
    `api 'repos/${owner}/${repo}/pulls/${prNumber}/comments?per_page=100&sort=created&direction=asc'`
  );
  return Array.isArray(comments) ? comments : [];
}

/**
 * Returns the databaseIds (as strings) of all review comments that sit in a
 * RESOLVED review thread. The REST comments endpoint has no resolved flag, so
 * we ask GraphQL. Used to skip comments the reviewer has already resolved.
 */
function getResolvedReviewCommentIds({ owner, repo, prNumber }) {
  const query =
    `query($owner:String!,$repo:String!,$pr:Int!){` +
    `repository(owner:$owner,name:$repo){pullRequest(number:$pr){` +
    `reviewThreads(first:100){nodes{isResolved comments(first:100){nodes{databaseId}}}}}}}`;
  const data = ghJson(
    `api graphql -f query='${query}' -F owner='${owner}' -F repo='${repo}' -F pr=${prNumber}`
  );
  const threads =
    data?.data?.repository?.pullRequest?.reviewThreads?.nodes || [];
  const ids = [];
  for (const thread of threads) {
    if (!thread.isResolved) continue;
    for (const c of thread.comments?.nodes || []) {
      if (c.databaseId != null) ids.push(String(c.databaseId));
    }
  }
  return ids;
}

/**
 * Adds an emoji reaction to a PR review comment (inline diff comment).
 * Uses /pulls/comments/{id}/reactions — different from /issues/comments/{id}/reactions.
 */
function addPrReviewCommentReaction({ owner, repo, commentId, content }) {
  ghExec(
    `api 'repos/${owner}/${repo}/pulls/comments/${commentId}/reactions' ` +
      `-f content=${content} -X POST`
  );
}

/**
 * Removes an emoji reaction from a PR review comment.
 */
function removePrReviewCommentReaction({ owner, repo, commentId, reactionId }) {
  ghExec(
    `api 'repos/${owner}/${repo}/pulls/comments/${commentId}/reactions/${reactionId}' -X DELETE`
  );
}

/**
 * Lists reactions on a PR review comment.
 */
function getPrReviewCommentReactions({ owner, repo, commentId }) {
  return ghJson(
    `api 'repos/${owner}/${repo}/pulls/comments/${commentId}/reactions'`
  );
}

/**
 * Marks a notification thread as read.
 */
function markThreadRead(threadId) {
  if (DEBUG) {
	console.debug(`[DEBUG]: skipping markThreadRead for thread ${threadId} (DEBUG mode)`);
	return;
  }
  ghExec(`api 'notifications/threads/${threadId}' -X PATCH`);
}

/**
 * Lists reactions on a comment to check for existing locks.
 */
function getReactions({ owner, repo, commentId }) {
  return ghJson(
    `api 'repos/${owner}/${repo}/issues/comments/${commentId}/reactions'`
  );
}

/**
 * Lists reactions on an issue/PR itself (not a comment).
 * Used for locking a genuine assignment/review_request notification, where
 * there is no comment yet to react to.
 */
function getIssueReactions({ owner, repo, issueNumber }) {
  return ghJson(`api 'repos/${owner}/${repo}/issues/${issueNumber}/reactions'`);
}

/**
 * Adds an emoji reaction to an issue/PR itself.
 * GitHub's issue reactions endpoint also accepts PR numbers, since PRs are
 * issues under the hood for this API.
 */
function addIssueReaction({ owner, repo, issueNumber, content }) {
  ghExec(
    `api 'repos/${owner}/${repo}/issues/${issueNumber}/reactions' ` +
      `-f content=${content} -X POST`
  );
}

/**
 * Removes an emoji reaction from an issue/PR itself.
 */
function removeIssueReaction({ owner, repo, issueNumber, reactionId }) {
  ghExec(
    `api 'repos/${owner}/${repo}/issues/${issueNumber}/reactions/${reactionId}' -X DELETE`
  );
}

module.exports = {
  getNotifications,
  getActorFromUrl,
  addReaction,
  removeReaction,
  markThreadRead,
  getReactions,
  getIssueReactions,
  addIssueReaction,
  removeIssueReaction,
  getLatestPrReviewComment,
  getIssueTimeline,
  getPrReviewComments,
  getResolvedReviewCommentIds,
  addPrReviewCommentReaction,
  removePrReviewCommentReaction,
  getPrReviewCommentReactions,
};
