const {
  run,
  classifyNotification,
  resolveActor,
  buildEventMessage,
  buildWarningMessage,
  acquireLock,
  releaseLock,
} = require("./index");

// ── Helpers ───────────────────────────────────────────────────────────────────

let notifCounter = 0;

function makeNotification(overrides = {}) {
  notifCounter += 1;
  return {
    id: `notif-${notifCounter}`,
    reason: "mention",
    subject: {
      type: "PullRequest",
      url: "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/pulls/2",
      latest_comment_url:
        "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/issues/comments/99",
      ...overrides.subject,
    },
    repository: {
      full_name: "Husterknupp/hotel-metropol-incubator",
      ...overrides.repository,
    },
    ...Object.fromEntries(
      Object.entries(overrides).filter(
        ([k]) => k !== "subject" && k !== "repository"
      )
    ),
  };
}

function makeGhAdapter(overrides = {}) {
  return {
    getNotifications: jest.fn().mockReturnValue([]),
    getActorFromUrl: jest.fn().mockReturnValue("Husterknupp"),
    addReaction: jest.fn(),
    removeReaction: jest.fn(),
    markThreadRead: jest.fn(),
    getReactions: jest.fn().mockReturnValue([]),
    getLatestPrReviewComment: jest.fn().mockReturnValue({
      id: 9001,
      user: { login: "Husterknupp" },
    }),
    getIssueTimeline: jest.fn().mockReturnValue([
      {
        event: "assigned",
        actor: { login: "Husterknupp" },
        assignee: { login: "arostovd" },
      },
    ]),
    getPrReviewComments: jest.fn().mockReturnValue([]),
    getResolvedReviewCommentIds: jest.fn().mockReturnValue([]),
    addPrReviewCommentReaction: jest.fn(),
    removePrReviewCommentReaction: jest.fn(),
    getPrReviewCommentReactions: jest.fn().mockReturnValue([]),
    getIssueReactions: jest.fn().mockReturnValue([]),
    addIssueReaction: jest.fn(),
    removeIssueReaction: jest.fn(),
    ...overrides,
  };
}

function makeOclAdapter(overrides = {}) {
  return {
    sendEvent: jest.fn(),
    sendWarning: jest.fn(),
    ...overrides,
  };
}

// ── classifyNotification ──────────────────────────────────────────────────────

describe("classifyNotification", () => {
  test("reason=mention, subject=PullRequest (someone @-mentions us in a PR comment) → comment", () => {
    expect(
      classifyNotification(makeNotification({ reason: "mention" }))
    ).toBe("comment");
  });

  test("reason=comment, subject=PullRequest (reply on a PR thread we're already on) → comment", () => {
    expect(
      classifyNotification(makeNotification({ reason: "comment" }))
    ).toBe("comment");
  });

  test("reason=assign + Issue, no comment yet (latest_comment_url === subject.url) → issue", () => {
    expect(
      classifyNotification(
        makeNotification({
          reason: "assign",
          subject: {
            type: "Issue",
            url: "https://api.github.com/repos/X/Y/issues/1",
            latest_comment_url: "https://api.github.com/repos/X/Y/issues/1",
          },
        })
      )
    ).toBe("issue");
  });

  test("reason=assign + PullRequest, no comment yet → issue (type included in message)", () => {
    expect(
      classifyNotification(
        makeNotification({
          reason: "assign",
          subject: {
            type: "PullRequest",
            url: "https://api.github.com/repos/X/Y/pulls/7",
            latest_comment_url: "https://api.github.com/repos/X/Y/pulls/7",
          },
        })
      )
    ).toBe("issue");
  });

  test("reason=assign + Issue, but latest_comment_url points at a real comment → comment (sticky reason bug)", () => {
    expect(
      classifyNotification(
        makeNotification({
          reason: "assign",
          subject: {
            type: "Issue",
            url: "https://api.github.com/repos/X/Y/issues/1",
            latest_comment_url: "https://api.github.com/repos/X/Y/issues/comments/42",
          },
        })
      )
    ).toBe("comment");
  });

  test("reason=review_requested + PullRequest, no comment yet → pr", () => {
    expect(
      classifyNotification(
        makeNotification({
          reason: "review_requested",
          subject: {
            type: "PullRequest",
            url: "https://api.github.com/repos/X/Y/pulls/7",
            latest_comment_url: "https://api.github.com/repos/X/Y/pulls/7",
          },
        })
      )
    ).toBe("pr");
  });

  test("reason=review_requested + PullRequest, but latest_comment_url points at a real comment → comment (sticky reason bug)", () => {
    expect(
      classifyNotification(
        makeNotification({
          reason: "review_requested",
          subject: {
            type: "PullRequest",
            url: "https://api.github.com/repos/X/Y/pulls/7",
            latest_comment_url: "https://api.github.com/repos/X/Y/issues/comments/55",
          },
        })
      )
    ).toBe("comment");
  });

  test("reason=author + Issue → comment (someone commented on our issue)", () => {
    expect(
      classifyNotification(
        makeNotification({
          reason: "author",
          subject: {
            type: "Issue",
            url: "https://api.github.com/repos/X/Y/issues/5",
            latest_comment_url: "https://api.github.com/repos/X/Y/issues/comments/55",
          },
        })
      )
    ).toBe("comment");
  });

  test("reason=author + PullRequest + comment URL → pr_review_comment", () => {
    expect(
      classifyNotification(
        makeNotification({
          reason: "author",
          subject: {
            type: "PullRequest",
            url: "https://api.github.com/repos/X/Y/pulls/2",
            latest_comment_url:
              "https://api.github.com/repos/X/Y/issues/comments/55",
          },
        })
      )
    ).toBe("pr_review_comment");
  });

  test("reason=author + PullRequest + NO comment URL → pr_review_comment (inline diff comment)", () => {
    expect(
      classifyNotification(
        makeNotification({
          reason: "author",
          subject: {
            type: "PullRequest",
            url: "https://api.github.com/repos/X/Y/pulls/2",
            latest_comment_url: null,
          },
        })
      )
    ).toBe("pr_review_comment");
  });

  test("reason=ci_activity → unknown", () => {
    expect(
      classifyNotification(
        makeNotification({ reason: "ci_activity" })
      )
    ).toBe("unknown");
  });
});

