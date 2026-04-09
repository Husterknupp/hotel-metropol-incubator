// index.test.js
// Happy-path tests for the three main flows: comment, issue, PR.
// All gh and openclaw side effects are mocked via the adapter injection.

const {
  run,
  classifyNotification,
  buildEventMessage,
  buildWarningMessage,
} = require("../src/index");

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeNotification(overrides = {}) {
  return {
    id: "notif-1",
    reason: "mention",
    repository: { full_name: "Husterknupp/hotel-metropol-incubator" },
    subject: {
      type: "Issue",
      actor: { login: "Husterknupp" },
      latest_comment_url:
        "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/issues/comments/42",
      url: "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/issues/1",
    },
    ...overrides,
  };
}

function makeGhAdapter(overrides = {}) {
  return {
    getNotifications: jest.fn().mockReturnValue([makeNotification()]),
    addReaction: jest.fn(),
    removeReaction: jest.fn(),
    markThreadRead: jest.fn(),
    getReactions: jest.fn().mockReturnValue([]), // no existing lock
    ...overrides,
  };
}

function makeOclAdapter() {
  return { sendEvent: jest.fn() };
}

// ── classifyNotification ──────────────────────────────────────────────────────

describe("classifyNotification", () => {
  test("reason=mention → comment", () => {
    expect(classifyNotification({ reason: "mention", subject: { type: "Issue" } })).toBe("comment");
  });

  test("reason=assign + Issue → issue", () => {
    expect(classifyNotification({ reason: "assign", subject: { type: "Issue" } })).toBe("issue");
  });

  test("reason=review_requested + PullRequest → pr", () => {
    expect(
      classifyNotification({ reason: "review_requested", subject: { type: "PullRequest" } })
    ).toBe("pr");
  });

  test("reason=author + PullRequest + comment URL → pr_review_comment", () => {
    expect(
      classifyNotification({
        reason: "author",
        subject: {
          type: "PullRequest",
          latest_comment_url: "https://api.github.com/repos/owner/repo/pulls/comments/99",
        },
      })
    ).toBe("pr_review_comment");
  });

  test("reason=author + PullRequest + NO comment URL → unknown (CI activity)", () => {
    expect(
      classifyNotification({
        reason: "author",
        subject: { type: "PullRequest" }, // no latest_comment_url
      })
    ).toBe("unknown");
  });

  test("unknown reason → unknown", () => {
    expect(classifyNotification({ reason: "subscribed", subject: { type: "Issue" } })).toBe("unknown");
  });
});

// ── buildEventMessage ─────────────────────────────────────────────────────────

