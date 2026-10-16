# Batch F — assistant turn alignment

Changed `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.css:1-13`.

The transcript bubble has `px-2` (8 px) from the pane edge. The composer has `px-3` (12 px); its bordered card is `max-w-[758px] mx-auto`, with a 1 px inner border. Thus the assistant turn needs 5 px additional inset while the card fills its available width. Once the card centers, the inset is `(bubble content width - 758px) / 2 + 1px`. The host width excludes the transcript's 16 px total horizontal padding.

Added `container-type: inline-size` to the message bubble host and one `@container (min-width: 704px)` rule on `.cs-turn:not(.cs-compact)` using `padding-left: max(5px, calc((100cqw - 758px) / 2 + 1px))`. This starts at about 720 px pane width and leaves narrow and compact turns unchanged. User bubbles and answer max-width remain unchanged.

Verification: `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/organisms/message-bubble.component.spec.ts --coverage=false --maxWorkers=1` passed: 1 suite, 18 tests, 0 snapshots. `ptah_get_diagnostics` was unavailable for CSS because its syntax checker does not recognise the file type.

## Decisions

- Align the assistant turn's content with the composer's inner border: the card has a 1 px border; 5 px is the 12 px composer gutter plus 1 px border minus the 8 px transcript gutter. Reversible: yes, by changing the CSS inset.
- Use a 704 px bubble content threshold, which corresponds to approximately 720 px of pane width after the transcript's 8 px padding on each side. The existing `.cs-shell` container measures the full shell, including the inspector, so the bubble host is the suitable query container. Reversible: yes, by changing the threshold or query container.