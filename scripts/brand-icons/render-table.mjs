/**
 * Renders the two vendored modules for `vendor-brand-icons.mjs`, as pure
 * string transforms over the vendoring outcomes (prettier formats them after):
 *
 * - the brand table (`brand-marks.vendored.ts`): `BRAND_MARKS` and
 *   `MONOGRAM_SLUGS`, read only by lazily loaded code;
 * - the provider subset (`provider-brand-art.vendored.ts`): the
 *   `PROVIDER_ART_*` artwork consts and `PROVIDER_BRAND_ART`, read by the
 *   eager `ProviderMarkComponent`.
 *
 * They are two MODULES, not two exports of one, because esbuild splits chunks
 * by module: a module used by an eager and a lazy consumer lands in a chunk
 * the eager side loads, carrying every export either side uses (R7). The
 * table imports the provider consts, so a provider's record and its
 * `PROVIDER_BRAND_ART` entry stay one object.
 */

const quote = (value) => JSON.stringify(value);
const constName = (slug) =>
  `PROVIDER_ART_${slug.replaceAll('-', '_').toUpperCase()}`;

export const isProvider = (outcome) =>
  outcome.plan.icon.groups.includes('provider');
export const providerField = (outcome) =>
  outcome.record.mono ? 'mono' : 'art';

function artworkLiteral(artwork) {
  const paths = artwork.paths.map((path) => {
    const parts = [
      `d: ${quote(path.d)}`,
      `fill: ${path.fill === null ? 'null' : quote(path.fill)}`,
    ];
    if (path.fillRule) parts.push(`fillRule: 'evenodd'`);
    if (path.opacity !== undefined) parts.push(`opacity: ${path.opacity}`);
    return `{ ${parts.join(', ')} }`;
  });
  return `{ kind: 'fill', paths: [${paths.join(', ')}], viewBox: ${quote(artwork.viewBox)} }`;
}

function recordLiteral(outcome) {
  const { art, mono, onDark, surface } = outcome.record;
  // The provider subset's artwork is a shared const, so PROVIDER_BRAND_ART and
  // BRAND_MARKS reference one object and tree-shake independently.
  const field = (name, artwork) =>
    `${name}: ${isProvider(outcome) && providerField(outcome) === name ? constName(outcome.slug) : artworkLiteral(artwork)}`;
  const parts = [field('art', art)];
  if (mono) parts.push(field('mono', mono));
  if (onDark) parts.push(`onDark: ${artworkLiteral(onDark)}`);
  parts.push(`surface: ${quote(surface)}`);
  return `${quote(outcome.slug)}: { ${parts.join(', ')} },`;
}

function headerLines({
  source,
  licenseText,
  vendored,
  indexPath,
  noticesPath,
  maxLinesDirective,
}) {
  const indentedLicense = licenseText
    .trim()
    .split(/\r?\n/)
    .map((line) => ` *   ${line}`.trimEnd());
  return [
    ...(maxLinesDirective
      ? [
          '/* eslint-disable max-lines -- vendored data table; regenerate it, never edit it */',
        ]
      : []),
    '/**',
    ' * VENDORED by `scripts/vendor-brand-icons.mjs` from `scripts/brand-icons.manifest.json`.',
    ' * Do not edit by hand: run `npm run vendor:brand-icons` and commit the result.',
    ' *',
    ` * Source: theSVG (https://github.com/${source.repository}) at commit`,
    ` * ${source.commit}, pinned ${source.pinnedOn}.`,
    ` * https://github.com/${source.repository}/tree/${source.commit}/public/icons`,
    ' *',
    ' * SHIPPED NOTICES: production minification strips this comment, so the',
    ' * licence and attribution notices users receive live in a plain-text file',
    ` * generated beside this one: \`${noticesPath}\`.`,
    ' * It is copied to the root of the VS Code package and to `resources/` of the',
    ' * desktop app. Keep it in sync by regenerating, never by hand.',
    ' *',
    ' * Each SVG was normalised with svgo (preset-default, shapes to paths, styles to',
    ' * attributes, transforms applied, precision 2) and reduced to path data. The',
    ' * marks are TypeScript on purpose: the VS Code Marketplace scanner rejects AI',
    ' * vendor names in non-JS files by path and by content, so no `.svg` file is',
    ' * vendored anywhere.',
    ' *',
    ' * Trademark notice: every mark below is a trademark of its respective owner.',
    ' * Ptah shows a mark only to identify the product or service it names (nominative',
    ' * use). No endorsement by, or affiliation with, any owner is implied.',
    ' *',
    ' * The SVG code comes from theSVG under the following licence (verbatim):',
    ' *',
    ...indentedLicense,
    ' *',
    ` * Per-icon licence as declared by theSVG's index (${indexPath}):`,
    ...vendored.map((o) => ` *   ${o.slug}: ${o.plan.licence}`),
    ' */',
  ];
}

