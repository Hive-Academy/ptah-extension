# Task Context - TASK_2025_100

## User Intent

Fix all hardcoded colors in the codebase to use DaisyUI theme-aware colors (reach 100% theme consistency) and implement a theme toggle system for light/dark themes (anubis, anubis-light). Based on frontend developer research, files needing updates include: styles.css (agent badges, prose styling), permission-request-card.component.ts, tool-icon.component.ts. Also need to create a ThemeService and theme toggle UI component.

## Conversation Summary

- Frontend developer agent completed comprehensive theming analysis
- Current theme consistency score: 66%
- diff-display.component.ts already updated to use DaisyUI semantic colors (oklch vars)
- Custom "anubis" dark and "anubis-light" themes already defined in tailwind.config.js
- Key files with hardcoded colors identified:
  - styles.css: Agent badge colors (lines 386-429), prose/markdown styling (lines 479-545)
  - permission-request-card.component.ts: Line 251 uses #4ade80
  - tool-icon.component.ts: Line 78 uses text-green-400

## Technical Context

- Branch: feature/sdk-only-migration
- Created: 2025-12-30
- Type: REFACTORING
- Complexity: Medium

## Execution Strategy

REFACTORING: Architect → USER VALIDATES → Team Leader (3 modes) → USER CHOOSES QA

## DaisyUI Color Variable Reference

| Variable     | Semantic     | Usage                            |
| ------------ | ------------ | -------------------------------- |
| `--su`       | success      | Additions, confirmations (green) |
| `--er`       | error        | Deletions, failures (red)        |
| `--wa`       | warning      | Cautions (amber)                 |
| `--in`       | info         | Information (blue)               |
| `--p`        | primary      | Main actions (lapis blue)        |
| `--s`        | secondary    | Accent (gold)                    |
| `--a`        | accent       | Highlights                       |
| `--n`        | neutral      | Panels, cards                    |
| `--b1/b2/b3` | base         | Background hierarchy             |
| `--bc`       | base-content | Text color                       |

## Files Already Fixed

- libs/frontend/chat/src/lib/components/molecules/diff-display.component.ts (updated to oklch vars)
