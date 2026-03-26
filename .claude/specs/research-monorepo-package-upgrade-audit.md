# Monorepo Package Upgrade Audit - Research Report

**Date**: 2026-03-25
**Branch**: feature/esm-esbuild-migration
**Research Method**: npm registry lookups via WebSearch (Bash unavailable)
**Confidence Level**: HIGH for versions found via npm search results; MEDIUM for a few packages where only indirect version evidence was available

---

## 1. Package Version Comparison Table

### Nx Ecosystem

| Package           | Current Version | Latest Stable | Gap        | Major Bump? |
| ----------------- | --------------- | ------------- | ---------- | ----------- |
| nx                | 21.4.1          | 22.6.1        | +1 major   | YES         |
| @nx/angular       | 21.4.1          | 22.6.1        | +1 major   | YES         |
| @nx/js            | 22.1.3          | 22.6.1        | +0.5 minor | No          |
| @nx/esbuild       | 22.1.3          | 22.6.1        | +0.5 minor | No          |
| @nx/eslint        | 21.4.1          | 22.6.1        | +1 major   | YES         |
| @nx/jest          | 21.4.1          | 22.6.1        | +1 major   | YES         |
| @nx/node          | 22.1.3          | 22.6.1        | +0.5 minor | No          |
| @nx/web           | 21.4.1          | 22.6.1        | +1 major   | YES         |
| @nx/webpack       | 22.1.3          | 22.6.1        | +0.5 minor | No          |
| @nx/workspace     | 21.4.1          | 22.6.1        | +1 major   | YES         |
| @nx/nest          | 22.1.3          | 22.6.1        | +0.5 minor | No          |
| @nx/eslint-plugin | 21.4.1          | 22.6.1        | +1 major   | YES         |

**CRITICAL NOTE**: The project currently has a MIXED Nx version state -- some packages are at 21.4.1 while others are at 22.1.3. All Nx packages MUST be on the same major.minor version. This is the highest-priority fix.

### Angular Ecosystem

| Package                    | Current Version | Latest Stable | Gap      | Major Bump? |
| -------------------------- | --------------- | ------------- | -------- | ----------- |
| @angular/core              | ~20.1.0         | 21.2.5        | +1 major | YES         |
| @angular/cli               | ~20.1.0         | 21.2.5        | +1 major | YES         |
| @angular/build             | ~20.1.0         | 21.2.5        | +1 major | YES         |
| @angular/cdk               | ^20.2.14        | 21.2.4        | +1 major | YES         |
| @angular-devkit/core       | ~20.1.0         | 21.2.5        | +1 major | YES         |
| @angular-devkit/schematics | ~20.1.0         | 21.2.5        | +1 major | YES         |
| @angular/compiler-cli      | ~20.1.0         | 21.2.5        | +1 major | YES         |
| @angular/youtube-player    | ^20.2.14        | 21.2.5        | +1 major | YES         |
| @schematics/angular        | ~20.1.0         | 21.2.5        | +1 major | YES         |
| ng-packagr                 | ~20.1.0         | 21.2.1        | +1 major | YES         |
| angular-eslint             | ^20.0.0         | 21.3.1        | +1 major | YES         |
| jest-preset-angular        | ~15.0.0         | 16.1.1        | +1 major | YES         |

### TypeScript & Build Tools

| Package    | Current Version | Latest Stable | Gap            | Major Bump? |
| ---------- | --------------- | ------------- | -------------- | ----------- |
| typescript | ~5.8.2          | 6.0.2         | +1 major       | YES         |
| esbuild    | ^0.19.2         | 0.27.4        | +8 minor (0.x) | SIGNIFICANT |
| ts-jest    | ^29.4.0         | 29.4.6        | patch          | No          |

### NestJS Ecosystem

| Package        | Current Version | Latest Stable | Gap   | Major Bump? |
| -------------- | --------------- | ------------- | ----- | ----------- |
| @nestjs/common | ^11.0.0         | 11.1.17       | minor | No          |
| @nestjs/core   | ^11.0.0         | 11.1.17       | minor | No          |

### Testing

| Package             | Current Version | Latest Stable | Gap      | Major Bump? |
| ------------------- | --------------- | ------------- | -------- | ----------- |
| jest                | ^30.0.2         | 30.3.0        | minor    | No          |
| jest-preset-angular | ~15.0.0         | 16.1.1        | +1 major | YES         |
| ts-jest             | ^29.4.0         | 29.4.6        | patch    | No          |

