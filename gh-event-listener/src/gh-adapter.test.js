// gh-adapter.test.js
// Regression tests for shell-quoting of gh api arguments.
//
// Background: gh-adapter passes command strings to child_process.execSync,
// which runs them through `sh -c`. Any unquoted `&` in a URL query string is
// interpreted by the shell as a background-process operator, silently dropping
// the following query parameters. This once caused getLatestPrReviewComment to
// return the first comment (by diff position) instead of the newest one,
// because `sort=created&direction=desc` never reached gh.

jest.mock("child_process", () => ({
  execSync: jest.fn(() => "[]"),
}));

const { execSync } = require("child_process");
const gh = require("./gh-adapter");

/** Returns the single command string execSync was last called with. */
function lastCommand() {
  return execSync.mock.calls[execSync.mock.calls.length - 1][0];
}

/**
 * A shell splits an unquoted string on `&` into separate commands. We emulate
 * that split only for `&` that sit OUTSIDE single or double quotes, which is
 * exactly the failure mode we guard against. If the URL is properly quoted,
 * the whole `gh api …` stays a single command word.
 */
function splitsOnUnquotedAmpersand(command) {
  let inSingle = false;
  let inDouble = false;
  for (const ch of command) {
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "&" && !inSingle && !inDouble) return true;
  }
  return false;
}

beforeEach(() => {
  execSync.mockClear();
  execSync.mockReturnValue("[]");
});

describe("getLatestPrReviewComment – shell quoting", () => {
  test("passes the full query string to the shell without an unquoted &", () => {
    gh.getLatestPrReviewComment({
      owner: "Husterknupp",
      repo: "hotel-metropol-incubator",
      prNumber: "3",
    });

    const cmd = lastCommand();
    // All three query parameters must survive intact…
    expect(cmd).toContain("per_page=1");
    expect(cmd).toContain("sort=created");
    expect(cmd).toContain("direction=desc");
    // …and no & may be exposed to the shell as a background operator.
    expect(splitsOnUnquotedAmpersand(cmd)).toBe(false);
  });
});

describe("all gh api URLs are shell-safe", () => {
  const args = {
    owner: "Husterknupp",
    repo: "hotel-metropol-incubator",
    commentId: "123",
    issueNumber: "3",
    prNumber: "3",
    threadId: "999",
    reactionId: "555",
    content: "eyes",
  };

  const calls = [
    ["addReaction", () => gh.addReaction(args)],
    ["removeReaction", () => gh.removeReaction(args)],
    ["addPrReviewCommentReaction", () => gh.addPrReviewCommentReaction(args)],
    ["removePrReviewCommentReaction", () => gh.removePrReviewCommentReaction(args)],
    ["getPrReviewCommentReactions", () => gh.getPrReviewCommentReactions(args)],
    ["getReactions", () => gh.getReactions(args)],
    ["getIssueReactions", () => gh.getIssueReactions(args)],
    ["addIssueReaction", () => gh.addIssueReaction(args)],
    ["removeIssueReaction", () => gh.removeIssueReaction(args)],
    ["markThreadRead", () => gh.markThreadRead(args.threadId)],
    ["getLatestPrReviewComment", () => gh.getLatestPrReviewComment(args)],
    ["getPrReviewComments", () => gh.getPrReviewComments(args)],
  ];

  test.each(calls)("%s never exposes an unquoted & to the shell", (_name, invoke) => {
    invoke();
    expect(splitsOnUnquotedAmpersand(lastCommand())).toBe(false);
  });
});
