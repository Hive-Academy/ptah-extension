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
  
  entry: path.resolve(__dirname, './src/main.ts'),
  
  output: {
    path: path.resolve(__dirname, '../../dist/apps/ptah-extension-vscode'),
    filename: 'main.js',
    libraryTarget: 'commonjs2', // Required for VS Code extension modules
    clean: true
  },
  
  externals: {
    vscode: 'commonjs vscode', // Don't bundle VS Code API, it's provided by the host
  },
  
  resolve: {
    extensions: ['.ts', '.js', '.json'],
    alias: {
      '@ptah-extension/shared': path.resolve(__dirname, '../../libs/shared/src'),
    }
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
            configFile: 'tsconfig.app.json'
          }
        }
      },
      {
        test: /\.node$/,
        use: 'node-loader'
      }
    ]
  },
  
  devtool: 'source-map', // Will be overridden in production
  
  // Don't bundle node_modules - let extension host handle them
  externalsPresets: { node: true },
  
  // Optimization settings for VS Code extensions
  optimization: {
    minimize: false, // Don't minimize in development
    concatenateModules: false, // Prevent issues with dynamic requires
  },
  
  // Performance settings
  performance: {
    hints: false // VS Code extensions have different performance characteristics
  },
  
  // Stats configuration for cleaner output
  stats: {
    errorDetails: true,
    colors: true,
    modules: false,
    chunks: false,
    chunkModules: false
  }
};