// ── classifyNotification: regression — sticky "assign" reason ───────────────
//
// GitHub's notification `reason` field is not per-event: it reflects why we
// are subscribed to the thread, not what the latest activity was. Once
// assigned to an issue, follow-up comments on that same issue keep arriving
// with reason: "assign" instead of "comment"/"author".
//
// Observed live on 2026-07-14: issue #1 (Husterknupp/hotel-metropol-incubator)
// has been assigned to arostovd since 2026-04-08 with no new assignment
// since. Three plain follow-up comments that day each still triggered a
// false "Work on Issue #1" event (gh-event-listener.log, 16:03:08, 16:23:08,
// 16:48:55 UTC) instead of the expected "React to comment" event.
//
// Confirmed via a live A/B test the same day: a genuine re-assignment
// notification has subject.latest_comment_url === subject.url (nothing to
// comment on yet); a follow-up comment notification (still reason: "assign")
// has latest_comment_url pointing at the actual comment. classifyNotification
// now uses that field to tell the two apart. Tracked in
// Husterknupp/hotel-metropol-incubator issue #1.
describe("classifyNotification — regression: sticky 'assign' reason on follow-up comments", () => {
  test("a follow-up comment on an already-assigned issue should classify as 'comment', not 'issue'", () => {
    const staleAssignNotif = makeNotification({
      reason: "assign",
      subject: {
        type: "Issue",
        url: "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/issues/1",
        latest_comment_url:
          "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/issues/comments/4971711162",
      },
    });

    expect(classifyNotification(staleAssignNotif)).toBe("comment");
  });
});

// ── acquireLock — regression: genuine assignment must not be locked as a comment ──
//
// acquireLock always derived a "comment ID" from subject.latest_comment_url.
// For a genuine assignment/review_request, latest_comment_url === subject.url
// (nothing has been commented on yet), so that "comment ID" ends up being the
// issue/PR number itself (e.g. "1"). addReaction then POSTs to
// /issues/comments/1/reactions — the wrong endpoint, since comment ID 1 is
// not this notification's comment. Against the real GitHub API this throws
// (404), which run() catches as "Failed to acquire lock" — the event is
// never sent for a first-time assignment. Fix: react on the issue/PR itself
// (/issues/{number}/reactions) when there's no real comment to lock yet.
describe("acquireLock/releaseLock — regression: genuine assignment locks the issue, not a nonexistent comment", () => {
  test("genuine assignment (latest_comment_url === subject.url) locks via issue-level reaction, not a comment", () => {
    const assignNotif = makeNotification({
      reason: "assign",
      subject: {
        type: "Issue",
        url: "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/issues/1",
        latest_comment_url:
          "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/issues/1",
      },
    });
    const ghAdapter = makeGhAdapter();

    const lock = acquireLock(assignNotif, ghAdapter);

    expect(ghAdapter.addIssueReaction).toHaveBeenCalledWith(
      expect.objectContaining({ issueNumber: "1", content: "eyes" })
    );
    expect(ghAdapter.addReaction).not.toHaveBeenCalled();
    expect(lock).toEqual({ commentId: "1", lockType: "issue_subject" });
  });

  test("follow-up comment on an already-assigned issue still locks via comment-level reaction", () => {
    const commentNotif = makeNotification({
      reason: "assign",
      subject: {
        type: "Issue",
        url: "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/issues/1",
        latest_comment_url:
          "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/issues/comments/42",
      },
    });
    const ghAdapter = makeGhAdapter();

    const lock = acquireLock(commentNotif, ghAdapter);

    expect(ghAdapter.addReaction).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: "42", content: "eyes" })
    );
    expect(ghAdapter.addIssueReaction).not.toHaveBeenCalled();
    expect(lock).toEqual({ commentId: "42", lockType: "issue" });
  });

  test("releaseLock removes the issue-level reaction for lockType 'issue_subject'", () => {
    const assignNotif = makeNotification({
      reason: "assign",
      subject: {
        type: "Issue",
        url: "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/issues/1",
        latest_comment_url:
          "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/issues/1",
      },
    });
    const ghAdapter = makeGhAdapter({
      getIssueReactions: jest.fn().mockReturnValue([{ content: "eyes", id: 77 }]),
    });

    releaseLock(
      assignNotif,
      { commentId: "1", lockType: "issue_subject" },
      ghAdapter
    );

    expect(ghAdapter.removeIssueReaction).toHaveBeenCalledWith(
      expect.objectContaining({ issueNumber: "1", reactionId: 77 })
    );
  });
});

// ── resolveActor ──────────────────────────────────────────────────────────────

