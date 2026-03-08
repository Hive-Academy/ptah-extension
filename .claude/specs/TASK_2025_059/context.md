# Context - TASK_2025_059: Streaming Architecture Redesign

## User Intent

Fix broken streaming UX where markdown never renders and streaming never terminates due to CLI-era architecture assumptions that don't match Agent SDK's multi-turn model.

## Key Problems Identified

1. **Streaming never stops**: `chat:complete` waits for entire CLI process to exit, but Agent SDK uses persistent sessions
2. **Markdown never renders**: UI only renders markdown when streaming stops (waiting for `chat:complete`)
3. **Token/cost badges empty**: Result messages are skipped, data never reaches frontend

## Solution Overview

1. **Section 1: Streaming Fix**
   - Use `stop_reason` for per-message completion
   - Always render markdown (live updates like ChatGPT/Claude web)
2. **Section 2: Pricing/Token Display**
   - Add `session:stats` message type to send cost/token data to frontend

## Source Document

- Implementation plan: `task-tracking/streaming-redesign-plan.md`
