# TASK_2025_206: Session-Based Dashboard with Pricing Analytics

## User Request

Build the frontend dashboard around real session data - load actual AI sessions, calculate per-model/per-provider pricing using token usage, and display stats (cost breakdown, token usage, session history, model comparison). Leverage existing session loading capabilities, child CLI process linking, and multi-provider pricing support.

## Task Type

FEATURE

## Strategy

Full: PM -> Architect -> Team-Leader -> QA

## Complexity

Medium-Complex

## Key Context

### What Exists

- Dashboard lib has only "quality" components (code quality metrics)
- No session/pricing dashboard components exist yet
- CLAUDE.md describes planned architecture but it's aspirational

### Available Data Sources

1. **StrictChatSession**: totalCost, totalTokensInput/Output, model, capabilities, createdAt, lastActiveAt
2. **StrictChatMessage**: cost, tokens { input, output, cacheHit }, duration per message
3. **pricing.utils.ts**: DEFAULT_MODEL_PRICING (Claude + GPT models), calculateMessageCost(), findModelPricing()
4. **session-totals.utils.ts**: calculateSessionTotals() → { totalTokensInput, totalTokensOutput, totalCost, messagesWithCost }
5. **subagent-cost.utils.ts**: calculateSessionCostSummary() → per-agent cost breakdown with AgentCostBreakdown[]
6. **CliSessionReference**: Child CLI sessions with cli type, agentId, model, status, parentSessionId
7. **AgentProcessInfo**: model per CLI agent (gemini-2.5-pro, gpt-4o, etc.)
8. **ChatResumeResult.stats**: totalCost, tokens { input, output, cacheRead, cacheCreation }, messageCount, model

### Session Loading Flow

Frontend → SessionLoaderService.loadSessions() → `session:list` RPC (30/page) → ChatStore signals
Switch: switchSession(sessionId) → `chat:resume` RPC → events[], stats, cliSessions[]

### Multi-Provider Models

- Claude: opus-4-5, sonnet-4, haiku-4-5, etc.
- GPT: 4o, 4o-mini, 4-turbo, 3.5-turbo
- CLI agents: gemini-2.5-pro, codex, copilot

### Dashboard Library Structure

- Located at: libs/frontend/dashboard/
- Current files: quality/ components only
- Uses: Angular 20 signals, DaisyUI, standalone components
- Imports from: @ptah-extension/shared, @ptah-extension/chat (ChatStore)