describe("resolveActor", () => {
  test("mention: fetches actor from latest_comment_url", () => {
    const notif = makeNotification({
      reason: "mention",
      subject: {
        type: "PullRequest",
        url: "https://api.github.com/repos/X/Y/pulls/2",
        latest_comment_url: "https://api.github.com/repos/X/Y/issues/comments/99",
      },
    });
    const ghAdapter = makeGhAdapter({
      getActorFromUrl: jest.fn().mockReturnValue("Husterknupp"),
    });

    expect(resolveActor(notif, ghAdapter)).toBe("Husterknupp");
    expect(ghAdapter.getActorFromUrl).toHaveBeenCalledWith(
      "https://api.github.com/repos/X/Y/issues/comments/99"
    );
  });

  test("comment: fetches actor from latest_comment_url (thread reply)", () => {
    const notif = makeNotification({
      reason: "comment",
      subject: {
        type: "Issue",
        url: "https://api.github.com/repos/X/Y/issues/5",
        latest_comment_url: "https://api.github.com/repos/X/Y/issues/comments/88",
      },
    });
    const ghAdapter = makeGhAdapter({
      getActorFromUrl: jest.fn().mockReturnValue("Husterknupp"),
    });

    expect(resolveActor(notif, ghAdapter)).toBe("Husterknupp");
    expect(ghAdapter.getActorFromUrl).toHaveBeenCalledWith(
      "https://api.github.com/repos/X/Y/issues/comments/88"
    );
  });

  test("assign: resolves the ASSIGNER from the timeline, not the issue creator", () => {
    const notif = makeNotification({
      reason: "assign",
      subject: {
        type: "Issue",
        url: "https://api.github.com/repos/X/Y/issues/1",
        latest_comment_url:
          "https://api.github.com/repos/X/Y/issues/1",
      },
      repository: { full_name: "X/Y" },
    });
    const ghAdapter = makeGhAdapter({
      // Creator lookup would return this — it must NOT be used for assignments.
      getActorFromUrl: jest.fn().mockReturnValue("arostovd"),
      getIssueTimeline: jest.fn().mockReturnValue([
        {
          event: "assigned",
          actor: { login: "Husterknupp" },
          assignee: { login: "arostovd" },
        },
      ]),
    });

    // Actor is the assigner (Husterknupp), taken from the timeline.
    expect(resolveActor(notif, ghAdapter)).toBe("Husterknupp");
    expect(ghAdapter.getIssueTimeline).toHaveBeenCalledWith({
      owner: "X",
      repo: "Y",
      issueNumber: "1",
    });
    // The creator endpoint is not consulted for a genuine assignment.
    expect(ghAdapter.getActorFromUrl).not.toHaveBeenCalled();
  });

  test("assign: picks the LAST assignment aimed at us (re-assign wins over earlier assign/unassign)", () => {
    const notif = makeNotification({
      reason: "assign",
      subject: {
        type: "Issue",
        url: "https://api.github.com/repos/X/Y/issues/1",
        latest_comment_url:
          "https://api.github.com/repos/X/Y/issues/1",
      },
    });
    const ghAdapter = makeGhAdapter({
      getIssueTimeline: jest.fn().mockReturnValue([
        { event: "assigned", actor: { login: "SomeoneElse" }, assignee: { login: "arostovd" } },
        { event: "unassigned", actor: { login: "SomeoneElse" }, assignee: { login: "arostovd" } },
        { event: "assigned", actor: { login: "Husterknupp" }, assignee: { login: "arostovd" } },
        // An assignment of a DIFFERENT user must be ignored.
        { event: "assigned", actor: { login: "Intruder" }, assignee: { login: "somedev" } },
      ]),
    });

    expect(resolveActor(notif, ghAdapter)).toBe("Husterknupp");
  });

  test("assign but actually a comment: fetches actor from the comment, not the issue creator", () => {
    const notif = makeNotification({
      reason: "assign",
      subject: {
        type: "Issue",
        url: "https://api.github.com/repos/X/Y/issues/1",
        latest_comment_url: "https://api.github.com/repos/X/Y/issues/comments/42",
      },
    });
    const ghAdapter = makeGhAdapter({
      getActorFromUrl: jest.fn().mockReturnValue("Husterknupp"),
    });

    expect(resolveActor(notif, ghAdapter)).toBe("Husterknupp");
    expect(ghAdapter.getActorFromUrl).toHaveBeenCalledWith(
      "https://api.github.com/repos/X/Y/issues/comments/42"
    );
  });

  test("review_requested: fetches actor from subject URL (PR creator)", () => {
    const notif = makeNotification({
      reason: "review_requested",
      subject: {
        type: "PullRequest",
        url: "https://api.github.com/repos/X/Y/pulls/7",
        latest_comment_url: null,
      },
    });
    const ghAdapter = makeGhAdapter({
      getActorFromUrl: jest.fn().mockReturnValue("Husterknupp"),
    });

    expect(resolveActor(notif, ghAdapter)).toBe("Husterknupp");
    expect(ghAdapter.getActorFromUrl).toHaveBeenCalledWith(
      "https://api.github.com/repos/X/Y/pulls/7"
    );
  });

  test("author with comment: fetches from latest_comment_url", () => {
    const notif = makeNotification({
      reason: "author",
      subject: {
        type: "PullRequest",
        url: "https://api.github.com/repos/X/Y/pulls/2",
        latest_comment_url: "https://api.github.com/repos/X/Y/issues/comments/55",
      },
    });
    const ghAdapter = makeGhAdapter({
      getActorFromUrl: jest.fn().mockReturnValue("Husterknupp"),
    });

    expect(resolveActor(notif, ghAdapter)).toBe("Husterknupp");
    expect(ghAdapter.getActorFromUrl).toHaveBeenCalledWith(
      "https://api.github.com/repos/X/Y/issues/comments/55"
    );
  });

  test("author with NO latest_comment_url: fetches from PR review comments (inline diff)", () => {
    const notif = makeNotification({
      reason: "author",
      subject: {
        type: "PullRequest",
        url: "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/pulls/3",
        latest_comment_url: null,
      },
    });
    const ghAdapter = makeGhAdapter({
      getLatestPrReviewComment: jest.fn().mockReturnValue({
        id: 9001,
        user: { login: "Husterknupp" },
      }),
    });

    expect(resolveActor(notif, ghAdapter)).toBe("Husterknupp");
    expect(ghAdapter.getLatestPrReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ prNumber: "3" })
    );
  });

  test("unknown reason without URLs → null", () => {
    const notif = makeNotification({
      reason: "ci_activity",
      subject: {
        type: "CheckSuite",
        url: null,
        latest_comment_url: null,
      },
    });
    const ghAdapter = makeGhAdapter();

    expect(resolveActor(notif, ghAdapter)).toBeNull();
  });
});

// ── buildEventMessage ─────────────────────────────────────────────────────────

