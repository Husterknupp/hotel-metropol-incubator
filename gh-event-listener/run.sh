#!/usr/bin/env bash
# run.sh — Wrapper for cron execution
# Sets PATH so that gh, node, and openclaw are available.
export PATH="/home/linuxbrew/.linuxbrew/bin:/home/ubuntu/.nvm/current/bin:/home/ubuntu/.npm-global/bin:$PATH"
cd "$(dirname "$0")" && node src/index.js
