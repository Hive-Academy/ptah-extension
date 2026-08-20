export default {
  displayName: 'ptah-landing-page',
  preset: '../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../coverage/ptah-landing-page',
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  /**
   * `marked` ships its ESM build as `lib/marked.esm.js` — a bare `.js`, so the
   * default `.mjs`-only exception leaves it untransformed and Jest dies on its
   * `export` keyword. Any spec reaching `@ptah-extension/markdown` needs this.
   * `ngx-markdown` is listed alongside it because it is what pulls `marked` in.
   *
   * This surfaced the first time this app got a spec file — the config had
   * never been exercised before.
   *
   * NOTE for whoever adds the next spec here: importing `./app.routes` drags
   * the eager `LandingPageComponent` and the whole marketing graph
   * (fullcalendar, gsap, lenis) into the module graph, each with its own ESM
   * packaging problem. Prefer testing route BEHAVIOUR against the pieces a
   * route composes rather than against the route table itself.
   */
  transformIgnorePatterns: [
    'node_modules/(?!(?:.*\\.mjs$|marked|ngx-markdown))',
  ],
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
};
