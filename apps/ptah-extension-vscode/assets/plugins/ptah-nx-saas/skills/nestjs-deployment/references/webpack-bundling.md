# Webpack Bundling for NestJS in Nx

## Overview

Nx uses webpack to bundle NestJS applications into a single `main.js` file. This works well for most code but breaks certain packages that rely on native binaries, dynamic imports, or ESM/CJS interop. The solution is to mark these packages as **webpack externals** so Node.js loads them at runtime instead of webpack bundling them.

---

## NestJS Webpack Configuration

### Basic Configuration

```javascript
// apps/my-api/webpack.config.js
const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/my-api'),
    clean: true,
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: ['./src/assets'],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMaps: true,
    }),
  ],
};
```

### Plugin Options Explained

| Option                | Value             | Purpose                                                                |
| --------------------- | ----------------- | ---------------------------------------------------------------------- |
| `target`              | `'node'`          | Emit Node.js-compatible code (CommonJS, no DOM APIs)                   |
| `compiler`            | `'tsc'`           | Use TypeScript compiler (not SWC) for full decorator support           |
| `main`                | `'./src/main.ts'` | Application entry point                                                |
| `optimization`        | `false`           | Skip minification (not needed for server code, preserves stack traces) |
| `outputHashing`       | `'none'`          | No content hash in filenames (server files are not cache-busted)       |
| `generatePackageJson` | `true`            | Creates `package.json` with production dependencies in dist            |
| `sourceMaps`          | `true`            | Enable source maps for production error stack traces                   |

---

## Webpack Externals

### What Are Externals?

When webpack encounters an `import` or `require` for an external package, it does not bundle it. Instead, it emits a `require()` call that Node.js resolves at runtime from `node_modules`.

### Why Some Packages Must Be External

| Problem                    | Symptom                                       | Example Packages                    |
| -------------------------- | --------------------------------------------- | ----------------------------------- |
| Native binaries            | `Cannot find module './build/Release/...'`    | `@prisma/client`, `bcrypt`, `sharp` |
| ESM/CJS conflicts          | `ERR_REQUIRE_ESM` or `exports is not defined` | `@workos-inc/node`, `resend`        |
| Dynamic requires           | `Cannot find module` at runtime               | SDKs with plugin systems            |
| Complex package structures | Missing files after bundling                  | `@paddle/paddle-node-sdk`           |

### Configuration

```javascript
// apps/my-api/webpack.config.js
const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/my-api'),
    clean: true,
    // Source map paths for debugging (dev only)
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },

  // Mark packages that break when bundled as external
  // Format: 'package-name': 'commonjs package-name'
  externals: {
    // Database (Prisma has native query engine binaries)
    '@prisma/client': 'commonjs @prisma/client',

    // Auth SDK (ESM/CJS interop issues)
    '@workos-inc/node': 'commonjs @workos-inc/node',

    // Payment SDK (complex package structure)
    '@paddle/paddle-node-sdk': 'commonjs @paddle/paddle-node-sdk',

    // Email SDK (ESM-only package)
    resend: 'commonjs resend',

    // Database driver (native bindings)
    pg: 'commonjs pg',
  },

  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: ['./src/assets'],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMaps: true,
    }),
  ],
};
```

### The `commonjs` Prefix

The value `'commonjs @prisma/client'` tells webpack to emit:

```javascript
module.exports = require('@prisma/client');
```

This makes Node.js load the package from `node_modules` at runtime, bypassing webpack entirely.

---

## Identifying Problematic Packages

### Step 1: Build and Test

```bash
npx nx build my-api
cd dist/apps/my-api
node main.js
```

### Step 2: Look for Error Patterns

| Error Pattern                       | Likely Cause                    | Fix                              |
| ----------------------------------- | ------------------------------- | -------------------------------- |
| `Cannot find module './native/...'` | Native binary not bundled       | Add to externals                 |
| `ERR_REQUIRE_ESM`                   | ESM package loaded via require  | Add to externals                 |
| `TypeError: X is not a constructor` | Export mangled by webpack       | Add to externals                 |
| `Module not found: './build/...'`   | Dynamic require not resolved    | Add to externals                 |
| Works in dev, fails in Docker       | Build OS vs runtime OS mismatch | Likely Prisma - add to externals |

### Step 3: Add to Externals

```javascript
externals: {
  'problematic-package': 'commonjs problematic-package',
},
```

### Step 4: Install in Docker

Every external must be explicitly installed in the Docker deps stage because it is not tracked in the generated `package.json`:

```dockerfile
# Stage 2: Dependencies
RUN npm install --omit=dev \
    problematic-package
```

### Rule of Thumb

Add to externals if the package has any of these:

- Native compiled binaries (`.node` files)
- Complex `exports` field in `package.json`
- ESM-only distribution
- `postinstall` scripts that compile native code
- Dynamic `require()` calls based on platform/architecture

---

## Package.json Generation

### How It Works

When `generatePackageJson: true` is set in `NxAppWebpackPlugin`, the build outputs a `package.json` in the dist directory containing only the dependencies that webpack found via static analysis.

```
dist/apps/my-api/
  main.js              # Bundled application
  package.json         # Generated with production deps
  package-lock.json    # Generated lock file
```

### What Gets Included

- Dependencies that webpack resolved and bundled (as metadata)
- The `name`, `version`, and `dependencies` fields

### What Does NOT Get Included

- Webpack externals (because webpack did not bundle them)
- devDependencies (they are only needed at build time)
- peerDependencies (unless explicitly required)

### Docker Integration

The generated `package.json` is used in Stage 2 of the Docker build:

```dockerfile
# Copy the generated package.json (contains bundled dependencies)
COPY --from=builder /app/dist/apps/my-api/package.json ./

# Install production deps from generated package.json
# PLUS manually add webpack externals
RUN npm install --omit=dev \
    @prisma/client \
    prisma \
    @workos-inc/node \
    @paddle/paddle-node-sdk \
    resend \
    pg
```

---

## Common NestJS Externals Reference

Only add these if the build or runtime fails. Not all need to be external in every project.

| Category   | Packages                                               |
| ---------- | ------------------------------------------------------ |
| Database   | `@prisma/client`, `pg`, `pg-native`, `mysql2`          |
| Auth       | `@workos-inc/node`, `@clerk/backend`, `firebase-admin` |
| Payments   | `@paddle/paddle-node-sdk`, `stripe`                    |
| Email      | `resend`, `@sendgrid/mail`, `nodemailer`               |
| Storage    | `@aws-sdk/client-s3`, `sharp`                          |
| Monitoring | `@sentry/node`                                         |

Format for each: `'package-name': 'commonjs package-name'`

---

## Troubleshooting

| Problem                              | Diagnostic                                         | Fix                                                             |
| ------------------------------------ | -------------------------------------------------- | --------------------------------------------------------------- |
| Runtime crash after successful build | Read error for module name                         | Add module to `externals`, install in Docker deps stage         |
| Bundle exceeds 10MB                  | Run `npx nx build my-api --stats-json` and analyze | Move heavy packages to externals                                |
| Source maps not working              | Check plugin and tsconfig                          | Set `sourceMaps: true` in plugin, `sourceMap: true` in tsconfig |
