# Implementation Plan - TASK_2025_220: Nx Build Pipeline Refactoring

## Codebase Investigation Summary

### Current State Analysis

**ptah-extension-vscode** (`apps/ptah-extension-vscode/project.json`):

- `build` target: noop orchestrator depending on `build-webpack` + `post-build-copy`
- `build-webpack`: `@nx/webpack:webpack` executor, outputs to `dist/apps/ptah-extension-vscode`
- `post-build-copy`: 8 inline `node -e` commands copying: webview, assets, package.json, templates, plugins, cli.js
- `copy-assets`: duplicate standalone target (2 more inline commands) -- appears unused by main pipeline
- `package`: 5 inline commands for .vscodeignore, README, LICENSE, npm install, vsce package
- `prune-lockfile` / `copy-workspace-modules` / `prune`: targets exist but not wired into the main build/package flow

**ptah-electron** (`apps/ptah-electron/project.json`):

- `build`: run-commands orchestrator calling `nx build-main`, `nx build-preload`, `nx build ptah-extension-webview`
- `build-main`: `@nx/webpack:webpack` executor, outputs main.js
- `build-preload`: `@nx/webpack:webpack` executor, outputs preload.js
- `copy-renderer`: runs `scripts/copy-renderer.js` (copies webview + patches base href)
- `copy-assets`: runs `scripts/copy-assets.js` (copies icons, plugins, templates, package.json, electron-builder.yml)
- `package`: depends on build + copy-renderer + copy-assets, runs electron-builder

### Key Nx Executor Findings

**`@nx/webpack:webpack` `assets` option** (verified: `node_modules/@nx/webpack/src/executors/webpack/schema.json`):

- Accepts array of `{ glob, input, output, ignore? }` objects
- `input` paths are resolved relative to **workspace root** (verified: `normalize-options.js:27` -- `resolveRelativePathsToProjectRoot = false` for executor assets)
- `output` is relative to the webpack `outputPath`
- Assets are copied after webpack compilation as part of the executor

**`generatePackageJson` option** (verified: `schema.json` and `webpack.impl.js:81`):

- Generates a `package.json` with only the project's runtime `node_module` dependencies
- If a `package.json` exists in the project directory, it is **reused** with dependencies populated
- Also generates a pruned lockfile

### Assets That Need Copying

**ptah-extension-vscode dist output requires:**

1. `main.js` (webpack output) -- already handled
2. `assets/images/` -- from `apps/ptah-extension-vscode/src/assets/` (icons: ptah-icon.png, ptah-icon-sidebar.svg, ptah-icon-toolbar.svg)
3. `assets/plugins/` -- from `apps/ptah-extension-vscode/assets/plugins/` (4 plugin dirs: ptah-angular, ptah-core, ptah-nx-saas, ptah-react)
4. `webview/browser/` -- from `dist/apps/ptah-extension-webview/browser/` (cross-project build output)
5. `templates/` -- from `libs/backend/agent-generation/templates/` (agent template .md files)
6. `package.json` -- the VS Code extension manifest (must preserve all contributes/commands/configuration metadata)
7. `cli.js` -- from `node_modules/@anthropic-ai/claude-agent-sdk/cli.js` (~12MB standalone CLI)

**ptah-extension-vscode package step additionally needs:** 8. `.vscodeignore` -- from `apps/ptah-extension-vscode/.vscodeignore` 9. `README.md` -- from workspace root `README.md` 10. `LICENSE` -- from workspace root `LICENSE` (if exists) 11. `npm install --omit=dev` -- install runtime dependencies 12. `vsce package` -- create .vsix

**ptah-electron dist output requires:**

1. `main.js` (webpack output) -- already handled
2. `preload.js` (webpack output) -- already handled
3. `renderer/` -- from `dist/apps/ptah-extension-webview/browser/` + base href patch
4. `assets/icons/` -- from `apps/ptah-electron/src/assets/` (icon.png, mac/, png/, win/ dirs)
5. `assets/plugins/` -- from `apps/ptah-extension-vscode/assets/plugins/`
6. `templates/` -- from `libs/backend/agent-generation/templates/`
7. `package.json` -- from `apps/ptah-electron/package.json` (app metadata for electron-builder)
8. `electron-builder.yml` -- from `apps/ptah-electron/electron-builder.yml`

---

## Architecture Design

### Design Philosophy

**Replace inline `node -e` commands with Nx `assets` arrays where possible.** The `@nx/webpack:webpack` executor natively supports an `assets` array that copies files after compilation. This handles most static asset copies declaratively.

**Keep `run-commands` targets only for operations that are NOT pure file copies:**

