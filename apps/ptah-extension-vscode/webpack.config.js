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
    // Bundle reflect-metadata and tsyringe for DI to work properly
    function ({ context, request }, callback) {
      // Bundle reflect-metadata and tsyringe (required for DI)
      if (request === 'reflect-metadata' || request === 'tsyringe') {
        return callback(); // null means "bundle this"
      }
      // Externalize all other node_modules
      if (/^[a-z\-0-9]+/.test(request)) {
        return callback(null, 'commonjs ' + request);
      }
      callback(); // Bundle project files
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