describe("buildEventMessage", () => {
  const notif = makeNotification();

  test("comment message", () => {
    expect(buildEventMessage("comment", notif)).toMatch(
      /React to Husterknupp's GitHub comment/
    );
  });

  test("comment message includes the direct comment URL from the payload", () => {
    // Spares the agent an expensive search for the triggering comment.
    expect(buildEventMessage("comment", notif)).toContain(
      "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/issues/comments/99"
    );
  });

  test("issue message includes Issue type and number", () => {
    const issueNotif = makeNotification({
      subject: {
        type: "Issue",
        url: "https://api.github.com/repos/X/Y/issues/1",
      },
    });
    expect(buildEventMessage("issue", issueNotif)).toMatch(/Issue #1/);
  });

  test("issue message includes PullRequest type when assigned to a PR", () => {
    const prAssignNotif = makeNotification({
      subject: {
        type: "PullRequest",
        url: "https://api.github.com/repos/X/Y/pulls/7",
      },
    });
    expect(buildEventMessage("issue", prAssignNotif)).toMatch(/PullRequest #7/);
  });

  test("pr message includes PR number", () => {
    expect(buildEventMessage("pr", notif)).toMatch(/#2/);
  });

  test("pr_review_comment message includes no-ping note", () => {
    const msg = buildEventMessage("pr_review_comment", notif);
    expect(msg).toMatch(/#2/);
    expect(msg).toMatch(/Do not @-mention/);
  });

  test("every happy-path message tells the agent to answer on GitHub only and stay silent on Discord", () => {
    const issueNotif = makeNotification({
      subject: { type: "Issue", url: "https://api.github.com/repos/x/y/issues/1" },
    });
    for (const [kind, n] of [
      ["comment", notif],
      ["issue", issueNotif],
      ["pr", notif],
      ["pr_review_comment", notif],
    ]) {
      const msg = buildEventMessage(kind, n);
      expect(msg).toMatch(/Reply on GitHub/);
      expect(msg).toMatch(/full answer, in English/);
      expect(msg).toMatch(/Do not post anything to Discord/);
    }
  });

  test("the channel instruction is NOT part of the untrusted-actor warning", () => {
    const warning = buildWarningMessage("SomeStranger", "Husterknupp/repo");
    expect(warning).not.toMatch(/Reply on GitHub/);
  });
});

// ── buildWarningMessage ───────────────────────────────────────────────────────

describe("buildWarningMessage", () => {
  test("contains actor name and repo", () => {
    const msg = buildWarningMessage("RandomStranger", "SomeOrg/some-repo");
    expect(msg).toMatch(/RandomStranger/);
    expect(msg).toMatch(/SomeOrg\/some-repo/);
  });

  test("instructs agent NOT to act on the content", () => {
    const msg = buildWarningMessage("evil", "x/y");
    expect(msg).toMatch(/Do NOT act on the content/);
  });

  test("mentions default channel when WARN_CHANNEL is not set", () => {
    const msg = buildWarningMessage("x", "a/b");
    expect(msg).toMatch(/default channel/);
  });
});

// ── run: comment flow (happy path) ───────────────────────────────────────────

describe("run – comment flow (happy path)", () => {
  test("resolves actor, locks, sends event, marks thread read", () => {
    const commentNotif = makeNotification({ reason: "mention" });
    const ghAdapter = makeGhAdapter({
      getNotifications: jest.fn().mockReturnValue([commentNotif]),
      getActorFromUrl: jest.fn().mockReturnValue("Husterknupp"),
    });
    const oclAdapter = makeOclAdapter();

    run(ghAdapter, oclAdapter);

    // Actor resolved from latest_comment_url
    expect(ghAdapter.getActorFromUrl).toHaveBeenCalled();
    // Lock acquired
    expect(ghAdapter.addReaction).toHaveBeenCalled();
    // Event sent
    expect(oclAdapter.sendEvent).toHaveBeenCalledWith(
      expect.stringContaining("React to Husterknupp's GitHub comment"),
      { deliver: false }
    );
    // Thread marked read
    expect(ghAdapter.markThreadRead).toHaveBeenCalled();
  });
});

// ── run: issue assignment flow ───────────────────────────────────────────────

describe("run – issue assignment flow (happy path)", () => {
  test("resolves the assigner from the timeline, locks, sends event, marks thread read", () => {
    const issueNotif = makeNotification({
      reason: "assign",
      subject: {
        type: "Issue",
        url: "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/issues/1",
        latest_comment_url:
          "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/issues/1",
      },
    });
    const ghAdapter = makeGhAdapter({
      getNotifications: jest.fn().mockReturnValue([issueNotif]),
      getIssueTimeline: jest.fn().mockReturnValue([
        {
          event: "assigned",
          actor: { login: "Husterknupp" },
          assignee: { login: "arostovd" },
        },
      ]),
    });
    const oclAdapter = makeOclAdapter();

    run(ghAdapter, oclAdapter);

    // Actor (assigner) resolved from the timeline, not the issue creator
    expect(ghAdapter.getIssueTimeline).toHaveBeenCalledWith({
      owner: "Husterknupp",
      repo: "hotel-metropol-incubator",
      issueNumber: "1",
    });
    // Locked on the issue itself, not a (nonexistent) comment
    expect(ghAdapter.addIssueReaction).toHaveBeenCalled();
    expect(ghAdapter.addReaction).not.toHaveBeenCalled();
    expect(oclAdapter.sendEvent).toHaveBeenCalledWith(
      expect.stringContaining("Work on Issue #1"),
      { deliver: false }
    );
    expect(ghAdapter.markThreadRead).toHaveBeenCalled();
  });

  // Regression — the trigger that started all this. We authored the issue, so
  // the OLD creator-based resolver returned SELF_ACTOR and the assignment was
  // dropped as "self-triggered". With the assigner taken from the timeline
  // (Husterknupp = trusted), the assignment must fire even though we created it.
  test("regression: self-authored issue assigned to us by the trusted owner still fires", () => {
    const issueNotif = makeNotification({
      reason: "assign",
      subject: {
        type: "Issue",
        url: "https://api.github.com/repos/Husterknupp/party-insights-shenanigans/issues/48",
        latest_comment_url:
          "https://api.github.com/repos/Husterknupp/party-insights-shenanigans/issues/48",
      },
      repository: { full_name: "Husterknupp/party-insights-shenanigans" },
    });
    const ghAdapter = makeGhAdapter({
      getNotifications: jest.fn().mockReturnValue([issueNotif]),
      // Creator == SELF_ACTOR: this is exactly what used to trip the gate.
      getActorFromUrl: jest.fn().mockReturnValue("arostovd"),
      getIssueTimeline: jest.fn().mockReturnValue([
        { event: "assigned", actor: { login: "Husterknupp" }, assignee: { login: "arostovd" } },
      ]),
    });
    const oclAdapter = makeOclAdapter();

    run(ghAdapter, oclAdapter);

    expect(oclAdapter.sendEvent).toHaveBeenCalledWith(
      expect.stringContaining("Work on Issue #48"),
      { deliver: false }
    );
    expect(ghAdapter.addIssueReaction).toHaveBeenCalled();
    expect(ghAdapter.markThreadRead).toHaveBeenCalled();
  });
});

// ── run: PR review request flow ──────────────────────────────────────────────

describe("run – PR review request flow (happy path)", () => {
  test("resolves actor, locks, sends review-PR event, marks thread read", () => {
    const prNotif = makeNotification({
      reason: "review_requested",
      subject: {
        type: "PullRequest",
        url: "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/pulls/7",
        latest_comment_url:
          "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/pulls/7",
      },
    });
    const ghAdapter = makeGhAdapter({
      getNotifications: jest.fn().mockReturnValue([prNotif]),
      getActorFromUrl: jest.fn().mockReturnValue("Husterknupp"),
    });
    const oclAdapter = makeOclAdapter();

    run(ghAdapter, oclAdapter);

    expect(ghAdapter.getActorFromUrl).toHaveBeenCalledWith(
      "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/pulls/7"
    );
    // Locked on the PR itself, not a (nonexistent) comment
    expect(ghAdapter.addIssueReaction).toHaveBeenCalled();
    expect(ghAdapter.addReaction).not.toHaveBeenCalled();
    expect(oclAdapter.sendEvent).toHaveBeenCalledWith(
      expect.stringContaining("Review PR #7"),
      { deliver: false }
    );
    expect(ghAdapter.markThreadRead).toHaveBeenCalled();
  });
});

// ── run: PR review comment flow ──────────────────────────────────────────────

describe("run – PR review comment flow (happy path)", () => {
  test("resolves actor from comment, locks, sends pr_review_comment event", () => {
    const reviewNotif = makeNotification({
      reason: "author",
      subject: {
        type: "PullRequest",
        url: "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/pulls/2",
        latest_comment_url:
          "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/issues/comments/55",
      },
    });
    const ghAdapter = makeGhAdapter({
      getNotifications: jest.fn().mockReturnValue([reviewNotif]),
      getActorFromUrl: jest.fn().mockReturnValue("Husterknupp"),
    });
    const oclAdapter = makeOclAdapter();

    run(ghAdapter, oclAdapter);

    expect(ghAdapter.getActorFromUrl).toHaveBeenCalledWith(
      "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/issues/comments/55"
    );
    expect(ghAdapter.addReaction).toHaveBeenCalled();
    expect(oclAdapter.sendEvent).toHaveBeenCalledWith(
      expect.stringMatching(/review comment on your PR #2/),
      { deliver: false }
    );
    expect(ghAdapter.markThreadRead).toHaveBeenCalled();
  });

  test("inline diff comment (latest_comment_url=null): batches all review comments, locks each, one event", () => {
    const inlineReviewNotif = makeNotification({
      reason: "author",
      subject: {
        type: "PullRequest",
        url: "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/pulls/3",
        latest_comment_url: null,
      },
    });
    const ghAdapter = makeGhAdapter({
      getNotifications: jest.fn().mockReturnValue([inlineReviewNotif]),
      getPrReviewComments: jest.fn().mockReturnValue([
        { id: 9001, user: { login: "Husterknupp" }, body: "First comment" },
      ]),
      getPrReviewCommentReactions: jest.fn().mockReturnValue([]),
    });
    const oclAdapter = makeOclAdapter();

    run(ghAdapter, oclAdapter);

    // Fetched the FULL list of review comments (not just the latest)
    expect(ghAdapter.getPrReviewComments).toHaveBeenCalledWith(
      expect.objectContaining({ prNumber: "3" })
    );
    // Lock set via pulls/comments endpoint
    expect(ghAdapter.addPrReviewCommentReaction).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: "9001", content: "eyes" })
    );
    expect(oclAdapter.sendEvent).toHaveBeenCalledWith(
      expect.stringMatching(/review comment\(s\) on your PR #3/),
      { deliver: false }
    );
    expect(ghAdapter.markThreadRead).toHaveBeenCalled();
  });

  test("issue #8: a bundled review with several comments processes EVERY trusted comment, not just the newest", () => {
    const inlineReviewNotif = makeNotification({
      reason: "author",
      subject: {
        type: "PullRequest",
        url: "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/pulls/3",
        latest_comment_url: null,
      },
    });
    // Four inline comments from the trusted reviewer + one of our own replies.
    const ghAdapter = makeGhAdapter({
      getNotifications: jest.fn().mockReturnValue([inlineReviewNotif]),
      getPrReviewComments: jest.fn().mockReturnValue([
        { id: 3582979691, user: { login: "Husterknupp" }, body: "timeout question" },
        { id: 3583055321, user: { login: "Husterknupp" }, body: "lock release question" },
        { id: 3583072147, user: { login: "Husterknupp" }, body: "make these explicit" },
        { id: 3583107478, user: { login: "Husterknupp" }, body: "untrusted actor test" },
        { id: 3585505524, user: { login: "arostovd" }, body: "our own reply" },
      ]),
      getPrReviewCommentReactions: jest.fn().mockReturnValue([]),
    });
    const oclAdapter = makeOclAdapter();

    run(ghAdapter, oclAdapter);

    // All four trusted comments get locked — our own reply does NOT
    const lockedIds = ghAdapter.addPrReviewCommentReaction.mock.calls
      .filter((c) => c[0].content === "eyes")
      .map((c) => c[0].commentId);
    expect(lockedIds).toEqual(
      expect.arrayContaining(["3582979691", "3583055321", "3583072147", "3583107478"])
    );
    expect(lockedIds).not.toContain("3585505524");
    // 4 locks + 4 success reactions (issue #7) once the batch dispatch succeeds
    expect(ghAdapter.addPrReviewCommentReaction).toHaveBeenCalledTimes(8);

    // Exactly ONE agent event that names all four comments
    expect(oclAdapter.sendEvent).toHaveBeenCalledTimes(1);
    const batchMsg = oclAdapter.sendEvent.mock.calls[0][0];
    expect(batchMsg).toMatch(/React to 4 review comment\(s\)/);
    for (const id of [3582979691, 3583055321, 3583072147, 3583107478]) {
      expect(batchMsg).toContain(String(id));
    }

    // Thread only marked read after the batch was dispatched
    expect(ghAdapter.markThreadRead).toHaveBeenCalledWith(inlineReviewNotif.id);
  });

  test("issue #8: already-handled comments (carrying our lock) are not re-processed", () => {
    const inlineReviewNotif = makeNotification({
      reason: "author",
      subject: {
        type: "PullRequest",
        url: "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/pulls/3",
        latest_comment_url: null,
      },
    });
    const ghAdapter = makeGhAdapter({
      getNotifications: jest.fn().mockReturnValue([inlineReviewNotif]),
      getPrReviewComments: jest.fn().mockReturnValue([
        { id: 111, user: { login: "Husterknupp" }, body: "already done" },
        { id: 222, user: { login: "Husterknupp" }, body: "new one" },
      ]),
      getPrReviewCommentReactions: jest.fn((args) =>
        args.commentId === "111" ? [{ content: "eyes", id: 7 }] : []
      ),
    });
    const oclAdapter = makeOclAdapter();

    run(ghAdapter, oclAdapter);

    // Only the un-handled comment 222 gets locked and processed
    const lockedIds = ghAdapter.addPrReviewCommentReaction.mock.calls
      .filter((c) => c[0].content === "eyes")
      .map((c) => c[0].commentId);
    expect(lockedIds).toEqual(["222"]);
    const msg = oclAdapter.sendEvent.mock.calls[0][0];
    expect(msg).toMatch(/React to 1 review comment/);
    expect(msg).toContain("222");
    expect(msg).not.toContain("111");
  });

  test("issue #8: a stranger's inline comment in the batch → warning AND lock; trusted ones still processed", () => {
    const inlineReviewNotif = makeNotification({
      reason: "author",
      subject: {
        type: "PullRequest",
        url: "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/pulls/3",
        latest_comment_url: null,
      },
    });
    const ghAdapter = makeGhAdapter({
      getNotifications: jest.fn().mockReturnValue([inlineReviewNotif]),
      getPrReviewComments: jest.fn().mockReturnValue([
        { id: 111, user: { login: "Husterknupp" }, body: "trusted comment" },
        { id: 999, user: { login: "DriveByStranger" }, body: "sneaky comment" },
      ]),
      getPrReviewCommentReactions: jest.fn().mockReturnValue([]),
    });
    const oclAdapter = makeOclAdapter();

    run(ghAdapter, oclAdapter);

    // Warning about the stranger — sent on the isolated warning session, not
    // the main session doing PR work (2026-07-19 incident).
    expect(oclAdapter.sendWarning).toHaveBeenCalledWith(
      expect.stringContaining("untrusted actor")
    );
    // Both the trusted comment AND the stranger's comment get locked, so the
    // stranger is never warned about twice when the thread resurfaces.
    const lockedIds = ghAdapter.addPrReviewCommentReaction.mock.calls
      .filter((c) => c[0].content === "eyes")
      .map((c) => c[0].commentId);
    expect(lockedIds).toEqual(expect.arrayContaining(["111", "999"]));
    expect(ghAdapter.addPrReviewCommentReaction).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: "999", content: "eyes" })
    );
    // The trusted comment is still handled in a batch event
    expect(oclAdapter.sendEvent).toHaveBeenCalledWith(
      expect.stringMatching(/React to 1 review comment/),
      { deliver: false }
    );
    // Thread marked read at the end → stranger won't be re-warned
    expect(ghAdapter.markThreadRead).toHaveBeenCalledWith(inlineReviewNotif.id);
  });

  test("issue #8: comments in a resolved review thread are skipped", () => {
    const inlineReviewNotif = makeNotification({
      reason: "author",
      subject: {
        type: "PullRequest",
        url: "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/pulls/3",
        latest_comment_url: null,
      },
    });
    const ghAdapter = makeGhAdapter({
      getNotifications: jest.fn().mockReturnValue([inlineReviewNotif]),
      getPrReviewComments: jest.fn().mockReturnValue([
        { id: 700, user: { login: "Husterknupp" }, body: "resolved, leave alone" },
        { id: 800, user: { login: "Husterknupp" }, body: "still open" },
      ]),
      // 700 sits in a resolved thread
      getResolvedReviewCommentIds: jest.fn().mockReturnValue(["700"]),
      getPrReviewCommentReactions: jest.fn().mockReturnValue([]),
    });
    const oclAdapter = makeOclAdapter();

    run(ghAdapter, oclAdapter);

    const lockedIds = ghAdapter.addPrReviewCommentReaction.mock.calls
      .filter((c) => c[0].content === "eyes")
      .map((c) => c[0].commentId);
    expect(lockedIds).toEqual(["800"]);
    const msg = oclAdapter.sendEvent.mock.calls[0][0];
    expect(msg).toMatch(/React to 1 review comment/);
    expect(msg).toContain("800");
    expect(msg).not.toContain("700");
  });

  // Issue #16 review (Husterknupp): releasing the locks here would let the
  // very next poll re-acquire them and hit the same non-transient failure
  // again — the once-a-minute loop from 2026-07-20/21 (#7/#8) that this
  // feature exists to prevent. Locks now stay in place; a human must clear
  // 👀 once the underlying cause is fixed.
  test("issue #16: sendEvent failure leaves every lock in place (does not retry) and marks every comment with the error reaction", () => {
    const inlineReviewNotif = makeNotification({
      reason: "author",
      subject: {
        type: "PullRequest",
        url: "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/pulls/3",
        latest_comment_url: null,
      },
    });
    const ghAdapter = makeGhAdapter({
      getNotifications: jest.fn().mockReturnValue([inlineReviewNotif]),
      getPrReviewComments: jest.fn().mockReturnValue([
        { id: 111, user: { login: "Husterknupp" }, body: "a" },
        { id: 222, user: { login: "Husterknupp" }, body: "b" },
      ]),
      getPrReviewCommentReactions: jest
        .fn()
        .mockReturnValueOnce([]) // 111 partition
        .mockReturnValueOnce([]), // 222 partition
    });
    const oclAdapter = makeOclAdapter({
      sendEvent: jest.fn().mockImplementation(() => {
        throw new Error("Gateway down");
      }),
    });

    run(ghAdapter, oclAdapter);

    // Locks NOT released — the notification is left visibly stuck (👀+😕)
    // rather than silently retried. Thread IS marked read (issue #16 review):
    // the lock already blocks reprocessing, so leaving it unread would only
    // cause repeated "already locked" no-op polls without preserving any
    // signal that isn't already visible via the 😕 reaction on the comment.
    expect(ghAdapter.removePrReviewCommentReaction).not.toHaveBeenCalled();
    expect(ghAdapter.markThreadRead).toHaveBeenCalledWith(inlineReviewNotif.id);
    // Genuine failure leaves a visible error marker per comment, on top of
    // the still-in-place 👀 lock.
    expect(ghAdapter.addPrReviewCommentReaction).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: "111", content: "confused" })
    );
    expect(ghAdapter.addPrReviewCommentReaction).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: "222", content: "confused" })
    );
  });

  test("issue #6/#16: ETIMEDOUT on the batch leaves every lock in place, adds the timeout reaction, and does not retry", () => {
    const inlineReviewNotif = makeNotification({
      reason: "author",
      subject: {
        type: "PullRequest",
        url: "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/pulls/3",
        latest_comment_url: null,
      },
    });
    const ghAdapter = makeGhAdapter({
      getNotifications: jest.fn().mockReturnValue([inlineReviewNotif]),
      getPrReviewComments: jest.fn().mockReturnValue([
        { id: 111, user: { login: "Husterknupp" }, body: "a" },
        { id: 222, user: { login: "Husterknupp" }, body: "b" },
      ]),
      getPrReviewCommentReactions: jest.fn().mockReturnValue([]),
    });
    const err = new Error("Command timed out");
    err.code = "ETIMEDOUT";
    const oclAdapter = makeOclAdapter({
      sendEvent: jest.fn().mockImplementation(() => {
        throw err;
      }),
    });

    run(ghAdapter, oclAdapter);

    expect(ghAdapter.removePrReviewCommentReaction).not.toHaveBeenCalled();
    expect(ghAdapter.addPrReviewCommentReaction).not.toHaveBeenCalledWith(
      expect.objectContaining({ content: "confused" })
    );
    expect(ghAdapter.addPrReviewCommentReaction).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: "111", content: "+1" })
    );
    expect(ghAdapter.addPrReviewCommentReaction).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: "222", content: "+1" })
    );
    // Thread IS marked read (issue #16 review) — the lock already blocks
    // reprocessing, so an unread thread would only produce repeated
    // "already locked" no-op polls, not a preserved signal.
    expect(ghAdapter.markThreadRead).toHaveBeenCalledWith(inlineReviewNotif.id);
  });

  test("issue #7: success adds the success reaction on top of every lock in the batch", () => {
    const inlineReviewNotif = makeNotification({
      reason: "author",
      subject: {
        type: "PullRequest",
        url: "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/pulls/3",
        latest_comment_url: null,
      },
    });
    const ghAdapter = makeGhAdapter({
      getNotifications: jest.fn().mockReturnValue([inlineReviewNotif]),
      getPrReviewComments: jest.fn().mockReturnValue([
        { id: 111, user: { login: "Husterknupp" }, body: "a" },
        { id: 222, user: { login: "Husterknupp" }, body: "b" },
      ]),
      getPrReviewCommentReactions: jest.fn().mockReturnValue([]),
    });
    const oclAdapter = makeOclAdapter();

    run(ghAdapter, oclAdapter);

    for (const id of ["111", "222"]) {
      expect(ghAdapter.addPrReviewCommentReaction).toHaveBeenCalledWith(
        expect.objectContaining({ commentId: id, content: "eyes" })
      );
      expect(ghAdapter.addPrReviewCommentReaction).toHaveBeenCalledWith(
        expect.objectContaining({ commentId: id, content: "rocket" })
      );
    }
    expect(ghAdapter.markThreadRead).toHaveBeenCalledWith(inlineReviewNotif.id);
  });
});

