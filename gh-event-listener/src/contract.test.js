// contract.test.js
// Pins the listener's behaviour to REAL, recorded GitHub API responses instead
// of hand-authored assumptions. The fixtures under ../fixtures were captured on
// 2026-07-16 from a genuine assignment of issue
// Husterknupp/party-insights-shenanigans#48 to arostovd by Husterknupp.
//
// See fixtures/README.md for how each file was recorded and why the flow needs
// three endpoints (notifications → timeline → subject).

const fs = require("fs");
const path = require("path");

const {
  run,
  classifyNotification,
  resolveActor,
} = require("./index");

const FIXTURES = path.join(__dirname, "..", "fixtures");
const load = (name) =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));

const notification = load("notification-genuine-assign.json");
const timeline = load("timeline-genuine-assign.json");
const issueSubject = load("issue-subject.json");

// Mirror the run() adapter surface, backed by the recorded responses.
function makeRecordedGhAdapter(overrides = {}) {
  return {
    getNotifications: jest.fn().mockReturnValue([notification]),
    getIssueTimeline: jest.fn().mockReturnValue(timeline),
    // If anything reaches for the creator, it would get arostovd (== SELF_ACTOR)
    // — the exact value that used to break the flow. It must NOT be consulted.
    getActorFromUrl: jest.fn().mockReturnValue(issueSubject.user.login),
    addReaction: jest.fn(),
    removeReaction: jest.fn(),
    markThreadRead: jest.fn(),
    getReactions: jest.fn().mockReturnValue([]),
    getIssueReactions: jest.fn().mockReturnValue([]),
    addIssueReaction: jest.fn(),
    removeIssueReaction: jest.fn(),
    ...overrides,
  };
}

describe("contract: recorded GitHub responses for a genuine assignment", () => {
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
      expect.stringContaining("Work on Issue #48")
    );
    expect(ghAdapter.addIssueReaction).toHaveBeenCalled();
    expect(ghAdapter.markThreadRead).toHaveBeenCalled();
  });
});
