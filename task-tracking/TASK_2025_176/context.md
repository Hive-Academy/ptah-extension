# TASK_2025_176: Chat Input UI Fixes + Image Paste Support

## User Request

Fix chat input bottom bar UI: dropdown styles, font sizes, duplicate "Full Auto (YOLO)" text, and add image paste/attach support.

## Task Type: FEATURE + BUGFIX

## Complexity: Medium

## Workflow: Partial (direct frontend developer)

## Issues

1. **Dropdown styles** - Bottom bar dropdowns need cleaner styling, smaller text
2. **Font size** - Text in dropdowns too large
3. **Duplicate "Full Auto (YOLO)"** - Shows both as badge (left) AND in autopilot popover button (right)
4. **Image paste/attach** - No clipboard image paste support; backend already supports base64 images via AttachmentProcessorService

## Key Files

- `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts` - Main input
- `libs/frontend/chat/src/lib/components/molecules/chat-input/autopilot-popover.component.ts` - Autopilot dropdown
- `libs/frontend/chat/src/lib/components/molecules/chat-input/agent-selector.component.ts` - Agent dropdown
- `libs/frontend/chat/src/lib/components/molecules/chat-input/model-selector.component.ts` - Model dropdown
- `libs/frontend/chat/src/lib/services/message-sender.service.ts` - Message sending
- `libs/shared/src/lib/types/rpc.types.ts` - RPC type contracts
- `libs/backend/agent-sdk/src/lib/helpers/attachment-processor.service.ts` - Already supports base64 images

## Architecture Notes

- Backend `AttachmentProcessorService` already handles `{ type: 'image', source: { type: 'base64', media_type, data } }` blocks
- `ChatStartParams.options.files` is `string[]` (file paths only) - needs images support
- Frontend `ChatFile` type supports `type: 'text' | 'image' | 'binary'`
- `FilePickerService` already tracks image extensions
