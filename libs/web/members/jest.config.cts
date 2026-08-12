module.exports = {
  displayName: 'web-members',
  preset: '../../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../../coverage/libs/web/members',
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  // jest-preset-angular's setup-env entry is ESM-only, so the default
  // node_modules ignore leaves it untransformed and Jest fails on its bare
  // `import`. Same exception the other web libs carry.
  //
  // `marked` + `ngx-markdown` were added by TASK_2026_177 Batch 7, when the
  // community composers became the first specs in this lib to render
  // `<ptah-markdown-block>`. `marked` ships its ESM build as `lib/marked.esm.js`
  // — a bare `.js`, so the `.mjs`-only exception leaves it untransformed and
  // Jest dies on its `export` keyword; `ngx-markdown` is listed alongside it
  // because it is what pulls `marked` in. `apps/ptah-landing-page/jest.config.ts`
  // carries the identical pair for the identical reason.
  //
  // ⚠️ These specs render the preview through the REAL `'member'` preset
  // (`provideMarkdownRendering({ extensions: 'member' })`) rather than mocking
  // the renderer. Mocking it would leave NFR-S2's single-chokepoint claim
  // asserted only against source text and never against the path a browser
  // actually takes.
  transformIgnorePatterns: [
    'node_modules/(?!(?:.*\\.mjs$|jest-preset-angular|marked|ngx-markdown))',
  ],
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
};
