// contract.test.js
// Pins the listener's behaviour to REAL, recorded GitHub API responses instead
// of hand-authored assumptions. One folder per use case under ../fixtures, one
// describe block per case here. See fixtures/README.md for how each case was
// recorded and why it matters.

const fs = require("fs");
const path = require("path");

const {
  run,
  classifyNotification,
  resolveActor,
} = require("./index");

const FIXTURES = path.join(__dirname, "..", "fixtures");
const load = (caseName, file) =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, caseName, file), "utf8"));

function makeBaseGhAdapter(overrides = {}) {
  return {
    getNotifications: jest.fn().mockReturnValue([]),
    getIssueTimeline: jest.fn(),
    getActorFromUrl: jest.fn(),
    getLatestIssueComment: jest.fn(),
    getLatestPrReviewComment: jest.fn(),
    getPrReviewComments: jest.fn().mockReturnValue([]),
    getResolvedReviewCommentIds: jest.fn().mockReturnValue([]),
    addReaction: jest.fn(),
    removeReaction: jest.fn(),
    markThreadRead: jest.fn(),
    getReactions: jest.fn().mockReturnValue([]),
    getIssueReactions: jest.fn().mockReturnValue([]),
    addIssueReaction: jest.fn(),
    removeIssueReaction: jest.fn(),
    getPrReviewCommentReactions: jest.fn().mockReturnValue([]),
    addPrReviewCommentReaction: jest.fn(),
    removePrReviewCommentReaction: jest.fn(),
    ...overrides,
  };
}

describe("contract: recorded GitHub responses for a genuine assignment", () => {
  const notification = load("genuine-assign", "notification.json");
  const timeline = load("genuine-assign", "timeline.json");
  const issueSubject = load("genuine-assign", "issue-subject.json");

  // Mirror the run() adapter surface, backed by the recorded responses.
  function makeRecordedGhAdapter(overrides = {}) {
    return makeBaseGhAdapter({
      getNotifications: jest.fn().mockReturnValue([notification]),
      getIssueTimeline: jest.fn().mockReturnValue(timeline),
      // If anything reaches for the creator, it would get arostovd (== SELF_ACTOR)
      // — the exact value that used to break the flow. It must NOT be consulted.
      getActorFromUrl: jest.fn().mockReturnValue(issueSubject.user.login),
      ...overrides,
    });
  }

  test("the recorded notification really is a genuine assignment (not a comment)", () => {
    // This is the property the whole flow hinges on: for a genuine assignment
    // GitHub sets latest_comment_url === subject.url.
    expect(notification.reason).toBe("assign");
    expect(notification.subject.latest_comment_url).toBe(
      notification.subject.url
    );
    expect(classifyNotification(notification)).toBe("issue");
  });

  test("the crux: the issue creator and the assigner are different people", () => {
    // Creator (from the subject fixture) is us…
    expect(issueSubject.user.login).toBe("arostovd");
    // …while the assigner (latest `assigned` in the timeline) is the owner.
    const lastAssigned = [...timeline]
      .reverse()
      .find((e) => e.event === "assigned" && e.assignee.login === "arostovd");
    expect(lastAssigned.actor.login).toBe("Husterknupp");
    expect(issueSubject.user.login).not.toBe(lastAssigned.actor.login);
  });

  test("resolveActor returns the assigner (Husterknupp) from the recorded timeline", () => {
    const ghAdapter = makeRecordedGhAdapter();
    expect(resolveActor(notification, ghAdapter)).toBe("Husterknupp");
    // The creator endpoint is never consulted for a genuine assignment.
    expect(ghAdapter.getActorFromUrl).not.toHaveBeenCalled();
  });

  test("end-to-end run() fires the assignment even though we authored the issue", () => {
    const ghAdapter = makeRecordedGhAdapter();
    const oclAdapter = { sendEvent: jest.fn() };

    run(ghAdapter, oclAdapter);

    expect(oclAdapter.sendEvent).toHaveBeenCalledWith(
      expect.stringContaining("Work on Issue #48"),
      { deliver: false }
    );
    expect(ghAdapter.addIssueReaction).toHaveBeenCalled();
    expect(ghAdapter.markThreadRead).toHaveBeenCalled();
  });
});