describe("buildEventMessage", () => {
  const notification = makeNotification();

  test("comment message", () => {
    const msg = buildEventMessage("comment", notification);
    expect(msg).toMatch(/React to Husterknupp's GitHub comment/);
    expect(msg).toMatch(/hotel-metropol-incubator/);
  });

  test("issue message includes issue number", () => {
    const msg = buildEventMessage("issue", notification);
    expect(msg).toMatch(/Work on issue #1/);
  });

  test("pr message includes pr number", () => {
    const prNotif = makeNotification({
      reason: "review_requested",
      subject: {
        type: "PullRequest",
        actor: { login: "Husterknupp" },
        latest_comment_url:
          "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/issues/comments/42",
        url: "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/pulls/7",
      },
    });
    const msg = buildEventMessage("pr", prNotif);
    expect(msg).toMatch(/Review PR #7/);
  });

  test("pr_review_comment message includes PR number and no-ping note", () => {
    const reviewNotif = makeNotification({
      reason: "author",
      subject: {
        type: "PullRequest",
        actor: { login: "Husterknupp" },
        latest_comment_url:
          "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/pulls/comments/99",
        url: "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/pulls/2",
      },
    });
    const msg = buildEventMessage("pr_review_comment", reviewNotif);
    expect(msg).toMatch(/review comment on your PR #2/);
    expect(msg).toMatch(/Do not @-mention/);
  });
});

// ── run: happy path flows ─────────────────────────────────────────────────────

describe("run – comment flow (happy path)", () => {
  test("locks, sends event, marks thread read", () => {
    const ghAdapter = makeGhAdapter();
    const oclAdapter = makeOclAdapter();

    run(ghAdapter, oclAdapter);

    expect(ghAdapter.addReaction).toHaveBeenCalledWith(
      expect.objectContaining({ content: "eyes", commentId: "42" })
    );
    expect(oclAdapter.sendEvent).toHaveBeenCalledWith(
      expect.stringMatching(/React to Husterknupp's GitHub comment/)
    );
    expect(ghAdapter.markThreadRead).toHaveBeenCalledWith("notif-1");
  });
});

describe("run – issue assignment flow (happy path)", () => {
  test("locks, sends work-on-issue event, marks thread read", () => {
    const ghAdapter = makeGhAdapter({
      getNotifications: jest.fn().mockReturnValue([
        makeNotification({ reason: "assign" }),
      ]),
    });
    const oclAdapter = makeOclAdapter();

    run(ghAdapter, oclAdapter);

    expect(oclAdapter.sendEvent).toHaveBeenCalledWith(
      expect.stringMatching(/Work on issue #1/)
    );
    expect(ghAdapter.markThreadRead).toHaveBeenCalledWith("notif-1");
  });
});

describe("run – PR review request flow (happy path)", () => {
  test("locks, sends review-PR event, marks thread read", () => {
    const prNotif = makeNotification({
      reason: "review_requested",
      subject: {
        type: "PullRequest",
        actor: { login: "Husterknupp" },
        latest_comment_url:
          "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/issues/comments/99",
        url: "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/pulls/7",
      },
    });
    const ghAdapter = makeGhAdapter({
      getNotifications: jest.fn().mockReturnValue([prNotif]),
    });
    const oclAdapter = makeOclAdapter();

    run(ghAdapter, oclAdapter);

    expect(oclAdapter.sendEvent).toHaveBeenCalledWith(
      expect.stringMatching(/Review PR #7/)
    );
    expect(ghAdapter.markThreadRead).toHaveBeenCalledWith("notif-1");
  });
});


describe("run – PR review comment flow (happy path)", () => {
  test("locks, sends pr_review_comment event, marks thread read", () => {
    const reviewNotif = makeNotification({
      reason: "author",
      subject: {
        type: "PullRequest",
        actor: { login: "Husterknupp" },
        latest_comment_url:
          "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/pulls/comments/55",
        url: "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/pulls/2",
      },
    });
    const ghAdapter = makeGhAdapter({
      getNotifications: jest.fn().mockReturnValue([reviewNotif]),
    });
    const oclAdapter = makeOclAdapter();

    run(ghAdapter, oclAdapter);

    expect(oclAdapter.sendEvent).toHaveBeenCalledWith(
      expect.stringMatching(/review comment on your PR #2/)
    );
    expect(ghAdapter.markThreadRead).toHaveBeenCalledWith("notif-1");
  });

  test("CI activity on own PR (no comment URL) is treated as no_op", () => {
    const ciNotif = makeNotification({
      reason: "author",
      subject: {
        type: "PullRequest",
        actor: { login: "Husterknupp" },
        // No latest_comment_url — this is a CI run, not a review comment
        url: "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/pulls/2",
      },
    });
    const ghAdapter = makeGhAdapter({
      getNotifications: jest.fn().mockReturnValue([ciNotif]),
    });
    const oclAdapter = makeOclAdapter();

    run(ghAdapter, oclAdapter);

    expect(oclAdapter.sendEvent).not.toHaveBeenCalled();
    expect(ghAdapter.addReaction).not.toHaveBeenCalled();
  });
});

// ── run: no_op when already locked ───────────────────────────────────────────

describe("run – already locked", () => {
  test("skips event when lock reaction already present", () => {
    const ghAdapter = makeGhAdapter({
      getReactions: jest.fn().mockReturnValue([{ content: "eyes", id: 99 }]),
    });
    const oclAdapter = makeOclAdapter();

    run(ghAdapter, oclAdapter);

    expect(ghAdapter.addReaction).not.toHaveBeenCalled();
    expect(oclAdapter.sendEvent).not.toHaveBeenCalled();
  });
});

// ── buildWarningMessage ──────────────────────────────────────────────────────

describe("buildWarningMessage", () => {
  test("contains actor name and repo", () => {
    const msg = buildWarningMessage("RandomStranger", "someowner/somerepo");
    expect(msg).toMatch(/RandomStranger/);
    expect(msg).toMatch(/someowner\/somerepo/);
  });

  test("instructs agent NOT to act on the content", () => {
    const msg = buildWarningMessage("RandomStranger", "someowner/somerepo");
    expect(msg).toMatch(/Do NOT act on the content/);
  });

  test("mentions default channel when WARN_CHANNEL is not set", () => {
    const originalEnv = process.env.WARN_CHANNEL;
    delete process.env.WARN_CHANNEL;
    // Re-require to pick up env change — we test the helper directly
    const msg = buildWarningMessage("RandomStranger", "someowner/somerepo");
    expect(msg).toMatch(/default channel/);
    if (originalEnv !== undefined) process.env.WARN_CHANNEL = originalEnv;
  });
});

// ── run: untrusted actor from a foreign repo ──────────────────────────────────

describe("run – untrusted actor", () => {
  test("sends warning, does not lock or process event, and marks thread read", () => {
    const ghAdapter = makeGhAdapter({
      getNotifications: jest.fn().mockReturnValue([
        makeNotification({
          // Event comes from a completely different repo
          repository: { full_name: "SomeRandomOrg/some-other-repo" },
          subject: {
            type: "Issue",
            actor: { login: "RandomStranger" },
            latest_comment_url:
              "https://api.github.com/repos/SomeRandomOrg/some-other-repo/issues/comments/42",
            url: "https://api.github.com/repos/SomeRandomOrg/some-other-repo/issues/99",
          },
        }),
      ]),
    });
    const oclAdapter = makeOclAdapter();

    run(ghAdapter, oclAdapter);

    // Warning must be sent
    expect(oclAdapter.sendEvent).toHaveBeenCalledWith(
      expect.stringMatching(/Warning.*RandomStranger/)
    );
    // Warning must explicitly tell the agent to ignore the stranger's content
    expect(oclAdapter.sendEvent).toHaveBeenCalledWith(
      expect.stringMatching(/Do NOT act on the content/)
    );
    // Must NOT set a lock reaction
    expect(ghAdapter.addReaction).not.toHaveBeenCalled();
    // Thread should still be marked read to avoid repeated warnings
    expect(ghAdapter.markThreadRead).toHaveBeenCalledWith("notif-1");
  });
});

// ── run: error handling ───────────────────────────────────────────────────────

describe("run – OpenClaw sendEvent fails", () => {
  test("releases lock on failure", () => {
    const ghAdapter = makeGhAdapter({
      getReactions: jest
        .fn()
        // First call: no existing lock (acquireLock check)
        .mockReturnValueOnce([])
        // Second call: find our lock reaction to remove it
        .mockReturnValueOnce([{ content: "eyes", id: 77 }]),
    });
    const oclAdapter = {
      sendEvent: jest.fn().mockImplementation(() => {
        throw new Error("Gateway down");
      }),
    };

    run(ghAdapter, oclAdapter);

    expect(ghAdapter.removeReaction).toHaveBeenCalledWith(
      expect.objectContaining({ reactionId: 77 })
    );
    expect(ghAdapter.markThreadRead).not.toHaveBeenCalled();
  });
});