### Styling

| Package     | Current Version | Latest Stable | Gap      | Major Bump? |
| ----------- | --------------- | ------------- | -------- | ----------- |
| tailwindcss | ^3.4.18         | 4.2.2         | +1 major | YES         |
| daisyui     | ^4.12.24        | 5.5.19        | +1 major | YES         |

### Code Quality

| Package                         | Current Version | Latest Stable | Gap       | Major Bump? |
| ------------------------------- | --------------- | ------------- | --------- | ----------- |
| eslint                          | ^9.8.0          | 10.1.0        | +1 major  | YES         |
| prettier                        | ^2.6.2          | 3.8.1         | +1 major  | YES         |
| husky                           | ^9.1.7          | 9.1.7         | AT LATEST | No          |
| @commitlint/cli                 | ^18.0.0         | 20.5.0        | +2 major  | YES         |
| @commitlint/config-conventional | ^18.0.0         | 20.5.0        | +2 major  | YES         |

### Desktop / Electron

| Package          | Current Version | Latest Stable | Gap      | Major Bump? |
| ---------------- | --------------- | ------------- | -------- | ----------- |
| electron         | ^35.0.0         | 41.0.4        | +6 major | YES         |
| electron-builder | ^25.0.0         | 26.8.1        | +1 major | YES         |

### Database

| Package        | Current Version | Latest Stable | Gap   | Major Bump? |
| -------------- | --------------- | ------------- | ----- | ----------- |
| prisma         | 7.1.0           | 7.5.0         | minor | No          |
| @prisma/client | 7.1.0           | 7.5.0         | minor | No          |

### Utilities

| Package | Current Version | Latest Stable | Gap   | Major Bump? |
| ------- | --------------- | ------------- | ----- | ----------- |
| zod     | ^4.1.12         | 4.3.6         | minor | No          |
| rxjs    | ~7.8.0          | 7.8.2         | patch | No          |
| tslib   | ^2.3.0          | 2.8.1         | minor | No          |
| marked  | ^17.0.0         | 17.0.5        | patch | No          |

---

## 2. Packages with MAJOR Version Bumps Available

### Tier 1 - Core Framework Upgrades (must be coordinated together)

1. **nx**: 21.4.1 -> 22.6.1 (MIXED state in project - some already at 22.1.3)
2. **@angular/core** (and all Angular packages): 20.1.x -> 21.2.5
3. **typescript**: 5.8.2 -> 6.0.2
4. **ng-packagr**: 20.1.x -> 21.2.1
5. **angular-eslint**: 20.x -> 21.3.1
6. **jest-preset-angular**: 15.x -> 16.1.1

### Tier 2 - Styling (coordinated pair)

7. **tailwindcss**: 3.4.x -> 4.2.2
8. **daisyui**: 4.12.x -> 5.5.19

### Tier 3 - Tooling Upgrades (independent)

9. **eslint**: 9.x -> 10.1.0
10. **prettier**: 2.6.x -> 3.8.1
11. **@commitlint/cli**: 18.x -> 20.5.0
12. **@commitlint/config-conventional**: 18.x -> 20.5.0
13. **electron**: 35.x -> 41.0.4
14. **electron-builder**: 25.x -> 26.8.1

### Tier 4 - Significant Minor (0.x semver)

15. **esbuild**: 0.19.x -> 0.27.4 (8 minor bumps in 0.x can contain breaking changes)

---

## 3. Packages Already at Latest (or within patch range)

| Package        | Status                                |
| -------------- | ------------------------------------- |
| husky          | 9.1.7 -- AT LATEST                    |
| rxjs           | ~7.8.0, latest 7.8.2 -- patch only    |
| marked         | ^17.0.0, latest 17.0.5 -- patch only  |
| ts-jest        | ^29.4.0, latest 29.4.6 -- patch only  |
| @nestjs/common | ^11.0.0, latest 11.1.17 -- minor only |
| @nestjs/core   | ^11.0.0, latest 11.1.17 -- minor only |
| jest           | ^30.0.2, latest 30.3.0 -- minor only  |
| prisma         | 7.1.0, latest 7.5.0 -- minor only     |
| @prisma/client | 7.1.0, latest 7.5.0 -- minor only     |
| zod            | ^4.1.12, latest 4.3.6 -- minor only   |
| tslib          | ^2.3.0, latest 2.8.1 -- minor only    |

---

## 4. Compatibility Concerns and Upgrade Strategy

