/**
 * esbuild plugin: cjs-external-named-imports
 *
 * Rewrites named imports of CJS-only externals (e.g. `electron`) inside an
 * ESM bundle into a virtual ESM shim that uses `createRequire(import.meta.url)`
 * to load the underlying CJS module and re-export the named exports. This
 * sidesteps Node's ESM resolver, which rejects
 *
 *   import { BrowserWindow } from 'electron';
 *
 * with `SyntaxError: ... 'electron' does not provide an export named 'BrowserWindow'`,
 * because the `electron` module is CJS-only and exposes no named ESM bindings.
 *
 * The plugin is a no-op for non-ESM bundles (e.g. preload runs as CJS and does
 * not need rewriting).
 *
 * Usage:
 *   const cjsExternalNamedImports = require('./esbuild-plugins/cjs-external-named-imports.cjs');
 *   esbuild.build({
 *     format: 'esm',
 *     external: ['electron', ...],
 *     plugins: [
 *       cjsExternalNamedImports({
 *         modules: ['electron'],
 *         namedExports: { electron: ['app', 'BrowserWindow', ...] },
 *       }),
 *     ],
 *   });
 *
 * @param {{
 *   modules: string[],
 *   namedExports: Record<string, string[]>,
 * }} options
 * @returns {import('esbuild').Plugin}
 */
function cjsExternalNamedImports(options) {
  const modules = new Set(options.modules ?? []);
  const namedExports = options.namedExports ?? {};
  const NAMESPACE = 'cjs-external-named-imports';

  return {
    name: 'cjs-external-named-imports',
    setup(build) {
      // No-op for non-ESM bundles. The preload bundle uses CJS and does not
      // need rewriting -- `require('electron')` works there natively.
      const format = build.initialOptions.format;
      if (format !== 'esm') {
        return;
      }

      // Intercept resolution of the configured module names and route them
      // to our virtual loader. We mark them as not external so esbuild will
      // call the onLoad below; the virtual module itself ultimately calls
      // `require(<modName>)`, which keeps the underlying module external at
      // runtime (electron-builder needs `electron` to remain external).
      const filter = new RegExp(
        '^(' +
          [...modules]
            .map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('|') +
          ')$',
      );

      build.onResolve({ filter }, (args) => {
        if (!modules.has(args.path)) {
          return null;
        }
        return {
          path: args.path,
          namespace: NAMESPACE,
        };
      });

      build.onLoad({ filter: /.*/, namespace: NAMESPACE }, (args) => {
        const modName = args.path;
        const names = namedExports[modName] ?? [];
        const destructure = names.length > 0 ? `{ ${names.join(', ')} }` : '{}';

        // Use `createRequire` with a uniquely-aliased local binding. This
        // matters for two reasons:
        //   1. Importing `createRequire` plainly would collide with the
        //      banner ("Identifier 'createRequire' has already been declared").
        //      Aliasing avoids the duplicate top-level identifier.
        //   2. Calling the banner-provided global `require()` directly
        //      causes esbuild to detect `require('electron')` and route it
        //      back through our own onResolve hook -- a recursive self-
        //      reference that produces infinite-loop init code. Using a
        //      freshly-created `nativeRequire` keeps the lookup outside
        //      esbuild's resolver entirely.
        const contents = [
          "import { createRequire as __cjsExtNamed_createRequire } from 'module';",
          'const __cjsExtNamed_require = __cjsExtNamed_createRequire(import.meta.url);',
          `const mod = __cjsExtNamed_require(${JSON.stringify(modName)});`,
          `export const ${destructure} = mod;`,
          'export default mod;',
        ].join('\n');

        return {
          contents,
          loader: 'js',
        };
      });
    },
  };
}

module.exports = cjsExternalNamedImports;
module.exports.default = cjsExternalNamedImports;