// ── run: already locked ──────────────────────────────────────────────────────

describe("run – already locked", () => {
  test("skips event when lock reaction already present (issue comment)", () => {
    const notif = makeNotification({ reason: "mention" });
    const ghAdapter = makeGhAdapter({
      getNotifications: jest.fn().mockReturnValue([notif]),
      getActorFromUrl: jest.fn().mockReturnValue("Husterknupp"),
      getReactions: jest.fn().mockReturnValue([{ content: "eyes", id: 1 }]),
    });
    const oclAdapter = makeOclAdapter();

    run(ghAdapter, oclAdapter);

    expect(ghAdapter.addReaction).not.toHaveBeenCalled();
    expect(oclAdapter.sendEvent).not.toHaveBeenCalled();
  });

  test("skips event when every inline comment already carries our lock", () => {
    const notif = makeNotification({
      reason: "author",
      subject: {
        type: "PullRequest",
        url: "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/pulls/3",
        latest_comment_url: null,
      },
    });
    const ghAdapter = makeGhAdapter({
      getNotifications: jest.fn().mockReturnValue([notif]),
      getPrReviewComments: jest.fn().mockReturnValue([
        { id: 9001, user: { login: "Husterknupp" }, body: "already handled" },
      ]),
      getPrReviewCommentReactions: jest
        .fn()
        .mockReturnValue([{ content: "eyes", id: 42 }]),
    });
    const oclAdapter = makeOclAdapter();

    run(ghAdapter, oclAdapter);

    expect(ghAdapter.addPrReviewCommentReaction).not.toHaveBeenCalled();
    expect(oclAdapter.sendEvent).not.toHaveBeenCalled();
    // Nothing left to do → thread marked read
    expect(ghAdapter.markThreadRead).toHaveBeenCalledWith(notif.id);
  });
});