- Cross-project build output copies (webview -> dist) that depend on another project's build
- File content patching (Electron's base href rewrite)
- npm install + vsce package (packaging commands)
- cli.js copy from node_modules

**Do NOT use `generatePackageJson`** for the VS Code extension. Reason: the extension's `package.json` is the VS Code extension manifest containing `contributes`, `commands`, `activationEvents`, `configuration`, etc. The `generatePackageJson` option would create a minimal package.json with only dependency info, losing all VS Code metadata. The manifest must be copied as-is.

**Do NOT use `generatePackageJson`** for the Electron app either. Its `package.json` has only `name`, `version`, `private` -- it serves as metadata for electron-builder, not for dependency resolution.

### What Changes

**Summary of approach for each copy operation:**

| Asset                          | Current                         | New                                         | Rationale                                                |
| ------------------------------ | ------------------------------- | ------------------------------------------- | -------------------------------------------------------- |
| vscode: src/assets             | inline `node -e`                | webpack `assets` array                      | Pure static files within project                         |
| vscode: plugins                | inline `node -e` (with rm + cp) | webpack `assets` array                      | Static files, cross-project but within workspace         |
| vscode: templates              | inline `node -e`                | webpack `assets` array                      | Static files from lib, workspace-root relative           |
| vscode: cli.js                 | inline `node -e`                | webpack `assets` array                      | Static file from node_modules                            |
| vscode: package.json           | inline `node -e`                | webpack `assets` array                      | Single file copy, workspace-root relative                |
| vscode: webview                | inline `node -e` (mkdir + cp)   | `post-build-copy` run-commands (simplified) | Cross-project build output, must run after webview build |
| vscode: .vscodeignore          | inline `node -e` in `package`   | `pre-package` run-commands                  | Packaging prerequisite                                   |
| vscode: README.md              | inline `node -e` in `package`   | `pre-package` run-commands                  | Packaging prerequisite                                   |
| vscode: LICENSE                | inline `node -e` in `package`   | `pre-package` run-commands                  | Packaging prerequisite                                   |
| electron: src/assets           | `copy-assets.js`                | `build-main` webpack `assets` array         | Pure static files within project                         |
| electron: plugins              | `copy-assets.js`                | `build-main` webpack `assets` array         | Cross-project, workspace-root relative                   |
| electron: templates            | `copy-assets.js`                | `build-main` webpack `assets` array         | From lib, workspace-root relative                        |
| electron: package.json         | `copy-assets.js`                | `build-main` webpack `assets` array         | Single file copy                                         |
| electron: electron-builder.yml | `copy-assets.js`                | `build-main` webpack `assets` array         | Single file copy                                         |
| electron: renderer + patch     | `copy-renderer.js`              | Keep as `copy-renderer` run-commands        | Requires file content patching (base href)               |

---

## ptah-extension-vscode Changes

### 1. Add `assets` array to `build-webpack` target

Add the `assets` property to the `build-webpack` options. The `@nx/webpack:webpack` executor resolves `input` paths relative to the workspace root.

```json
"build-webpack": {
  "executor": "@nx/webpack:webpack",
  "outputs": ["{options.outputPath}"],
  "defaultConfiguration": "production",
  "dependsOn": ["^build"],
  "options": {
    "target": "node",
    "compiler": "tsc",
    "outputPath": "dist/apps/ptah-extension-vscode",
    "main": "apps/ptah-extension-vscode/src/main.ts",
    "tsConfig": "apps/ptah-extension-vscode/tsconfig.app.json",
    "webpackConfig": "apps/ptah-extension-vscode/webpack.config.js",
    "assets": [
      {
        "glob": "**/*",
        "input": "apps/ptah-extension-vscode/src/assets",
        "output": "assets"
      },
      {
        "glob": "**/*",
        "input": "apps/ptah-extension-vscode/assets/plugins",
        "output": "assets/plugins"
      },
      {
        "glob": "**/*",
        "input": "libs/backend/agent-generation/templates",
        "output": "templates"
      },
      {
        "glob": "cli.js",
        "input": "node_modules/@anthropic-ai/claude-agent-sdk",
        "output": "."
      },
      {
        "glob": "package.json",
        "input": "apps/ptah-extension-vscode",
        "output": "."
      }
    ]
  },
  "configurations": {
    "development": {
      "mode": "development",
      "optimization": false,
      "sourceMap": true
    },
    "production": {
      "mode": "production",
      "optimization": true,
      "sourceMap": false,
      "extractLicenses": false
    }
  }
}
```

**Rationale for each asset entry:**

- `src/assets` -> `assets`: Extension icons (ptah-icon.png, ptah-icon-sidebar.svg, ptah-icon-toolbar.svg). These are referenced in `package.json` manifest (`icon`, `contributes.viewsContainers`, `contributes.commands`).
- `assets/plugins` -> `assets/plugins`: Plugin asset directories (ptah-angular, ptah-core, ptah-nx-saas, ptah-react). Used by PluginLoaderService at runtime.
- `agent-generation/templates` -> `templates`: Agent template markdown files. Used by TemplateStorageService at runtime.
- `cli.js` -> `.`: The Claude Agent SDK standalone CLI binary (~12MB). Used by agent-sdk library at runtime.
- `package.json` -> `.`: The VS Code extension manifest. Required for vsce packaging and VS Code to load the extension.

### 2. Simplify `post-build-copy` to only copy webview output

The webview output cannot be an asset on the webpack target because it depends on a separate project build (`ptah-extension-webview:build`). Keep this as a `run-commands` target but simplify it to a single cross-platform copy command.

```json
"post-build-copy": {
  "executor": "nx:run-commands",
  "dependsOn": ["build-webpack", "ptah-extension-webview:build"],
  "outputs": [
    "{workspaceRoot}/dist/apps/ptah-extension-vscode/webview"
  ],
  "options": {
    "commands": [
      {
        "command": "node -e \"const fs=require('fs'); fs.mkdirSync('dist/apps/ptah-extension-vscode/webview', {recursive:true}); fs.cpSync('dist/apps/ptah-extension-webview/browser', 'dist/apps/ptah-extension-vscode/webview/browser', {recursive:true})\"",
        "forwardAllArgs": false
      }
    ],
    "parallel": false
  }
}
```

**What was removed:** 7 of the 8 inline commands are eliminated. Only the webview copy remains because it depends on a cross-project build output.

### 3. Restructure `package` target

Split the packaging concerns into two parts:

1. `pre-package`: Copies packaging-only files (.vscodeignore, README, LICENSE) and runs npm install
2. `package`: Runs vsce package

```json
"pre-package": {
  "executor": "nx:run-commands",
  "dependsOn": ["build"],
  "options": {
    "commands": [
      {
        "command": "node -e \"const fs=require('fs'); fs.copyFileSync('apps/ptah-extension-vscode/.vscodeignore', 'dist/apps/ptah-extension-vscode/.vscodeignore')\"",
        "forwardAllArgs": false
      },
      {
        "command": "node -e \"const fs=require('fs'); fs.copyFileSync('README.md', 'dist/apps/ptah-extension-vscode/README.md')\"",
        "forwardAllArgs": false
      },
      {
        "command": "node -e \"const fs=require('fs'); if(fs.existsSync('LICENSE')) fs.copyFileSync('LICENSE', 'dist/apps/ptah-extension-vscode/LICENSE')\"",
        "forwardAllArgs": false
      },
      {
        "command": "cd dist/apps/ptah-extension-vscode && npm install --omit=dev --ignore-scripts 2>&1 || echo 'npm install completed'",
        "forwardAllArgs": false
      }
    ],
    "parallel": false
  }
},
"package": {
  "executor": "nx:run-commands",
  "dependsOn": ["pre-package"],
  "options": {
    "command": "cd dist/apps/ptah-extension-vscode && npx @vscode/vsce package --allow-missing-repository --allow-star-activation",
    "forwardAllArgs": false
  }
}
```

**Why `pre-package` files stay as run-commands:** These are packaging-only files that should NOT be in the regular build output (they'd pollute the dev workflow). `.vscodeignore`, `README.md`, and `LICENSE` are only needed when running `vsce package`. The `npm install` is a command, not a file copy. Putting them in a separate target keeps the build/package separation clean.

### 4. Remove the orphaned `copy-assets` target

The standalone `copy-assets` target (lines 140-156 of current project.json) duplicates logic already handled by the `assets` array on `build-webpack`. Remove it entirely.

### 5. Keep existing `prune-lockfile`, `copy-workspace-modules`, `prune` targets

These targets are not part of the primary build or package flow and may be useful for future optimization. Leave them unchanged.

### 6. Full refactored project.json for ptah-extension-vscode

```json
{
  "name": "ptah-extension-vscode",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "apps/ptah-extension-vscode/src",
  "projectType": "application",
  "tags": ["scope:extension", "type:application"],
  "targets": {
    "build": {
      "executor": "nx:noop",
      "dependsOn": ["build-webpack", "post-build-copy"]
    },
    "build-webpack": {
      "executor": "@nx/webpack:webpack",
      "outputs": ["{options.outputPath}"],
      "defaultConfiguration": "production",
      "dependsOn": ["^build"],
      "options": {
        "target": "node",
        "compiler": "tsc",
        "outputPath": "dist/apps/ptah-extension-vscode",
        "main": "apps/ptah-extension-vscode/src/main.ts",
        "tsConfig": "apps/ptah-extension-vscode/tsconfig.app.json",
        "webpackConfig": "apps/ptah-extension-vscode/webpack.config.js",
        "assets": [
          {
            "glob": "**/*",
            "input": "apps/ptah-extension-vscode/src/assets",
            "output": "assets"
          },
          {
            "glob": "**/*",
            "input": "apps/ptah-extension-vscode/assets/plugins",
            "output": "assets/plugins"
          },
          {
            "glob": "**/*",
            "input": "libs/backend/agent-generation/templates",
            "output": "templates"
          },
          {
            "glob": "cli.js",
            "input": "node_modules/@anthropic-ai/claude-agent-sdk",
            "output": "."
          },
          {
            "glob": "package.json",
            "input": "apps/ptah-extension-vscode",
            "output": "."
          }
        ]
      },
      "configurations": {
        "development": {
          "mode": "development",
          "optimization": false,
          "sourceMap": true
        },
        "production": {
          "mode": "production",
          "optimization": true,
          "sourceMap": false,
          "extractLicenses": false
        }
      }
    },
    "post-build-copy": {
      "executor": "nx:run-commands",
      "dependsOn": ["build-webpack", "ptah-extension-webview:build"],
      "outputs": ["{workspaceRoot}/dist/apps/ptah-extension-vscode/webview"],
      "options": {
        "commands": [
          {
            "command": "node -e \"const fs=require('fs'); fs.mkdirSync('dist/apps/ptah-extension-vscode/webview', {recursive:true}); fs.cpSync('dist/apps/ptah-extension-webview/browser', 'dist/apps/ptah-extension-vscode/webview/browser', {recursive:true})\"",
            "forwardAllArgs": false
          }
        ],
        "parallel": false
      }
    },
    "pre-package": {
      "executor": "nx:run-commands",
      "dependsOn": ["build"],
      "options": {
        "commands": [
          {
            "command": "node -e \"const fs=require('fs'); fs.copyFileSync('apps/ptah-extension-vscode/.vscodeignore', 'dist/apps/ptah-extension-vscode/.vscodeignore')\"",
            "forwardAllArgs": false
          },
          {
            "command": "node -e \"const fs=require('fs'); fs.copyFileSync('README.md', 'dist/apps/ptah-extension-vscode/README.md')\"",
            "forwardAllArgs": false
          },
          {
            "command": "node -e \"const fs=require('fs'); if(fs.existsSync('LICENSE')) fs.copyFileSync('LICENSE', 'dist/apps/ptah-extension-vscode/LICENSE')\"",
            "forwardAllArgs": false
          },
          {
            "command": "cd dist/apps/ptah-extension-vscode && npm install --omit=dev --ignore-scripts 2>&1 || echo 'npm install completed'",
            "forwardAllArgs": false
          }
        ],
        "parallel": false
      }
    },
    "package": {
      "executor": "nx:run-commands",
      "dependsOn": ["pre-package"],
      "options": {
        "command": "cd dist/apps/ptah-extension-vscode && npx @vscode/vsce package --allow-missing-repository --allow-star-activation"
      }
    },
    "prune-lockfile": {
      "dependsOn": ["build"],
      "cache": true,
      "executor": "@nx/js:prune-lockfile",
      "outputs": ["{workspaceRoot}/dist/apps/ptah-extension-vscode/package.json", "{workspaceRoot}/dist/apps/ptah-extension-vscode/package-lock.json"],
      "options": {
        "buildTarget": "build"
      }
    },
    "copy-workspace-modules": {
      "dependsOn": ["build"],
      "cache": true,
      "outputs": ["{workspaceRoot}/dist/apps/ptah-extension-vscode/workspace_modules"],
      "executor": "@nx/js:copy-workspace-modules",
      "options": {
        "buildTarget": "build"
      }
    },
    "prune": {
      "dependsOn": ["prune-lockfile", "copy-workspace-modules"],
      "executor": "nx:noop"
    },
    "serve": {
      "continuous": true,
      "executor": "@nx/js:node",
      "defaultConfiguration": "development",
      "dependsOn": ["build"],
      "options": {
        "buildTarget": "ptah-extension-vscode:build",
        "runBuildTargetDependencies": false
      },
      "configurations": {
        "development": {
          "buildTarget": "ptah-extension-vscode:build:development"
        },
        "production": {
          "buildTarget": "ptah-extension-vscode:build:production"
        }
      }
    },
    "lint": {
      "executor": "@nx/eslint:lint"
    },
    "typecheck": {
      "executor": "nx:run-commands",
      "options": {
        "command": "tsc --noEmit --project apps/ptah-extension-vscode/tsconfig.app.json"
      }
    }
  }
}
```

**Targets removed:** `copy-assets` (orphaned duplicate).

---

## ptah-electron Changes

### 1. Add `assets` array to `build-main` target

Move all static asset copies from `copy-assets.js` into the webpack `assets` configuration.

```json
"build-main": {
  "executor": "@nx/webpack:webpack",
  "outputs": ["{options.outputPath}"],
  "options": {
    "outputPath": "dist/apps/ptah-electron",
    "main": "apps/ptah-electron/src/main.ts",
    "tsConfig": "apps/ptah-electron/tsconfig.app.json",
    "webpackConfig": "apps/ptah-electron/webpack.config.js",
    "target": "node",
    "compiler": "tsc",
    "assets": [
      {
        "glob": "**/*",
        "input": "apps/ptah-electron/src/assets",
        "output": "assets"
      },
      {
        "glob": "**/*",
        "input": "apps/ptah-extension-vscode/assets/plugins",
        "output": "assets/plugins"
      },
      {
        "glob": "**/*",
        "input": "libs/backend/agent-generation/templates",
        "output": "templates"
      },
      {
        "glob": "package.json",
        "input": "apps/ptah-electron",
        "output": "."
      },
      {
        "glob": "electron-builder.yml",
        "input": "apps/ptah-electron",
        "output": "."
      }
    ]
  },
  "configurations": {
    "production": {
      "optimization": true,
      "sourceMap": false
    },
    "development": {
      "optimization": false,
      "sourceMap": true
    }
  }
}
```

**What this replaces from `copy-assets.js`:**

- Section 1 (electron src/assets -> dist/assets): Handled by asset entry 1
- Section 2 (plugins -> dist/assets/plugins): Handled by asset entry 2
- Section 3 (templates -> dist/templates): Handled by asset entry 3
- Section 4 (package.json -> dist): Handled by asset entry 4
- Section 5 (electron-builder.yml -> dist): Handled by asset entry 5

### 2. Keep `copy-renderer` but rewrite as inline command (delete script file)

The `copy-renderer.js` script does two things: (a) copies files and (b) patches `index.html` base href. The patching logic cannot be expressed as an Nx asset. However, the script can be inlined as a simpler run-command to eliminate the external script file.

```json
"copy-renderer": {
  "executor": "nx:run-commands",
  "dependsOn": ["ptah-extension-webview:build"],
  "outputs": [
    "{workspaceRoot}/dist/apps/ptah-electron/renderer"
  ],
  "options": {
    "commands": [
      {
        "command": "node -e \"const fs=require('fs'),p=require('path'); const S='dist/apps/ptah-extension-webview/browser',D='dist/apps/ptah-electron/renderer'; if(fs.existsSync(D))fs.rmSync(D,{recursive:true,force:true}); fs.cpSync(S,D,{recursive:true}); const idx=p.join(D,'index.html'); let h=fs.readFileSync(idx,'utf8'); h=h.replace(/<base href=\\\"\\/\\\"\\s*\\/?>/i,'<base href=\\\"./-\\\">'); fs.writeFileSync(idx,h,'utf8'); console.log('Copied renderer + patched base href')\"",
        "forwardAllArgs": false
      }
    ],
    "parallel": false
  }
}
```

**Wait -- this is getting unwieldy as an inline command.** The base href patching with regex escaping inside a `node -e` string inside JSON is fragile and hard to maintain. This is exactly the kind of thing that justifies keeping a small script.

**Revised decision:** Keep `copy-renderer.js` as a script file. It is 59 lines, well-documented, and does something that cannot be expressed declaratively. But update the target to have proper `dependsOn` and `outputs`.

```json
"copy-renderer": {
  "executor": "nx:run-commands",
  "dependsOn": ["ptah-extension-webview:build"],
  "outputs": [
    "{workspaceRoot}/dist/apps/ptah-electron/renderer"
  ],
  "options": {
    "command": "node apps/ptah-electron/scripts/copy-renderer.js"
  }
}
```

### 3. Delete `copy-assets.js` script

The `copy-assets.js` script is fully replaced by the `assets` array on `build-main`. Delete `apps/ptah-electron/scripts/copy-assets.js`.

### 4. Remove the `copy-assets` target from project.json

The `copy-assets` target is no longer needed since `build-main` handles all static assets.

### 5. Restructure `build` target to use proper `dependsOn`

Instead of using `run-commands` to sequentially invoke other Nx targets (which bypasses Nx's task orchestration), use a `noop` executor with `dependsOn`:

```json
"build": {
  "executor": "nx:noop",
  "dependsOn": ["build-main", "build-preload", "ptah-extension-webview:build"]
}
```

This is better because:

- Nx can parallelize `build-main`, `build-preload`, and `ptah-extension-webview:build` automatically
- The dependency graph is explicit and visible in `nx graph`
- Caching works properly

### 6. Update `build-dev` similarly

```json
"build-dev": {
  "executor": "nx:noop",
  "dependsOn": ["build-main", "build-preload", "ptah-extension-webview:build"],
  "configurations": {
    "development": {}
  }
}
```

Actually, `build-dev` is different -- it explicitly passes `--configuration=development` to the sub-builds. With `dependsOn`, we cannot pass configuration overrides. The `build-dev` target should stay as `run-commands` but simplified:

```json
"build-dev": {
  "executor": "nx:run-commands",
  "options": {
    "commands": [
      "nx build-main ptah-electron --configuration=development",
      "nx build-preload ptah-electron",
      "nx build ptah-extension-webview --configuration=development"
    ],
    "parallel": true
  }
}
```

This stays unchanged from current.

### 7. Update `package` target

Since `copy-assets` is removed, update `dependsOn` to remove it:

```json
"package": {
  "executor": "nx:run-commands",
  "dependsOn": ["build", "copy-renderer"],
  "options": {
    "command": "electron-builder --config electron-builder.yml --project dist/apps/ptah-electron"
  }
}
```

Note: `copy-assets` removed from `dependsOn` because assets are now part of `build-main` which is a dependency of `build`.

### 8. Update `serve` target

Since `copy-assets` is removed, update `serve` to not call it:

```json
"serve": {
  "executor": "nx:run-commands",
  "options": {
    "commands": [
      "nx build-dev ptah-electron",
      "nx copy-renderer ptah-electron",
      "node apps/ptah-electron/scripts/launch.js"
    ],
    "parallel": false
  }
}
```

### 9. Full refactored project.json for ptah-electron

```json
{
  "name": "ptah-electron",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "projectType": "application",
  "sourceRoot": "apps/ptah-electron/src",
  "tags": ["scope:electron", "type:app"],
  "targets": {
    "build-main": {
      "executor": "@nx/webpack:webpack",
      "outputs": ["{options.outputPath}"],
      "options": {
        "outputPath": "dist/apps/ptah-electron",
        "main": "apps/ptah-electron/src/main.ts",
        "tsConfig": "apps/ptah-electron/tsconfig.app.json",
        "webpackConfig": "apps/ptah-electron/webpack.config.js",
        "target": "node",
        "compiler": "tsc",
        "assets": [
          {
            "glob": "**/*",
            "input": "apps/ptah-electron/src/assets",
            "output": "assets"
          },
          {
            "glob": "**/*",
            "input": "apps/ptah-extension-vscode/assets/plugins",
            "output": "assets/plugins"
          },
          {
            "glob": "**/*",
            "input": "libs/backend/agent-generation/templates",
            "output": "templates"
          },
          {
            "glob": "package.json",
            "input": "apps/ptah-electron",
            "output": "."
          },
          {
            "glob": "electron-builder.yml",
            "input": "apps/ptah-electron",
            "output": "."
          }
        ]
      },
      "configurations": {
        "production": {
          "optimization": true,
          "sourceMap": false
        },
        "development": {
          "optimization": false,
          "sourceMap": true
        }
      }
    },
    "build-preload": {
      "executor": "@nx/webpack:webpack",
      "outputs": ["{options.outputPath}"],
      "options": {
        "outputPath": "dist/apps/ptah-electron",
        "main": "apps/ptah-electron/src/preload.ts",
        "tsConfig": "apps/ptah-electron/tsconfig.preload.json",
        "webpackConfig": "apps/ptah-electron/webpack.preload.config.js",
        "target": "node",
        "compiler": "tsc"
      }
    },
    "build": {
      "executor": "nx:noop",
      "dependsOn": ["build-main", "build-preload", "ptah-extension-webview:build"]
    },
    "build-dev": {
      "executor": "nx:run-commands",
      "options": {
        "commands": ["nx build-main ptah-electron --configuration=development", "nx build-preload ptah-electron", "nx build ptah-extension-webview --configuration=development"],
        "parallel": true
      }
    },
    "copy-renderer": {
      "executor": "nx:run-commands",
      "dependsOn": ["ptah-extension-webview:build"],
      "outputs": ["{workspaceRoot}/dist/apps/ptah-electron/renderer"],
      "options": {
        "command": "node apps/ptah-electron/scripts/copy-renderer.js"
      }
    },
    "serve": {
      "executor": "nx:run-commands",
      "options": {
        "commands": ["nx build-dev ptah-electron", "nx copy-renderer ptah-electron", "node apps/ptah-electron/scripts/launch.js"],
        "parallel": false
      }
    },
    "serve:watch": {
      "executor": "nx:run-commands",
      "options": {
        "commands": ["nx build-main ptah-electron --configuration=development --watch", "nx build-preload ptah-electron --watch", "nx build ptah-extension-webview --configuration=development --watch"],
        "parallel": true
      }
    },
    "package": {
      "executor": "nx:run-commands",
      "dependsOn": ["build", "copy-renderer"],
      "options": {
        "command": "electron-builder --config electron-builder.yml --project dist/apps/ptah-electron"
      }
    },
    "typecheck": {
      "executor": "nx:run-commands",
      "options": {
        "command": "tsc --noEmit --project apps/ptah-electron/tsconfig.app.json"
      }
    },
    "lint": {
      "executor": "@nx/eslint:lint"
    }
  }
}
```

**Targets removed:** `copy-assets` (replaced by webpack assets).
**Files deleted:** `apps/ptah-electron/scripts/copy-assets.js`.
**Files kept:** `apps/ptah-electron/scripts/copy-renderer.js` (base href patching logic), `apps/ptah-electron/scripts/launch.js` (electron launcher).

---

## CI Workflow Changes

### publish-extension.yml

**No changes needed.** The CI workflow calls:

1. `npx nx run ptah-extension-vscode:package` -- which depends on `pre-package` -> `build` -> (`build-webpack` + `post-build-copy`)

The refactored `package` target chains correctly. The output structure in `dist/apps/ptah-extension-vscode/` remains identical.

### publish-electron.yml

**Changes needed:** Remove the `copy-assets` step since assets are now part of `build`.

Current workflow steps:

```yaml
- name: Build Electron app
  run: npx nx build ptah-electron

- name: Copy renderer
  run: npx nx copy-renderer ptah-electron

- name: Copy assets # <-- REMOVE THIS STEP
  run: npx nx copy-assets ptah-electron

- name: Package for platform
  run: npx electron-builder --config electron-builder.yml --project dist/apps/ptah-electron ${{ matrix.build-args }}
```

Updated workflow steps:

```yaml
- name: Build Electron app
  run: npx nx build ptah-electron

- name: Copy renderer
  run: npx nx copy-renderer ptah-electron

- name: Package for platform
  run: npx electron-builder --config electron-builder.yml --project dist/apps/ptah-electron ${{ matrix.build-args }}
```

Alternatively, the workflow could just call `npx nx package ptah-electron` since the refactored `package` target has `dependsOn: ["build", "copy-renderer"]` which would trigger the full pipeline. But keeping the explicit steps is fine for CI visibility.

---

## Dependency Chain Summary

### ptah-extension-vscode

```
package
  -> pre-package
    -> build
      -> build-webpack (assets: icons, plugins, templates, cli.js, package.json)
        -> ^build (lib dependencies)
      -> post-build-copy (webview output)
        -> build-webpack
        -> ptah-extension-webview:build
```

### ptah-electron

```
package
  -> build
    -> build-main (assets: icons, plugins, templates, package.json, electron-builder.yml)
    -> build-preload
    -> ptah-extension-webview:build
  -> copy-renderer
    -> ptah-extension-webview:build
```

---

## Migration Steps (Ordered)

### Step 1: Refactor ptah-extension-vscode project.json

1. Add `assets` array to `build-webpack` target (5 asset entries)
2. Simplify `post-build-copy` to only copy webview (remove 7 of 8 commands)
3. Add `pre-package` target (packaging prerequisites)
4. Update `package` target to depend on `pre-package` instead of `build`
5. Remove the orphaned `copy-assets` target

### Step 2: Refactor ptah-electron project.json

1. Add `assets` array to `build-main` target (5 asset entries)
2. Change `build` target from `run-commands` to `noop` with `dependsOn`
3. Add `dependsOn` and `outputs` to `copy-renderer` target
4. Remove `copy-assets` target
5. Update `package` dependsOn (remove `copy-assets`)
6. Update `serve` commands (remove `nx copy-assets`)

### Step 3: Delete copy-assets.js

1. Delete `apps/ptah-electron/scripts/copy-assets.js`

### Step 4: Update CI workflow

1. Remove `Copy assets` step from `.github/workflows/publish-electron.yml`

### Step 5: Update webpack clean:false verification

1. Verify both webpack configs have `clean: false` (already set) -- this is critical because assets are copied into the same outputPath as webpack output. If `clean: true`, webpack would delete the assets on rebuild.

---

## Verification

### Local Development Verification

**VS Code Extension:**

```bash
# 1. Clean dist
rm -rf dist/apps/ptah-extension-vscode

# 2. Build
npx nx build ptah-extension-vscode

# 3. Verify output structure
ls dist/apps/ptah-extension-vscode/
# Expected: main.js, package.json, cli.js, assets/, templates/, webview/

ls dist/apps/ptah-extension-vscode/assets/images/
# Expected: ptah-icon.png, ptah-icon-sidebar.svg, ptah-icon-toolbar.svg

ls dist/apps/ptah-extension-vscode/assets/plugins/
# Expected: ptah-angular/, ptah-core/, ptah-nx-saas/, ptah-react/

ls dist/apps/ptah-extension-vscode/templates/agents/
# Expected: 14 .template.md files

ls dist/apps/ptah-extension-vscode/webview/browser/
# Expected: index.html, main-*.js, styles-*.css

# 4. Package
npx nx package ptah-extension-vscode
# Expected: .vsix file created in dist/apps/ptah-extension-vscode/

# 5. Test in VS Code (F5 debug)
# Open in VS Code, press F5, verify extension loads
```

**Electron App:**

```bash
# 1. Clean dist
rm -rf dist/apps/ptah-electron

# 2. Build
npx nx build ptah-electron

# 3. Verify output structure
ls dist/apps/ptah-electron/
# Expected: main.js, preload.js, package.json, electron-builder.yml, assets/, templates/

ls dist/apps/ptah-electron/assets/icons/
# Expected: icon.png, mac/, png/, win/

ls dist/apps/ptah-electron/assets/plugins/
# Expected: ptah-angular/, ptah-core/, ptah-nx-saas/, ptah-react/

ls dist/apps/ptah-electron/templates/agents/
# Expected: 14 .template.md files

# 4. Copy renderer
npx nx copy-renderer ptah-electron

ls dist/apps/ptah-electron/renderer/
# Expected: index.html (with base href="./"), main-*.js, styles-*.css

# 5. Serve locally
npx nx serve ptah-electron
# Expected: Electron window opens with Angular webview

# 6. Package (optional, requires electron-builder)
npx nx package ptah-electron
# Expected: platform installer in release/
```

### CI Pipeline Verification

After pushing the changes, verify:

1. `npx nx run ptah-extension-vscode:package` produces a valid .vsix
2. `npx nx build ptah-electron && npx nx copy-renderer ptah-electron && electron-builder --config electron-builder.yml --project dist/apps/ptah-electron` produces installers

### Regression Checks

- [ ] VS Code extension loads in F5 debug mode
- [ ] Extension icons appear in activity bar and editor title
- [ ] Plugins load correctly (PluginLoaderService finds templates in assets/plugins/)
- [ ] Templates load correctly (TemplateStorageService finds .md files in templates/)
- [ ] CLI agent works (cli.js accessible at runtime)
- [ ] Webview renders (Angular SPA loads in panel)
- [ ] Electron app launches with `nx serve ptah-electron`
- [ ] Electron renderer loads (Angular SPA loads in BrowserWindow)
- [ ] Electron packaging produces installers
- [ ] .vsix package installs cleanly in VS Code

---

## Files Affected Summary

**MODIFY:**

- `apps/ptah-extension-vscode/project.json` -- Add assets, simplify post-build-copy, restructure package
- `apps/ptah-electron/project.json` -- Add assets, noop build, remove copy-assets, update deps
- `.github/workflows/publish-electron.yml` -- Remove copy-assets step

**DELETE:**

- `apps/ptah-electron/scripts/copy-assets.js` -- Replaced by webpack assets config

**UNCHANGED:**

- `apps/ptah-extension-vscode/webpack.config.js` -- No changes needed
- `apps/ptah-extension-vscode/package.json` -- No changes needed
- `apps/ptah-extension-vscode/.vscodeignore` -- No changes needed
- `apps/ptah-electron/webpack.config.js` -- No changes needed
- `apps/ptah-electron/webpack.preload.config.js` -- No changes needed
- `apps/ptah-electron/electron-builder.yml` -- No changes needed
- `apps/ptah-electron/package.json` -- No changes needed
- `apps/ptah-electron/scripts/copy-renderer.js` -- Kept (base href patching)
- `apps/ptah-electron/scripts/launch.js` -- Kept (electron launcher)
- `.github/workflows/publish-extension.yml` -- No changes needed

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**: This is purely build configuration work -- modifying JSON project files, deleting a JS script, and updating a YAML workflow. No UI components, no Angular code, no browser APIs. A backend developer is the right fit for build tooling and CI pipeline work.

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 2-3 hours

**Breakdown**:

- ptah-extension-vscode project.json refactoring: 30 min
- ptah-electron project.json refactoring: 30 min
- Delete copy-assets.js: 5 min
- Update CI workflow: 10 min
- Testing & verification (both apps build, serve, package): 60-90 min

### Critical Verification Points

**Before Implementation, Developer Must Verify:**

1. **Webpack `clean: false` preserved** -- Both webpack configs (`webpack.config.js` line 28, electron `webpack.config.js` line 27) must keep `clean: false`. If webpack cleans the output dir, it would delete assets copied by the executor.

2. **Asset `input` paths resolve correctly** -- The `@nx/webpack:webpack` executor resolves asset `input` paths relative to workspace root (verified: `node_modules/@nx/webpack/src/executors/webpack/lib/normalize-options.js:27`). All paths in the plan use workspace-root-relative notation.

3. **Asset `output` paths are relative to `outputPath`** -- The `output` field in each asset entry is relative to the webpack `outputPath` (e.g., `"output": "assets"` means `dist/apps/ptah-extension-vscode/assets/`).

4. **`dependsOn` ordering** -- The `build` noop depends on both `build-webpack`/`build-main` AND `post-build-copy`/webview build. The package targets depend on build completing first.

5. **No `generatePackageJson`** -- Deliberately not used. The VS Code extension `package.json` is an extension manifest, not a dependency spec. The Electron `package.json` is electron-builder metadata. Both must be copied as-is.
