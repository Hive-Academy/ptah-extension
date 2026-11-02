# TASK_2026_glass_scenes

status: in-progress
type: FEATURE
depth: Minimal
branch: feat/glass-theme-scenes
worktree: .claude-worktrees/glass-theme-scenes

## Request

1. Remove the DaisyUI `dark` theme from the theme picker (it looks the same as `dracula`). Keep `dracula`.
2. Add two image scenes (backgrounds) to the Ptah Glass dark (`ptah-glass`) and light (`ptah-glass-light`)
   scene list, from `apps/ptah-landing-page/public/assets/backgrounds/pyramid_energy_apex.webp` and
   `temple-bg.webp`.

## Decisions

- The `dark` removal is user-approved (explicit request).
- A user whose persisted theme is `dark` must migrate to `dracula` (no broken state).
- Existing scenes stay (aurora, ember, tide, horizon). New scene names: `pyramid`, `temple`.
- Electron is the priority host. VS Code webview must still compile and load the images.