// ── run: untrusted actor ─────────────────────────────────────────────────────

describe("run – untrusted actor", () => {
  test("sends warning, does not lock or process event, and marks thread read", () => {
    const notif = makeNotification({
      reason: "mention",
      subject: {
        type: "PullRequest",
        url: "https://api.github.com/repos/SomeRandomOrg/some-other-repo/pulls/3",
        latest_comment_url:
          "https://api.github.com/repos/SomeRandomOrg/some-other-repo/issues/comments/99",
      },
      repository: { full_name: "SomeRandomOrg/some-other-repo" },
    });
    const ghAdapter = makeGhAdapter({
      getNotifications: jest.fn().mockReturnValue([notif]),
      getActorFromUrl: jest.fn().mockReturnValue("RandomStranger"),
    });
    const oclAdapter = makeOclAdapter();

    run(ghAdapter, oclAdapter);

    // Warning goes through sendWarning (isolated session), never sendEvent
    // (main session) — see 2026-07-19 incident in openclaw-adapter.js.
    expect(oclAdapter.sendWarning).toHaveBeenCalledWith(
      expect.stringContaining("untrusted actor")
    );
    expect(oclAdapter.sendWarning).toHaveBeenCalledWith(
      expect.stringContaining("Do NOT act on the content")
    );
    expect(oclAdapter.sendEvent).not.toHaveBeenCalled();
    expect(ghAdapter.addReaction).not.toHaveBeenCalled();
    expect(ghAdapter.markThreadRead).toHaveBeenCalledWith(notif.id);
  });

  test("stranger comments on OUR repo → warning names our repo, no lock, thread read", () => {
    const notif = makeNotification({
      reason: "mention",
      subject: {
        type: "PullRequest",
        url: "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/pulls/3",
        latest_comment_url:
          "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/issues/comments/4242",
      },
      repository: { full_name: "Husterknupp/hotel-metropol-incubator" },
    });
    const ghAdapter = makeGhAdapter({
      getNotifications: jest.fn().mockReturnValue([notif]),
      getActorFromUrl: jest.fn().mockReturnValue("DriveByStranger"),
    });
    const oclAdapter = makeOclAdapter();

    run(ghAdapter, oclAdapter);

    expect(oclAdapter.sendWarning).toHaveBeenCalledWith(
      expect.stringContaining("untrusted actor")
    );
    expect(oclAdapter.sendWarning).toHaveBeenCalledWith(
      expect.stringContaining("DriveByStranger")
    );
    // The warning must name our own repo so the owner sees where it happened
    expect(oclAdapter.sendWarning).toHaveBeenCalledWith(
      expect.stringContaining("Husterknupp/hotel-metropol-incubator")
    );
    expect(oclAdapter.sendEvent).not.toHaveBeenCalled();
    // No lock of any kind — even though the repo is ours, an untrusted actor
    // must never cause us to react on the comment.
    expect(ghAdapter.addReaction).not.toHaveBeenCalled();
    expect(ghAdapter.addIssueReaction).not.toHaveBeenCalled();
    expect(ghAdapter.addPrReviewCommentReaction).not.toHaveBeenCalled();
    expect(ghAdapter.markThreadRead).toHaveBeenCalledWith(notif.id);
  });

  test("stranger opens an issue on OUR repo and assigns it to us → warning, no lock, thread read", () => {
    const notif = makeNotification({
      reason: "assign",
      subject: {
        type: "Issue",
        url: "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/issues/17",
        // Genuine assignment: no comment yet, so latest_comment_url === subject.url
        latest_comment_url:
          "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/issues/17",
      },
      repository: { full_name: "Husterknupp/hotel-metropol-incubator" },
    });
    // Genuine assignment → actor is the ASSIGNER from the timeline (the
    // stranger assigned us), which is not the trusted actor → warn, don't act.
    const ghAdapter = makeGhAdapter({
      getNotifications: jest.fn().mockReturnValue([notif]),
      getIssueTimeline: jest.fn().mockReturnValue([
        {
          event: "assigned",
          actor: { login: "DriveByStranger" },
          assignee: { login: "arostovd" },
        },
      ]),
    });
    const oclAdapter = makeOclAdapter();

    run(ghAdapter, oclAdapter);

    expect(oclAdapter.sendWarning).toHaveBeenCalledWith(
      expect.stringContaining("untrusted actor")
    );
    expect(oclAdapter.sendWarning).toHaveBeenCalledWith(
      expect.stringContaining("DriveByStranger")
    );
    expect(oclAdapter.sendWarning).toHaveBeenCalledWith(
      expect.stringContaining("Husterknupp/hotel-metropol-incubator")
    );
    expect(oclAdapter.sendEvent).not.toHaveBeenCalled();
    // A stranger-created issue must not be locked (no eyes reaction on the issue)
    expect(ghAdapter.addIssueReaction).not.toHaveBeenCalled();
    expect(ghAdapter.addReaction).not.toHaveBeenCalled();
    expect(ghAdapter.markThreadRead).toHaveBeenCalledWith(notif.id);
  });
});

