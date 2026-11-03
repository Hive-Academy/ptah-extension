Previous verdict: REJECTED (2026-10-29)

# Visual Review B1c "Get ready" (re-review after fixes)

NOT a live Electron runtime validation. This is an evidence-only review of existing stills (headless Chromium, Angular production build, Electron host configuration) in `screenshots/ready/`. No app, dev server, build or e2e was run. Hover, focus order, keyboard behaviour, animation and real Electron window chrome are not assessable from stills.

## Verdict: APPROVED (score 7/10), with one serious-leaning item to confirm

Both prior blockers are resolved in the evidence. Two moderate defects and a few minor ones remain.

## 1. Axe results (script over `*.axe.json`)

- Files counted: 116 fresh files (all `*-1280x800`, `*-464x800` and `contrast-*` sweep). The 8 stale `*-400x800` files were excluded.
- Violations: 0 in all 116 (0 by rule id, 0 by impact). The previous `nested-interactive` (serious) is gone.
- Limit: axe does not cover everything, and the JSON records `"rules": "all"` with no incomplete/needs-review items summarised here.

## 2. Narrow captures (464x800, 8 files), against `prototype/screenshots/v2-get-ready-missing-narrow-glass-*` and `v2-providers-narrow-*`

| Capture | Result |
| --- | --- |
| narrow-stage1-missing-ptah-glass / -light / anubis / anubis-light | PASS. Breadcrumb, stepper chip, H1 "Check Claude Code", body copy and the Claude Code card all wrap with no clipped text or horizontal overflow. Both 32px rails (WORKSPACES, GIT) are visible. Status chips render. The OS tablist "macOS / Linux / Windows / npm" fits on one row (about x=64-342) with no truncation. Fixes the 400px clipping. |
| narrow-stage2-providers-missing-ptah-glass / -light | PASS for the page chrome. Stepper collapses to icon plus current-step chip, the warning banner and "Fix Claude Code" wrap correctly, and "Reassign" fits. |
| narrow-stage2-providers-missing-anubis / -light | Same as above (scrolled slightly, header at top). |

Differences from the prototype are expected, not defects: the prototype's narrow frame is 400px wide and uses a specimen provider list. The real build embeds the full settings provider component.

Not assessable: command row wrapping (the `curl ... | bash` row). All four stage-1 narrow captures are viewport-only (800px high) and cut off at the command label, so the command row and its Copy button at 464px have no evidence. This is a coverage gap in the capture set, not a confirmed defect.

## 3. Wide captures

- Stage 2 Providers (`stage2-providers-missing-*-1280x800` in ptah-glass, ptah-glass-light, anubis, anubis-light): the provider grid is a two-column card layout in all four themes. The page layout, the Claude Code warning banner with "Fix Claude Code", the Main agent block, the connection filter and "Connect provider" are intact, with no layout regression visible. The "Retry" action on the Ollama Cloud card is visible in all four themes next to "Unreachable" (anubis, anubis-light and both glass themes). Card accents (left-edge colour bars) are consistent. Hover and focus on the new details-trigger button cannot be judged from stills.
- Stage 1 wide (`stage1-missing-ptah-glass`, `-light`): header, key-value rows, status chip, OS tablist and the two command rows with Copy buttons are laid out correctly and match the prototype structure.
- Home (`home-missing-ptah-glass`, `-light`): banner, "Install Claude Code" action and footer match the prototype structure.

## 4. Remaining defects

Moderate
1. `narrow-stage2-providers-missing-*-464x800.png` (all four themes), lower part: the provider card content looks clipped at the right. The title wraps as "Claude (Subscriptio" and the card's right border and trailing controls are cut off at about x=405-410, inside a panel that ends at about x=418. Text is truncated mid-word rather than ellipsised, and the catalog hint line ends in "OpenR...". Only about 100px of this card is visible in the capture, so the extent is unconfirmed. Expected cause: the settings provider card grid does not reflow below roughly 500px. Needs a scrolled narrow capture to confirm or dismiss. If it is confirmed it is serious (clipped content at a supported width).
2. `home-missing-*-1280x800.png` shows the three "Choose a path" cards as skeletons (empty grey placeholders), not populated cards. The Home screen's actual content in the missing state is therefore not reviewed. This is either a capture timing issue or a real stuck loading state.

Minor
3. The Ptah logo in the top bar renders as a broken-image icon in every capture (likely missing asset in the headless build; not a prototype difference to attribute to B1c).
4. The H1 shows a visible focus outline box in stage 1 and Home wide captures (programmatic focus on the heading). The prototype shows none. Keyboard users may find it fine, but it is noticeable, and it should be confirmed as intentional.
5. The OS tablist shows "Windows" selected on a Linux-hosted capture. This is probably deliberate default selection logic, but the "macOS, Linux, WSL" label sits under it first. Worth confirming.
6. The prototype's `v2-providers-*` specimen (five simple provider rows) differs from the real embedded settings list. Documented in the prototype caption as a specimen, so not a defect.

## 5. Evidence files reviewed

narrow-stage1-missing-{ptah-glass,ptah-glass-light,anubis,anubis-light}-464x800.png (all four); narrow-stage2-providers-missing-{ptah-glass,ptah-glass-light,anubis,anubis-light}-464x800.png (all four); stage2-providers-missing-{4 themes}-1280x800.png; stage1-missing-ptah-glass and -light-1280x800.png; home-missing-ptah-glass and -light-1280x800.png; the prototype references v2-get-ready-missing-narrow-glass-dark.png and v2-providers-narrow-glass-dark.png. The light prototype counterparts were not opened separately.

## 6. Confidence

Medium. The narrow-width findings and axe are solid. The scrolled narrow provider card, command row at 464px, the Home populated state, and all interaction states are unverified.
