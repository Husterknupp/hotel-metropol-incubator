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

## `stale-mention-inline-review/`

Recorded on **2026-07-17**, a few hours after `stale-mention/` above, from the
*same* notification thread (`24642770656`) bumping again — but this time the
bump was a genuine new event: Husterknupp submitted a PR review on
`party-insights-shenanigans#54` containing one inline comment on `.gitignore`
(review `#4719555720`, review body itself empty — the actual content lives on
the inline comment).

### The flow

| Step | Endpoint | File | Key insight |
|------|----------|------|-------------|
| 1 | `GET /notifications` | `notification.json` | Same shape as `stale-mention/`: `reason: "mention"`, `subject.latest_comment_url: null` — indistinguishable from a stale echo by the notification alone |
| 2 | `GET /repos/{o}/{r}/issues/{n}/comments?per_page=100` | `issue-comments.json` | Identical to `stale-mention/comments.json` — nothing new here, latest is still our own reply from the day before |
| 3 | `GET /repos/{o}/{r}/pulls/{n}/comments?per_page=1&sort=created&direction=desc` | `review-comments.json` | The *real* new activity: `Husterknupp`'s inline review comment, newer than anything in step 2 |

### Why this matters

The first fix for `stale-mention/` (see above) only checked general
conversation comments (step 2) when `latest_comment_url` was missing. Applied
live to this exact notification, it silently resolved the actor to `arostovd`
(our own older conversation reply) and logged `"Self-triggered event by
arostovd, ignoring"` — dropping Husterknupp's real review feedback without a
trace, no warning, no reply. Worse than the original bug: at least the
`Untrusted actor: unknown` warning was visible.

The corrected fallback checks **both** comment streams — general conversation
(`/issues/{n}/comments`) and inline review comments
(`/pulls/{n}/comments`) — and picks whichever candidate has the newer
`created_at`. Here that's the review comment, resolving correctly to
`Husterknupp`.

### Reproducing

```bash
gh api "repos/Husterknupp/party-insights-shenanigans/pulls/54/reviews" --jq '.[] | select(.id==4719555720)'
gh api "repos/Husterknupp/party-insights-shenanigans/pulls/54/comments" --jq '.[] | select(.pull_request_review_id==4719555720)'
gh api "repos/Husterknupp/party-insights-shenanigans/pulls/54/comments?per_page=10&sort=created&direction=desc"
# ^ unlike issues/{n}/comments, this one DOES honor sort/direction correctly.
```
