# gh-event-listener

Polls GitHub notifications via cron and triggers the OpenClaw agent for relevant events (mentions, issue assignments, PR review requests, review comments on own PRs).

Designed to run as a cron job — no inbound HTTP traffic required.

## How it works

1. Fetches unread GitHub notifications via `gh` CLI
2. Classifies each notification: `comment` / `issue` / `pr` / `pr_review_comment`
3. **Resolves the actor** by fetching the comment or issue/PR via the GitHub API (the Notifications API does _not_ include an actor field)
4. Checks the trusted actor filter (`TRUSTED_ACTOR`, default: `Husterknupp`)
5. Sets an emoji reaction as a distributed lock to prevent duplicate processing
6. Sends an event to the OpenClaw main agent via `openclaw system event`
7. Marks the notification thread as read
8. On failure: removes the lock reaction so the next cron run retries naturally

## Setup

```bash
npm install
```

## Scheduling on Ubuntu (cron)

Cron runs with a minimal `PATH` (`/usr/bin:/bin`), so `gh`, `node`, and `openclaw` won't be found by default.

### 1. Find the required paths

```bash
which gh node openclaw
# Example output:
# /home/linuxbrew/.linuxbrew/bin/gh
# /home/ubuntu/.nvm/current/bin/node
# /home/ubuntu/.npm-global/bin/openclaw
```

### 2. Open the crontab for the ubuntu user

```bash
crontab -e
```

### 3. Add PATH and the cron line

```cron
# Set PATH so cron can find gh, node, and openclaw
PATH=/home/linuxbrew/.linuxbrew/bin:/home/ubuntu/.nvm/current/bin:/home/ubuntu/.npm-global/bin:/usr/bin:/bin

* * * * * cd /home/ubuntu/gh-event-listener && node src/index.js >> /home/ubuntu/gh-event-listener.log 2>&1
```

> **Why set PATH?** Cron's default PATH is `/usr/bin:/bin`. Without the extra paths, `gh` and `openclaw` will fail with "command not found".

### 4. Verify

```bash
crontab -l                          # confirm the entry
tail -f ~/gh-event-listener.log     # watch for output within 60s
```

### 5. Alternative: wrapper script (optional)

If you prefer not to set PATH in crontab, create a wrapper:

```bash
#!/usr/bin/env bash
export PATH="/home/linuxbrew/.linuxbrew/bin:$HOME/.nvm/current/bin:$HOME/.npm-global/bin:$PATH"
cd /home/ubuntu/gh-event-listener && node src/index.js
```

Then in crontab: `* * * * * /home/ubuntu/gh-event-listener/run.sh >> ~/gh-event-listener.log 2>&1`

## Configuration

| Variable | Default | Description |
|---|---|---|
| `TRUSTED_ACTOR` | `Husterknupp` | GitHub username whose events trigger the agent |
| `LOCK_REACTION` | `eyes` | Emoji reaction used as distributed lock |
| `WARN_CHANNEL` | _(not set)_ | Discord channel ID for untrusted-actor warnings. If not set, the agent uses its default channel. |

## Logging

Each run logs a single JSON line to stdout:

```json
{"ts":"2026-04-08T20:00:00.000Z","outcome":"comment","detail":"React to Husterknupp's GitHub comment (repo X/Y)"}
{"ts":"2026-04-08T20:01:00.000Z","outcome":"no_op","detail":""}
{"ts":"2026-04-08T20:02:00.000Z","outcome":"error","detail":"gh CLI error (api): ..."}
```

Outcomes: `no_op` | `comment` | `issue` | `pr` | `pr_review_comment` | `error`

## Tests

```bash
npm test
```

Covers all four happy-path flows (comment, issue, PR, PR review comment), actor resolution from the GitHub API, the already-locked case, untrusted actor, and lock release on failure.

## Project structure

```
src/
  index.js            # Main logic + entry point
  gh-adapter.js       # Thin wrapper around `gh` CLI
  openclaw-adapter.js # Thin wrapper around `openclaw system event`
  index.test.js       # Jest tests (25 cases)
```
