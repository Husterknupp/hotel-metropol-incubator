# API contract fixtures

Real, recorded GitHub API responses — **not hand-authored assumptions**. These
capture the exact shape the listener depends on, so the flow can be pinned in
contract tests instead of guessed at.

Recorded on **2026-07-16** from a genuine assignment of issue
`Husterknupp/party-insights-shenanigans#48` to `arostovd`, performed by
`Husterknupp`. Fields are trimmed to those the listener actually reads; every
value is verbatim from the API.

## The flow

| Step | Endpoint | File | Key insight |
|------|----------|------|-------------|
| 1 | `GET /notifications` | `notification-genuine-assign.json` | `reason: "assign"`, and `subject.latest_comment_url === subject.url` → a **genuine** assignment, not a follow-up comment |
| 2 | `GET /repos/{o}/{r}/issues/{n}/timeline` | `timeline-genuine-assign.json` | The latest `assigned` event's `actor.login` is the **assigner** (`Husterknupp`) — the real trigger |
| 3 | `GET {subject.url}` | `issue-subject.json` | The issue's `user.login` is the **creator** (`arostovd`) — here it is *us* |

## Why this matters

Steps 2 and 3 disagree: **creator (`arostovd`) ≠ assigner (`Husterknupp`)**.

The old code resolved the actor for an assignment from step 3 (the creator).
Because we frequently file our own tickets, the creator was `arostovd` =
`SELF_ACTOR`, so a real assignment by the trusted owner was misread as a
self-triggered event and silently dropped. The assigner must come from step 2.

Note the timeline contains an earlier `assigned` **and** an `unassigned` before
the final `assigned` — the resolver must pick the *last* `assigned` event that
targets us, not the first.

## Reproducing

```bash
gh api notifications --jq '.[] | select(.subject.url | test("/issues/48$"))'
gh api "repos/Husterknupp/party-insights-shenanigans/issues/48/timeline"
gh api "repos/Husterknupp/party-insights-shenanigans/issues/48"
```
