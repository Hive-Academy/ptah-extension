# TASK_2025_181: Fix Slash Command Handling in Claude Agent SDK Integration

## Task Type: BUGFIX

## Workflow: Partial (Architect -> Team-Leader -> Developers -> QA)

## Status: In Progress

## Created: 2026-03-07

## User Request

Fix slash command handling so both built-in SDK commands (/clear, /compact, /help, etc.) and custom plugin commands (/orchestrate, user .claude/commands/) work correctly when sent in running sessions.

## Problem Analysis (Research Complete)

### Root Cause

All prompts are wrapped as SDKUserMessage objects via SdkMessageFactory.createUserMessage(), but the Claude Agent SDK only parses slash commands from **plain strings**, not from SDKUserMessage.message.content.

### Current Broken Flow

1. Frontend sends /clear via MessageSenderService.send()
2. Backend chat:continue -> expandPluginCommand() (no match for built-in) -> sendMessageToSession()
3. SdkMessageFactory.createUserMessage() wraps as SDKUserMessage { message: { content: "/clear" } }
4. SDK receives it as a regular user message, not a slash command
5. SDK completes with 0 tokens - command behavior not executed

### What Works vs What's Broken

| Command Type          | Example                 | Status     | Why                                              |
| --------------------- | ----------------------- | ---------- | ------------------------------------------------ |
| Plugin commands       | /orchestrate            | Workaround | expandPluginCommand expands template on our side |
| User commands         | .claude/commands/\*.md  | Workaround | Same expansion workaround                        |
| Built-in SDK commands | /clear, /compact, /help | BROKEN     | No expansion found, sent as SDKUserMessage       |

## Required Changes

1. **Delete expandPluginCommand** - SDK handles all commands natively when receiving strings
2. **Send prompts as strings** - Both chat:start and chat:continue should send plain strings to SDK
3. **Add SessionStart hook** - Detect source: "clear" to reset frontend tab state
4. **Update types** - Match SDK prompt: string | AsyncIterable<SDKUserMessage> pattern

## Key Files

### Backend (Must Change)

- apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts - Remove expandPluginCommand, pass string prompts
- libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts - sendMessage() should send string, executeQuery() initial prompt as string
- libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts - Update QueryConfig.prompt type
- libs/backend/agent-sdk/src/lib/helpers/sdk-message-factory.ts - May need updates or reduced usage

### Backend (Hook Addition)

- libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts - Add SessionStart hook

### Frontend (Clear Command Handling)

- libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts - Handle clear event
- libs/frontend/chat/src/lib/services/tab-manager.service.ts - Reset tab on clear

## SDK Key Facts

- query() accepts prompt: string | AsyncIterable<SDKUserMessage>
- V2 send() accepts string | SDKUserMessage - string path parses slash commands
- SessionStart hook fires with source: 'startup' | 'resume' | 'clear' | 'compact'
- SDK ExitReason includes 'clear'
- Plugins configured via plugins: [{ type: 'local', path: '...' }] in query options
- SDK already receives our pluginPaths - no need to expand commands ourselves
- SessionStart and SessionEnd hooks are TypeScript-only (not available in Python SDK)
