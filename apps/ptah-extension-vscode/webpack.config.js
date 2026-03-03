const path = require('path');

/**
 * VS Code Extension Webpack Configuration
 *
 * This configuration is specifically tailored for VS Code extensions:
 * - target: 'node' - Extensions run in Node.js environment
 * - externals: { vscode: 'commonjs vscode' } - Don't bundle VS Code API
 * - libraryTarget: 'commonjs2' - Required for VS Code extension loading
 * - No bundling for node_modules to avoid conflicts
 */

/** @type {import('webpack').Configuration} */
module.exports = {
  target: 'node', // VS Code extensions run in Node.js environment
  mode: 'development', // Will be overridden by Nx configurations

  // Entry point with reflect-metadata loaded FIRST
  entry: [
    'reflect-metadata', // Load reflect-metadata polyfill before anything else
    path.resolve(__dirname, './src/main.ts'),
  ],

  output: {
    path: path.resolve(__dirname, '../../dist/apps/ptah-extension-vscode'),
    filename: 'main.js',
    libraryTarget: 'commonjs2', // Required for VS Code extension modules
    clean: false, // Don't clean - we need to preserve webview and package.json
  },

  externals: [
    {
      vscode: 'commonjs vscode', // Don't bundle VS Code API, it's provided by the host
    },
    // Custom externals function for LLM provider tree-shaking
    function ({ context, request }, callback) {
      // === BUNDLE THESE (critical for extension to work) ===

      // Bundle reflect-metadata and tsyringe (required for DI)
      if (request === 'reflect-metadata' || request === 'tsyringe') {
        return callback(); // null means "bundle this"
      }

      // Bundle all @ptah-extension/* packages (our internal libraries)
      // This includes dynamic imports like @ptah-extension/llm-abstraction/anthropic
      if (request.startsWith('@ptah-extension/')) {
        return callback(); // Bundle it
      }

      // Bundle @anthropic-ai/claude-agent-sdk - it's ESM-only and must be bundled
      // for proper ESM/CommonJS interop in the VS Code extension host
      if (request.startsWith('@anthropic-ai/claude-agent-sdk')) {
        return callback(); // Bundle it
      }

      // Bundle @github/copilot-sdk and @github/copilot - both ESM-only
      // ("type": "module", exports only "import"). Same treatment as
      // claude-agent-sdk: must be bundled for CJS interop
      if (request.startsWith('@github/copilot')) {
        return callback(); // Bundle it
      }

      // @google/genai - REMOVED (SDK-only migration: Google GenAI provider removed)
      // @google/gemini-cli-core - REMOVED (SDK-only migration: CLI auth removed)

      // === EXTERNALIZE THESE (loaded at runtime from node_modules) ===

      // Externalize other scoped packages (@anthropic-ai/*, etc.)
      // These are loaded dynamically by agent-sdk
      if (request.startsWith('@')) {
        return callback(null, 'commonjs ' + request);
      }

      // Externalize other node_modules (lowercase packages like zod, uuid, etc.)
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
      '@ptah-extension/vscode-lm-tools': path.resolve(
        __dirname,
        '../../libs/backend/vscode-lm-tools/src'
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
      // Main llm-abstraction entry point
      '@ptah-extension/llm-abstraction': path.resolve(
        __dirname,
        '../../libs/backend/llm-abstraction/src'
      ),
      // Secondary entry points for tree-shaking (dynamic imports)
      '@ptah-extension/llm-abstraction/vscode-lm': path.resolve(
        __dirname,
        '../../libs/backend/llm-abstraction/src/vscode-lm.ts'
      ),
      '@ptah-extension/llm-abstraction/anthropic': path.resolve(
        __dirname,
        '../../libs/backend/llm-abstraction/src/anthropic.ts'
      ),
      // '@ptah-extension/llm-abstraction/openai' - REMOVED (SDK-only migration)
      // '@ptah-extension/llm-abstraction/google' - REMOVED (SDK-only migration)
      '@ptah-extension/llm-abstraction/openrouter': path.resolve(
        __dirname,
        '../../libs/backend/llm-abstraction/src/openrouter.ts'
      ),
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
            transpileOnly: true, // Speed up compilation
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

  devtool: 'source-map', // Will be overridden in production

  // Note: externalsPresets removed - we're handling externals explicitly above

  // Optimization settings for VS Code extensions
  optimization: {
    minimize: false, // Don't minimize in development
    concatenateModules: false, // Prevent issues with dynamic requires
    // Ensure runtime chunk loads reflect-metadata first
    runtimeChunk: false, // Don't split runtime - keep everything in main bundle
  },

  // Import reflect-metadata at the very start of the bundle
  plugins: [
    {
      apply: (compiler) => {
        compiler.hooks.afterEmit.tap('ReflectMetadataPlugin', () => {
          // Log after build to confirm reflect-metadata is first
          console.log(
            '\n✓ Webpack build complete - reflect-metadata loaded first in entry array\n'
          );
        });
      },
    },
  ],

  // Performance settings
  performance: {
    hints: false, // VS Code extensions have different performance characteristics
  },

  // Stats configuration for cleaner output
  stats: {
    errorDetails: true,
    colors: true,
    modules: false,
    chunks: false,
    chunkModules: false,
  },
};
