# gh-event-listener

Polls GitHub notifications and triggers the OpenClaw agent for relevant events (mentions, issue assignments, PR review requests).

Designed to run as a cron job — no inbound HTTP traffic required.

## How it works

1. Fetches unread GitHub notifications via `gh` CLI
2. Classifies each notification: `comment` / `issue` / `pr`
3. Checks the trusted actor filter (`TRUSTED_ACTOR`, default: `Husterknupp`)
4. Sets an emoji reaction as a distributed lock to prevent duplicate processing
5. Sends an event to the OpenClaw main agent via `openclaw system event`
6. Marks the notification thread as read
7. On failure: removes the lock reaction so the next cron run retries naturally

## Setup

```bash
npm install
```

### Cron entry (every 60 seconds)

```
* * * * * cd /path/to/gh-event-listener && node src/index.js >> /var/log/gh-event-listener.log 2>&1
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `TRUSTED_ACTOR` | `Husterknupp` | GitHub username whose events trigger the agent |
| `LOCK_REACTION` | `eyes` | Emoji reaction used as distributed lock |
| `WARN_CHANNEL` | `1477664071061999818` | Discord channel ID for untrusted-actor warnings |

## Logging

Each run logs a single JSON line to stdout:

```json
{"ts":"2026-04-08T20:00:00.000Z","outcome":"comment","detail":"React to Husterknupp's GitHub comment (repo Husterknupp/hotel-metropol-incubator)"}
{"ts":"2026-04-08T20:01:00.000Z","outcome":"no_op","detail":""}
{"ts":"2026-04-08T20:02:00.000Z","outcome":"error","detail":"Gateway down"}
```

## Tests

```bash
npm test
```

Covers all three happy-path flows (comment, issue, PR), the already-locked case, untrusted actor, and lock release on failure.

## Project structure

```
src/
  index.js           # Main logic
  gh-adapter.js      # Thin wrapper around `gh` CLI
  openclaw-adapter.js # Thin wrapper around `openclaw system event`
  index.test.js      # Jest tests
```
