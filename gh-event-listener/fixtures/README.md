# API contract fixtures

Real, recorded GitHub API responses — **not hand-authored assumptions**. These
capture the exact shape the listener depends on, so the flow can be pinned in
contract tests instead of guessed at.

One folder per use case, one `contract.test.js` (in `../src/`) with a nested
`describe` block per case.

## `genuine-assign/`

Recorded on **2026-07-16** from a genuine assignment of issue
`Husterknupp/party-insights-shenanigans#48` to `arostovd`, performed by
`Husterknupp`. Fields are trimmed to those the listener actually reads; every
value is verbatim from the API.

### The flow

| Step | Endpoint | File | Key insight |
|------|----------|------|-------------|
| 1 | `GET /notifications` | `notification.json` | `reason: "assign"`, and `subject.latest_comment_url === subject.url` → a **genuine** assignment, not a follow-up comment |
| 2 | `GET /repos/{o}/{r}/issues/{n}/timeline` | `timeline.json` | The latest `assigned` event's `actor.login` is the **assigner** (`Husterknupp`) — the real trigger |
| 3 | `GET {subject.url}` | `issue-subject.json` | The issue's `user.login` is the **creator** (`arostovd`) — here it is *us* |

### Why this matters

Steps 2 and 3 disagree: **creator (`arostovd`) ≠ assigner (`Husterknupp`)**.

The old code resolved the actor for an assignment from step 3 (the creator).
Because we frequently file our own tickets, the creator was `arostovd` =
`SELF_ACTOR`, so a real assignment by the trusted owner was misread as a
self-triggered event and silently dropped. The assigner must come from step 2.

Note the timeline contains an earlier `assigned` **and** an `unassigned` before
the final `assigned` — the resolver must pick the *last* `assigned` event that
targets us, not the first.

### Reproducing

```bash
gh api notifications --jq '.[] | select(.subject.url | test("/issues/48$"))'
gh api "repos/Husterknupp/party-insights-shenanigans/issues/48/timeline"
gh api "repos/Husterknupp/party-insights-shenanigans/issues/48"
```

## `stale-mention/`

Recorded on **2026-07-17** from a `reason: "mention"` notification on
`Husterknupp/party-insights-shenanigans#54` (a PR) that resurfaced hours after
the real mention was already answered, with `subject.latest_comment_url` set
to `null`.

### The flow

| Step | Endpoint | File | Key insight |
|------|----------|------|-------------|
| 1 | `GET /notifications` | `notification.json` | `reason: "mention"`, `subject.latest_comment_url: null` — no comment to follow directly |
| 2 | `GET /repos/{o}/{r}/issues/{n}/comments?per_page=100` | `comments.json` | Endpoint **ignores `sort`/`direction`** and always returns oldest-first — the true latest comment is the *last* array element, not the first |

### Why this matters

Two genuine `@arostovd` mentions from `Husterknupp` (comments `4996471320` and
`4996612708`) had already been answered on this thread. Later, unrelated CI
activity on the same PR (`ci_activity` notifications for failed "Check For
Wiki Updates" runs) bumped this `mention` notification's `updated_at` and
`unread` flag again — but GitHub did not repopulate `latest_comment_url`.

The old code's `mention`/`comment` branch only handled the case where
`latest_comment_url` was present; without it, `resolveActor` fell straight
through every branch and returned `null`, which the caller logged and warned
about as `Untrusted actor: unknown` — a false alarm, not a real event.

The fix mirrors the existing `author`-reason fallback: when
`latest_comment_url` is missing, fetch the real latest comment instead of
giving up. Here that resolves to the thread's actual last comment (our own
reply, `arostovd` == `SELF_ACTOR`), so the corrected flow now recognizes this
as a self-triggered echo and quietly ignores it — instead of firing a false
warning.

`comments.json` also documents a separate, real quirk worth pinning: unlike
`/pulls/{n}/comments` (used by `getLatestPrReviewComment`), the
`/issues/{n}/comments` endpoint silently ignores `sort=created&direction=desc`
and always returns comments oldest-first — verified live against both
endpoints on the same day. `getLatestIssueComment` therefore takes the last
array element rather than asking the API to sort descending.

### Reproducing

```bash
gh api "notifications?all=true&per_page=50" --jq '.[] | select(.repository.full_name=="Husterknupp/party-insights-shenanigans")'
gh api "repos/Husterknupp/party-insights-shenanigans/issues/54/comments?per_page=100&sort=created&direction=desc" --jq '.[0].id'
# ^ still returns the OLDEST comment — sort/direction are ignored here.
```
