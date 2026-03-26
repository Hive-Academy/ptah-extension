# TASK_2025_222: Comprehensive Nx Migration, Package Updates & Unused Package Audit

## User Request

Perform a proper Nx migration and npm packages update. Install latest stable versions for Nx and Angular, audit all other packages for updates, and remove any unused packages.

## Task Type

DEVOPS

## Complexity

Complex — affects entire monorepo (19 projects, 80+ dependencies)

## Strategy

Research -> Architect -> DevOps Engineer (phased execution)

## Current State

- **Branch**: `feature/esm-esbuild-migration`
- **Nx**: Mixed versions (21.4.1 and 22.1.3) — already partially migrated
- **Angular**: 20.1.0
- **TypeScript**: 5.8.2
- **Node types**: 20.19.9

## Key Risks

1. Nx version mismatch already exists (21.4.1 vs 22.1.3)
2. Angular + Nx version compatibility matrix must be respected
3. Many packages have peer dependency constraints
4. Monorepo with 19 projects — breakage cascades
5. esbuild/webpack build pipeline must remain functional

## Success Criteria

- All Nx packages on same latest stable version
- Angular updated to latest stable
- All other packages updated to latest compatible versions
- Unused packages identified and removed
- `npm run build:all` passes
- `npm run lint:all` passes
- `npm run typecheck:all` passes
