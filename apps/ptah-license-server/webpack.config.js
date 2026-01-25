const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

/**
 * Webpack Configuration for ptah-license-server
 *
 * IMPORTANT: We use `externals` to prevent webpack from bundling certain packages.
 * This avoids ESM/CJS interop issues where webpack's module transformation breaks
 * how these packages export their constructors.
 *
 * Packages marked as external are loaded by Node.js at runtime (via require/import)
 * instead of being bundled, ensuring they work exactly as their authors intended.
 */
module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/ptah-license-server'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  // Mark packages with ESM/CJS compatibility issues as external
  // These will be loaded by Node.js at runtime, not bundled by webpack
  externals: {
    // Auth & Identity
    '@workos-inc/node': 'commonjs @workos-inc/node',

    // Payment processing
    '@paddle/paddle-node-sdk': 'commonjs @paddle/paddle-node-sdk',

    // Email
    '@sendgrid/mail': 'commonjs @sendgrid/mail',

    // Database (Prisma has its own binary, should never be bundled)
    '@prisma/client': 'commonjs @prisma/client',
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