### CRITICAL: Mixed Nx Version State (Fix FIRST)

The project currently has packages split between Nx 21.4.1 and Nx 22.1.3:

- **At 21.4.1**: nx, @nx/angular, @nx/eslint, @nx/eslint-plugin, @nx/jest, @nx/web, @nx/workspace
- **At 22.1.3**: @nx/js, @nx/esbuild, @nx/node, @nx/webpack, @nx/nest

This MUST be resolved first. All @nx/\* packages must be on the same version. The recommended path is to align everything to 22.6.1 using `nx migrate`.

### Nx 22 + Angular 21 + TypeScript Compatibility

According to the Nx 22.3 release blog:

- **Nx 22.3+** officially adds Angular 21 support
- **Nx 22.3+** also adds experimental tsgo (TypeScript in Go) compiler support
- Angular 21 requires **ES2022 minimum** in TypeScript lib compiler options
- Angular 21 embraces **Vitest** as the recommended test runner (though Jest still works via jest-preset-angular 16.x)

**Recommended upgrade order**:

1. Align all Nx packages to 22.6.1 first (use `nx migrate 22.6.1`)
2. Then upgrade Angular 20 -> 21 (Nx migration should handle this)
3. Then upgrade TypeScript 5.8 -> 6.0 (verify Angular 21 supports TS 6.0 -- this needs validation, as Angular 21 may still require TS 5.8.x or 5.9.x)

**WARNING on TypeScript 6.0**: TypeScript 6.0 was released very recently (2 days ago as of 2026-03-25). Angular 21.2.5 may not yet officially support TS 6.0. Verify this before upgrading. Angular typically supports specific TS version ranges; jumping to a brand-new major could cause compiler errors. The safer path is to upgrade to the latest TS 5.8.x or 5.9.x first, then wait for Angular to officially declare TS 6.0 support.

### Tailwind CSS 3 -> 4 + DaisyUI 4 -> 5

This is a **significant breaking change** requiring coordinated migration:

- **Tailwind CSS 4** completely changes the configuration model: no more `tailwind.config.js`, configuration moves to CSS (`@import "tailwindcss"`)
- **DaisyUI 5** requires Tailwind CSS 4 and changes from JS plugin to CSS plugin (`@plugin "daisyui"`)
- DaisyUI 5 has ~15 HTML/class breaking changes (renamed classes like `card-bordered` -> `card-border`, `card-compact` -> `card-sm`, avatar class renames, etc.)
- Tailwind provides an official upgrade tool: `npx @tailwindcss/upgrade`

**Recommendation**: This should be its own dedicated task, separate from the Nx/Angular upgrade.

### ESLint 9 -> 10

ESLint 10 is a new major version. The project is already on flat config (ESLint 9), which was the major migration hurdle. ESLint 10 should be a relatively smooth upgrade but verify that `angular-eslint`, `typescript-eslint`, and `@nx/eslint` all support ESLint 10 before upgrading.

### Prettier 2 -> 3

Prettier 3 has been out for years and Nx 22.3 explicitly added Prettier v3 support. This is overdue and should be straightforward. Key breaking change: Prettier 3 uses ESM by default, but the config files should still work.

### @commitlint/cli 18 -> 20

Two major version jumps. Version 19 introduced ESM support and Node 18+ requirement. Version 20 may have additional breaking changes. Check changelog before upgrading.

### Electron 35 -> 41

Six major versions behind. Electron follows Chromium releases, so each major version bumps the Chromium engine. This affects:

- Supported Node.js APIs
- Web API availability in renderer process
- Native module compatibility
- Need to verify electron-builder 26.x supports Electron 41

### esbuild 0.19 -> 0.27

While technically "minor" bumps in 0.x semver, esbuild can introduce breaking changes in any 0.x release. Key areas to watch:

- Output format changes
- Plugin API changes
- Default behavior changes for bundling/tree-shaking
- The @nx/esbuild plugin should abstract most of this, but verify compatibility

---

## 5. Recommended Upgrade Phases

### Phase 1: Fix Mixed Nx Versions (URGENT)

- Align all @nx/\* packages and nx to 22.6.1 using `nx migrate 22.6.1`
- This is a prerequisite for everything else
- Run migrations, fix any breaking changes

### Phase 2: Angular 20 -> 21 + Related

