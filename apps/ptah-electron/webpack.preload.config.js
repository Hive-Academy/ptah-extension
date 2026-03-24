const path = require('path');

/**
 * Electron Preload Script Webpack Configuration
 *
 * This configuration bundles the preload script that bridges
 * the renderer (Angular SPA) with the main process via contextBridge.
 *
 * - target: 'electron-preload' - Preload context (limited Node.js access)
 * - Only externalizes electron (provided by runtime)
 */

/** @type {import('webpack').Configuration} */
module.exports = {
  target: 'electron-preload',
  mode: 'development',

  entry: path.resolve(__dirname, './src/preload.ts'),

  output: {
    path: path.resolve(__dirname, '../../dist/apps/ptah-electron'),
    filename: 'preload.js',
  },

  externals: {
    electron: 'commonjs electron',
  },

  resolve: {
    extensions: ['.ts', '.js'],
  },

  module: {
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: 'ts-loader',
          options: {
            transpileOnly: true,
            configFile: 'tsconfig.preload.json',
          },
        },
      },
    ],
  },

  devtool: 'source-map',
};
