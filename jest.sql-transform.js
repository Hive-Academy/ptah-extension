/**
 * Jest transform for .sql files — mirrors esbuild's `text` loader.
 * Returns the raw SQL string as the module's default export so that
 * static `import sql from './foo.sql'` works in test suites.
 */
module.exports = {
  process(sourceText) {
    return { code: `module.exports = ${JSON.stringify(sourceText)};` };
  },
};
