# gh-event-listener

Polls GitHub notifications via cron and triggers the OpenClaw agent for relevant events (mentions, issue assignments, PR review requests).

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

## Scheduling on Ubuntu (cron)

### 1. Open the crontab editor

```bash
crontab -e
```

### 2. Add the following line to run the script every minute

```
* * * * * cd /path/to/gh-event-listener && node src/index.js >> /var/log/gh-event-listener.log 2>&1
```

Replace `/path/to/gh-event-listener` with the actual path to this directory.

### 3. Verify the cron entry is active

```bash
crontab -l
```

### 4. Check the log

```bash
tail -f /var/log/gh-event-listener.log
```

You should see one JSON line per run within the first minute.

### Notes

- The `gh` CLI must be authenticated (`gh auth status`) for the user running the cron job.
- `openclaw` must be on the PATH for that user. If not, use the full path, e.g. `/usr/local/bin/openclaw`.
- To pass environment variables, prefix them in the cron line:
  ```
  * * * * * TRUSTED_ACTOR=Husterknupp cd /path/to/gh-event-listener && node src/index.js >> /var/log/gh-event-listener.log 2>&1
  ```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `TRUSTED_ACTOR` | `Husterknupp` | GitHub username whose events trigger the agent |
| `LOCK_REACTION` | `eyes` | Emoji reaction used as distributed lock |
| `WARN_CHANNEL` | _(not set)_ | Discord channel ID for untrusted-actor warnings. If not set, the agent uses its default channel. |

## Logging

Each run logs a single JSON line to stdout:

```json
{"ts":"2026-04-08T20:00:00.000Z","outcome":"comment","detail":"React to Husterknupp's GitHub comment (repo Husterknupp/hotel-metropol-incubator)"}
{"ts":"2026-04-08T20:01:00.000Z","outcome":"no_op","detail":""}
{"ts":"2026-04-08T20:02:00.000Z","outcome":"error","detail":"gh CLI error (api): ..."}
```

Outcomes: `no_op` | `comment` | `issue` | `pr` | `error`

## Tests

```bash
npm test
```

Covers all three happy-path flows (comment, issue, PR), the already-locked case, untrusted actor (from a foreign repo), and lock release on failure.

## Project structure

```
src/
  index.js            # Main logic
  gh-adapter.js       # Thin wrapper around `gh` CLI
  openclaw-adapter.js # Thin wrapper around `openclaw system event`
  index.test.js       # Jest tests
```