- Upgrade Angular to 21.2.x (Nx migrate should handle this)
- Upgrade ng-packagr to 21.2.1
- Upgrade angular-eslint to 21.3.1
- Upgrade jest-preset-angular to 16.1.1
- Upgrade @angular/cdk to 21.2.4
- **DO NOT** upgrade TypeScript to 6.0 yet -- wait for confirmed compatibility

### Phase 3: Prettier 2 -> 3 + Commitlint

- Upgrade prettier to 3.8.1 (Nx 22.3 explicitly supports this)
- Upgrade @commitlint/cli and @commitlint/config-conventional to 20.5.0
- Update any prettier config files as needed

### Phase 4: Tailwind CSS 3 -> 4 + DaisyUI 4 -> 5

- Run `npx @tailwindcss/upgrade` first
- Install daisyui 5 and update CSS imports
- Fix all ~15 HTML class renames across Angular templates
- This is the most labor-intensive upgrade

### Phase 5: Electron 35 -> 41

- Upgrade electron and electron-builder together
- Test native module compatibility
- Verify auto-updater still works

### Phase 6: ESLint 9 -> 10 (wait for ecosystem)

- Only after verifying angular-eslint 21.x and typescript-eslint support ESLint 10
- May need to wait for @nx/eslint to officially support ESLint 10

### Phase 7: TypeScript 5.8 -> 6.0 (wait for Angular support)

- Only after Angular officially declares TS 6.0 support
- This is the riskiest upgrade due to potential compiler changes

### Minor/Patch Updates (can be done anytime)

- prisma + @prisma/client: 7.1.0 -> 7.5.0
- zod: 4.1.12 -> 4.3.6
- esbuild: 0.19.x -> 0.27.4 (test carefully)
- rxjs: 7.8.0 -> 7.8.2
- tslib: 2.3.0 -> 2.8.1
- marked: 17.0.0 -> 17.0.5
- @nestjs packages: 11.0.0 -> 11.1.17
- jest: 30.0.2 -> 30.3.0

---

## Sources

- [nx - npm](https://www.npmjs.com/package/nx?activeTab=versions)
- [@nx/angular - npm](https://www.npmjs.com/package/@nx/angular)
- [@angular/core - npm](https://www.npmjs.com/package/@angular/core)
- [typescript - npm](https://www.npmjs.com/package/typescript)
- [@nestjs/core - npm](https://www.npmjs.com/package/@nestjs/core)
- [jest - npm](https://www.npmjs.com/package/jest)
- [esbuild - npm](https://www.npmjs.com/package/esbuild)
- [tailwindcss - npm](https://www.npmjs.com/package/tailwindcss)
- [daisyui - npm](https://www.npmjs.com/package/daisyui)
- [eslint - npm](https://www.npmjs.com/package/eslint)
- [prettier - npm](https://www.npmjs.com/package/prettier)
- [husky - npm](https://www.npmjs.com/package/husky)
- [electron - npm](https://www.npmjs.com/package/electron)
- [electron-builder - npm](https://www.npmjs.com/package/electron-builder)
- [prisma - npm](https://www.npmjs.com/package/prisma)
- [@angular/cdk - npm](https://www.npmjs.com/package/@angular/cdk)
- [angular-eslint - npm](https://www.npmjs.com/package/angular-eslint)
- [jest-preset-angular - npm](https://www.npmjs.com/package/jest-preset-angular)
- [ng-packagr - npm](https://www.npmjs.com/package/ng-packagr?activeTab=versions)
- [ts-jest - npm](https://www.npmjs.com/package/ts-jest)
- [marked - npm](https://www.npmjs.com/package/marked)
- [zod - npm](https://www.npmjs.com/package/zod)
- [@commitlint/cli - npm](https://www.npmjs.com/package/@commitlint/cli)
- [@commitlint/config-conventional - npm](https://www.npmjs.com/package/@commitlint/config-conventional)
- [rxjs - npm](https://www.npmjs.com/package/rxjs)
- [tslib - npm](https://www.npmjs.com/package/tslib)
- [Nx 22.3 Release Blog](https://nx.dev/blog/nx-22-3-release)
- [Nx and Angular Version Matrix](https://nx.dev/docs/technologies/angular/guides/angular-nx-version-matrix)
- [Nx, Node.js and TypeScript Compatibility](https://nx.dev/nx-api/workspace/documents/nx-nodejs-typescript-version-matrix)
- [Angular Version Compatibility](https://angular.dev/reference/versions)
- [DaisyUI 5 Upgrade Guide](https://daisyui.com/docs/upgrade/)
