const path = require('path');

/**
 * Electron Main Process Webpack Configuration
 *
 * This configuration is tailored for the Electron main process:
 * - target: 'electron-main' - Bundles for Electron main process
 * - externals: electron is provided by runtime
 * - libraryTarget: 'commonjs2' - Required for Electron module loading
 * - Bundles @ptah-extension/* libraries (except platform-vscode and vscode-lm-tools)
 * - Shims 'vscode' module for transitively-imported vscode-core services
 */

/** @type {import('webpack').Configuration} */
module.exports = {
  target: 'electron-main',
  mode: 'development',

  // Entry point with reflect-metadata loaded FIRST
  entry: ['reflect-metadata', path.resolve(__dirname, './src/main.ts')],

  output: {
    path: path.resolve(__dirname, '../../dist/apps/ptah-electron'),
    filename: 'main.js',
    libraryTarget: 'commonjs2',
    clean: false,
  },

  externals: [
    // Electron is provided by the runtime
    { electron: 'commonjs electron' },
    // Custom externals function
    function ({ request }, callback) {
      // Bundle reflect-metadata and tsyringe (required for DI)
      if (request === 'reflect-metadata' || request === 'tsyringe') {
        return callback();
      }

      // Bundle 'vscode' — resolved to our shim via resolve.alias (NOT a real module)
      if (request === 'vscode') {
        return callback();
      }

      // Bundle all @ptah-extension/* packages (our internal libraries)
      if (request.startsWith('@ptah-extension/')) {
        return callback();
      }

      // Bundle @anthropic-ai/claude-agent-sdk (ESM-only, must be bundled)
      if (request.startsWith('@anthropic-ai/claude-agent-sdk')) {
        return callback();
      }

      // Externalize other scoped packages
      if (request.startsWith('@')) {
        return callback(null, 'commonjs ' + request);
      }

      // Externalize other node_modules
      if (/^[a-z\-0-9]+/.test(request)) {
        return callback(null, 'commonjs ' + request);
      }

      // Bundle everything else (relative imports, project files)
      callback();
    },
  ],

  resolve: {
    extensions: ['.ts', '.js', '.json'],
    alias: {
      '@ptah-extension/platform-core': path.resolve(
        __dirname,
        '../../libs/backend/platform-core/src'
      ),
      '@ptah-extension/platform-electron': path.resolve(
        __dirname,
        '../../libs/backend/platform-electron/src'
      ),
      '@ptah-extension/shared': path.resolve(
        __dirname,
        '../../libs/shared/src'
      ),
      '@ptah-extension/vscode-core': path.resolve(
        __dirname,
        '../../libs/backend/vscode-core/src'
      ),
      '@ptah-extension/workspace-intelligence': path.resolve(
        __dirname,
        '../../libs/backend/workspace-intelligence/src'
      ),
      '@ptah-extension/agent-sdk': path.resolve(
        __dirname,
        '../../libs/backend/agent-sdk/src'
      ),
      '@ptah-extension/agent-generation': path.resolve(
        __dirname,
        '../../libs/backend/agent-generation/src'
      ),
      '@ptah-extension/template-generation': path.resolve(
        __dirname,
        '../../libs/backend/template-generation/src'
      ),
      '@ptah-extension/llm-abstraction': path.resolve(
        __dirname,
        '../../libs/backend/llm-abstraction/src'
      ),
      '@ptah-extension/llm-abstraction/anthropic': path.resolve(
        __dirname,
        '../../libs/backend/llm-abstraction/src/anthropic.ts'
      ),
      '@ptah-extension/llm-abstraction/openrouter': path.resolve(
        __dirname,
        '../../libs/backend/llm-abstraction/src/openrouter.ts'
      ),
      // TASK_2025_200 Batch 3: Shim the 'vscode' module for Electron.
      // Some @ptah-extension/vscode-core modules (OutputManager, ErrorHandler,
      // ConfigManager, etc.) import vscode at module level. Since we import
      // from the barrel export, webpack includes these modules transitively.
      // This shim provides empty stubs so the modules load without crashing.
      // The VS Code-specific classes are NEVER instantiated in Electron --
      // we register Electron-compatible replacements instead.
      vscode: path.resolve(__dirname, './src/shims/vscode-shim.ts'),
      // Shim @ptah-extension/vscode-lm-tools: agent-sdk imports PTAH_SYSTEM_PROMPT from it.
      // Provide a minimal shim that exports the constant as empty string (MCP tools are VS Code-only).
      '@ptah-extension/vscode-lm-tools': path.resolve(
        __dirname,
        './src/shims/vscode-lm-tools-shim.ts'
      ),
      // NOTE: Do NOT alias @ptah-extension/platform-vscode - it should not be imported in Electron
    },
  },

  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: {
            transpileOnly: true,
            configFile: 'tsconfig.app.json',
          },
        },
      },
      {
        test: /\.node$/,
        use: 'node-loader',
      },
    ],
  },

  devtool: 'source-map',

  optimization: {
    minimize: false,
    concatenateModules: false,
    runtimeChunk: false,
  },

  performance: {
    hints: false,
  },
};
