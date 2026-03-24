# TASK_2025_205: Electron Icons & CI/CD Pipeline

## Type: DEVOPS

## Status: Active

## Created: 2026-03-17

## User Request

Set up proper platform icons and CI/CD pipeline for cross-platform Electron app publishing (Windows, macOS, Linux).

## Strategy: Partial (Architect -> Team-Leader -> Developers)

Requirements are well-defined from prior research (TASK_2025_203, TASK_2025_204).

## Two Parts

### Part 1: Icons

- Generate platform icons (ico, icns, png) from master icon using electron-icon-builder
- Add copy-assets step to webpack/build pipeline to copy icons to dist
- Verify electron-builder.yml icon paths work with the build output

### Part 2: CI/CD Pipeline

- GitHub Actions workflow for cross-platform builds (matrix strategy)
- Windows (NSIS), macOS (DMG+ZIP), Linux (AppImage+deb)
- Unsigned Phase 1 approach (per TASK_2025_204 research)
- Tag-triggered releases (v\*) + manual workflow_dispatch
- Artifact upload + GitHub Releases publishing

## Key Context

- electron-builder.yml already configured at apps/ptah-electron/electron-builder.yml
- Nx monorepo with build targets in project.json
- Icons directory exists at src/assets/icons/ with only README.md
- main-window.ts references icon at path.join(\_\_dirname, 'assets', 'icons', 'icon.png')
- Existing CI workflows: ci.yml, deploy-landing.yml, deploy-server.yml, publish-extension.yml
- Webpack does NOT currently copy assets to dist