describe("contract: recorded GitHub responses for a stale mention re-notification", () => {
  const notification = load("stale-mention", "notification.json");
  const comments = load("stale-mention", "comments.json");

  function makeRecordedGhAdapter(overrides = {}) {
    return makeBaseGhAdapter({
      getNotifications: jest.fn().mockReturnValue([notification]),
      getLatestIssueComment: jest.fn().mockReturnValue(
        comments[comments.length - 1]
      ),
      ...overrides,
    });
  }

  test("the recorded notification is a mention with no comment to follow directly", () => {
    expect(notification.reason).toBe("mention");
    expect(notification.subject.latest_comment_url).toBeNull();
    expect(classifyNotification(notification)).toBe("comment");
  });

  test("the crux: the comments endpoint ignores sort/direction and returns oldest-first", () => {
    // The real last comment (highest created_at) sits at the END of the array,
    // not the start — even though a naive reading of `sort=created&direction=desc`
    // would expect the opposite.
    const sortedByCreatedAtDesc = [...comments].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );
    expect(comments[comments.length - 1]).toEqual(sortedByCreatedAtDesc[0]);
    expect(comments[0]).not.toEqual(sortedByCreatedAtDesc[0]);
  });

  test("resolveActor falls back to the true latest comment instead of returning null", () => {
    const ghAdapter = makeRecordedGhAdapter();
    // Before the fix this returned null (logged as "Untrusted actor: unknown"),
    // even though the thread's real latest activity is our own reply.
    expect(resolveActor(notification, ghAdapter)).toBe("arostovd");
    expect(ghAdapter.getLatestIssueComment).toHaveBeenCalledWith({
      owner: "Husterknupp",
      repo: "party-insights-shenanigans",
      issueNumber: "54",
    });
  });

  test("end-to-end run() recognizes the echo as self-triggered and does not warn", () => {
    const ghAdapter = makeRecordedGhAdapter();
    const oclAdapter = { sendEvent: jest.fn() };

    run(ghAdapter, oclAdapter);

    expect(oclAdapter.sendEvent).not.toHaveBeenCalled();
    expect(ghAdapter.markThreadRead).toHaveBeenCalledWith(notification.id);
  });
});

describe("contract: recorded GitHub responses for a genuine inline review comment behind a stale mention", () => {
  // Same notification thread as "stale-mention" above (same thread ID,
  // updated_at bumped again later) — but this time the bump really was a new
  // comment: a genuine inline PR review comment from Husterknupp, which the
  // conversation-only fallback above would miss entirely because it lives on
  // a different endpoint (/pulls/{n}/comments, not /issues/{n}/comments).
  const notification = load("stale-mention-inline-review", "notification.json");
  const issueComments = load("stale-mention-inline-review", "issue-comments.json");
  const reviewComments = load("stale-mention-inline-review", "review-comments.json");

  function makeRecordedGhAdapter(overrides = {}) {
    return makeBaseGhAdapter({
      getNotifications: jest.fn().mockReturnValue([notification]),
      getLatestIssueComment: jest.fn().mockReturnValue(
        issueComments[issueComments.length - 1]
      ),
      // /pulls/{n}/comments (unlike /issues/{n}/comments) correctly honors
      // sort=created&direction=desc, so the real adapter call already
      // returns the newest comment first — reviewComments[0] here.
      getLatestPrReviewComment: jest.fn().mockReturnValue(reviewComments[0]),
      ...overrides,
    });
  }

  test("the crux: the genuine new comment is an inline review comment, newer than the stale conversation reply", () => {
    expect(reviewComments[0].user.login).toBe("Husterknupp");
    expect(new Date(reviewComments[0].created_at).getTime()).toBeGreaterThan(
      new Date(issueComments[issueComments.length - 1].created_at).getTime()
    );
  });

  test("resolveActor picks the trusted owner's inline review comment, not the stale self-echo", () => {
    const ghAdapter = makeRecordedGhAdapter();
    // Before this fix, resolveActor only ever checked getLatestIssueComment
    // and returned "arostovd" (our own older conversation reply) here,
    // silently dropping Husterknupp's real review feedback.
    expect(resolveActor(notification, ghAdapter)).toBe("Husterknupp");
  });

  test("end-to-end run() fires a comment-reaction event for the trusted owner's review comment", () => {
    const ghAdapter = makeRecordedGhAdapter();
    const oclAdapter = { sendEvent: jest.fn() };

    run(ghAdapter, oclAdapter);

    expect(oclAdapter.sendEvent).toHaveBeenCalledWith(
      expect.stringContaining(
        "React to Husterknupp's GitHub comment (repo Husterknupp/party-insights-shenanigans)"
      ),
      { deliver: false }
    );
    expect(ghAdapter.markThreadRead).toHaveBeenCalledWith(notification.id);
  });
});