// ── run: self-triggered event ────────────────────────────────────────────────

describe("run – self-triggered event (our own bot)", () => {
  test("our own comment → no warning, no lock, no event, thread marked read", () => {
    // PR review comment authored by our own bot account (arostovd). This is the
    // loop we hit on 2026-07-15: replying on a PR made us the latest commenter,
    // the listener resolved arostovd as an actor, flagged it "untrusted" and
    // warned every minute.
    const notif = makeNotification({
      reason: "author",
      subject: {
        type: "PullRequest",
        url: "https://api.github.com/repos/Husterknupp/hotel-metropol-incubator/pulls/3",
        latest_comment_url: null,
      },
      repository: { full_name: "Husterknupp/hotel-metropol-incubator" },
    });
    const ghAdapter = makeGhAdapter({
      getNotifications: jest.fn().mockReturnValue([notif]),
      getPrReviewComments: jest.fn().mockReturnValue([
        { id: 3583107478, user: { login: "arostovd" }, body: "our own reply" },
      ]),
    });
    const oclAdapter = makeOclAdapter();

    run(ghAdapter, oclAdapter);

    // No warning and no agent trigger for our own activity
    expect(oclAdapter.sendEvent).not.toHaveBeenCalled();
    expect(oclAdapter.sendWarning).not.toHaveBeenCalled();
    // No lock of any kind
    expect(ghAdapter.addReaction).not.toHaveBeenCalled();
    expect(ghAdapter.addIssueReaction).not.toHaveBeenCalled();
    expect(ghAdapter.addPrReviewCommentReaction).not.toHaveBeenCalled();
    // But the notification must still be marked read so we don't loop on it
    expect(ghAdapter.markThreadRead).toHaveBeenCalledWith(notif.id);
  });
});