/**
 * The unformatted brand-table module text. `providerModule` is the import
 * specifier of the provider module (`./provider-brand-art.vendored`).
 */
export function renderModule({
  source,
  licenseText,
  outcomes,
  indexPath,
  noticesPath,
  providerModule,
}) {
  const vendored = outcomes.filter((o) => o.record);
  const providers = vendored.filter(isProvider);
  const monograms = outcomes.filter((o) => !o.record).map((o) => o.slug);
  const providerImport =
    providers.length === 0
      ? []
      : [
          `import { ${providers.map((o) => constName(o.slug)).join(', ')} } from '${providerModule}';`,
        ];
  return [
    ...headerLines({
      source,
      licenseText,
      vendored,
      indexPath,
      noticesPath,
      maxLinesDirective: true,
    }),
    '',
    "import type { MarkArtwork } from './mark-artwork';",
    ...providerImport,
    '',
    '/** `light`: every fill is below 3:1 on the dark base-200 (#1a1a20), so the mark needs a white tile. */',
    "export type BrandMarkSurface = 'light' | 'any';",
    '',
    '/**',
    ' * One vendored brand. `onDark` exists when theSVG ships a dark-theme variant;',
    ' * `mono` exists when the manifest asks for it (painted in `currentColor`).',
    ' */',
    'export interface BrandMarkRecord {',
    '  readonly art: MarkArtwork;',
    '  readonly mono?: MarkArtwork;',
    '  readonly onDark?: MarkArtwork;',
    '  readonly surface: BrandMarkSurface;',
    '}',
    '',
    '/** Every vendored brand mark, keyed by brand slug. Reference it only from lazily loaded code. */',
    'export const BRAND_MARKS: Readonly<Record<string, BrandMarkRecord>> = {',
    ...vendored.map(recordLiteral),
    '};',
    '',
    '/** Slugs rendered as a monogram: theSVG has no entry, or every usable variant was rejected. */',
    `export const MONOGRAM_SLUGS: readonly string[] = [${monograms.map(quote).join(', ')}];`,
    '',
  ].join('\n');
}

/** The unformatted provider-subset module text. */
export function renderProviderArtModule({
  source,
  licenseText,
  outcomes,
  indexPath,
  noticesPath,
}) {
  const providers = outcomes.filter((o) => o.record && isProvider(o));
  return [
    ...headerLines({
      source,
      licenseText,
      vendored: providers,
      indexPath,
      noticesPath,
      maxLinesDirective: false,
    }),
    '',
    "import type { MarkArtwork } from './mark-artwork';",
    '',
    ...providers.map(
      (o) =>
        `export const ${constName(o.slug)}: MarkArtwork = ${artworkLiteral(o.record[providerField(o)])};\n`,
    ),
    '/**',
    ' * The `mono` (else `art`) artwork of the provider brands only. The eager',
    ' * `ProviderMarkComponent` imports this module and never the brand table: a',
    ' * separate module is what keeps `BRAND_MARKS` in the lazy chunk (R7; `ui` is',
    ' * `sideEffects: false`).',
    ' */',
    'export const PROVIDER_BRAND_ART: Readonly<Record<string, MarkArtwork>> = {',
    ...providers.map((o) => `${quote(o.slug)}: ${constName(o.slug)},`),
    '};',
    '',
  ].join('\n');
}
