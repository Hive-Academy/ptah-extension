# Round 2: no-tab permission attention cards

## Defect 1: Tool input preview

- `libs/frontend/chat/src/lib/services/chat-attention-source.service.ts:20-49`: The preview now shortens file paths using the removed card's last-two-segments rule, keeps path-bearing commands and patterns visible, and adds an ellipsis when input exceeds the compact limit. It no longer applies the context-label path filter to tool input. It strips control characters and redacts known token shapes plus `key=value` and `--flag value` for password, passwd, secret, token, api_key/api-key, and auth before truncation. The description uses the same redaction.
- `libs/frontend/chat/src/lib/services/chat-attention-source.service.spec.ts:138-170`: Added assertions for `src/main.ts`, a shortened absolute Windows path, `rm -rf /tmp/foo`, `password=hunter2`, `--token abc123`, and `sk-...`.

## Defect 2: Deny with message

- `libs/frontend/core/src/lib/components/attention-permission-actions.component.ts:30-39,53-85`: A signal view query focuses the reason field when it opens. Submission trims the reason. A blank trimmed reason keeps the form open and shows a visible error linked to the field with `aria-describedby` and `aria-invalid`; input, cancel, and reopen clear the error. The form uses `novalidate` so the inline validation also handles an empty value.
- `libs/frontend/core/src/lib/components/attention-permission-actions.component.spec.ts:29-55`: Added focus-on-open, whitespace-only rejection, accessible error, and trimmed submission assertions.

## Decisions

- Kept the preview as plain Angular interpolation; the bell, snackbar, and rail share this component and receive the same redacted text.
- Kept the removed card's 40-character command and 30-character pattern limits, with a visible ellipsis. File paths use its final-two-segments shortening rule.
- Left the existing permission response path and all other round-1 changes in place.

## Not done

- Nx, Jest, TypeScript, lint, and build were not run, as instructed. `git diff --check` was requested for static whitespace review; no test or build command was run.