// ── run: OpenClaw sendEvent fails ────────────────────────────────────────────

describe("run – OpenClaw sendEvent fails", () => {
  // Issue #16 review (Husterknupp): a genuine failure does not fix itself on
  // retry, so releasing the lock here would let the very next poll re-acquire
  // it and hit the same failure again — the once-a-minute loop from
  // 2026-07-20/21 that this feature exists to prevent. The lock must stay in
  // place; only a human clearing 👀 should let the notification be reprocessed.
  test("genuine failure does NOT release the lock (issue comment)", () => {
    const notif = makeNotification({ reason: "mention" });
    const ghAdapter = makeGhAdapter({
      getNotifications: jest.fn().mockReturnValue([notif]),
      getActorFromUrl: jest.fn().mockReturnValue("Husterknupp"),
      getReactions: jest.fn().mockReturnValueOnce([]), // acquire only; no release lookup expected
    });
    const oclAdapter = makeOclAdapter({
      sendEvent: jest.fn().mockImplementation(() => {
        throw new Error("Gateway down");
      }),
    });

    run(ghAdapter, oclAdapter);

    expect(ghAdapter.removeReaction).not.toHaveBeenCalled();
  });

  // Issue #7: a genuine CLI failure (bad args, exhausted provider quota — both
  // observed to fail near-instantly) is not the same as our own execSync
  // timeout firing. It gets the error reaction, added on top of the
  // still-in-place lock (issue #16 review — see test above for why the lock
  // itself is not released).
  test("genuine (non-timeout) failure adds the error reaction without releasing the lock (issue comment)", () => {
    const notif = makeNotification({ reason: "mention" });
    const ghAdapter = makeGhAdapter({
      getNotifications: jest.fn().mockReturnValue([notif]),
      getActorFromUrl: jest.fn().mockReturnValue("Husterknupp"),
      getReactions: jest.fn().mockReturnValueOnce([]), // acquire only
    });
    const err = new Error("Too many arguments for this command");
    err.status = 1; // genuine CLI exit, not a killed-by-timeout process
    const oclAdapter = makeOclAdapter({
      sendEvent: jest.fn().mockImplementation(() => {
        throw err;
      }),
    });

    run(ghAdapter, oclAdapter);

    expect(ghAdapter.addReaction).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: "99", content: "confused" })
    );
    expect(ghAdapter.removeReaction).not.toHaveBeenCalled();
    // Thread IS marked read (issue #16 review) — the lock already blocks
    // reprocessing, so an unread thread would only cause repeated
    // "already locked" no-op polls, not a preserved signal.
    expect(ghAdapter.markThreadRead).toHaveBeenCalledWith(notif.id);
  });

  // The core fix behind issue #7: our own execSync timeout (ETIMEDOUT) used to
  // be shorter than the CLI's own agent-turn timeout, so a healthy but slow
  // turn got its lock wrongly released and logged as an error (live case: PR
  // #62 on party-insights-shenanigans, 2026-07-23 — the turn finished
  // successfully 36s after our wrapper gave up). ETIMEDOUT must now leave the
  // 👀 lock untouched (still-pending signal) instead of releasing it.
  //
  // Issue #6/#16 review: a bare 👀 used to mean two different things — "our
  // own timeout fired, turn presumed healthy" and "process died silently
  // before ever reaching this code at all". TIMEOUT_REACTION (👍) added on
  // top of 👀 distinguishes the two.
  test("ETIMEDOUT (our own timeout, not a CLI failure) leaves the lock in place, adds the timeout reaction, and does not mark an error", () => {
    const notif = makeNotification({ reason: "mention" });
    const ghAdapter = makeGhAdapter({
      getNotifications: jest.fn().mockReturnValue([notif]),
      getActorFromUrl: jest.fn().mockReturnValue("Husterknupp"),
      getReactions: jest.fn().mockReturnValue([]), // acquire only, lock stays
    });
    const err = new Error("Command timed out");
    err.code = "ETIMEDOUT";
    err.signal = "SIGTERM";
    const oclAdapter = makeOclAdapter({
      sendEvent: jest.fn().mockImplementation(() => {
        throw err;
      }),
    });

    run(ghAdapter, oclAdapter);

    expect(ghAdapter.addReaction).toHaveBeenCalledWith(
      expect.objectContaining({ content: "eyes" })
    );
    expect(ghAdapter.addReaction).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: "99", content: "+1" })
    );
    expect(ghAdapter.addReaction).not.toHaveBeenCalledWith(
      expect.objectContaining({ content: "confused" })
    );
    expect(ghAdapter.removeReaction).not.toHaveBeenCalled();
    // Thread IS marked read (issue #16 review) — the lock already blocks
    // reprocessing, so an unread thread would only cause repeated
    // "already locked" no-op polls, not a preserved signal.
    expect(ghAdapter.markThreadRead).toHaveBeenCalledWith(notif.id);
  });

  test("success adds the success reaction on top of the lock, without removing it (issue comment)", () => {
    const notif = makeNotification({ reason: "mention" });
    const ghAdapter = makeGhAdapter({
      getNotifications: jest.fn().mockReturnValue([notif]),
      getActorFromUrl: jest.fn().mockReturnValue("Husterknupp"),
      getReactions: jest.fn().mockReturnValue([]),
    });
    const oclAdapter = makeOclAdapter();

    run(ghAdapter, oclAdapter);

    expect(ghAdapter.addReaction).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: "99", content: "eyes" })
    );
    expect(ghAdapter.addReaction).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: "99", content: "rocket" })
    );
    expect(ghAdapter.removeReaction).not.toHaveBeenCalled();
    expect(ghAdapter.markThreadRead).toHaveBeenCalledWith(notif.id);
  });
});
