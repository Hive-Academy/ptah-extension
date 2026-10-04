/** Parsed, zod-free representation of a `ptah-ui` fence body. */
export interface PtahUiDocument {
  readonly title?: string;
  readonly elements: readonly PtahUiElement[];
}

export type PtahUiElement =
  | PtahUiStatsElement
  | PtahUiLiteralTableElement
  | PtahUiSourceTableElement
  | PtahUiLiteralListElement
  | PtahUiSourceListElement
  | PtahUiChartElement;

export interface PtahUiScalar {
  readonly source: PtahUiSourceName;
  readonly field: string;
}

export type PtahUiValue = string | PtahUiScalar;

export interface PtahUiStatsElement {
  readonly kind: 'stats';
  readonly items: readonly { readonly label: string; readonly value: PtahUiValue }[];
}

export interface PtahUiLiteralTableElement {
  readonly kind: 'table';
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface PtahUiSourceTableElement {
  readonly kind: 'table';
  readonly source: PtahUiSourceName;
  readonly columns?: readonly string[];
}

export interface PtahUiLiteralListElement {
  readonly kind: 'list';
  readonly items: readonly string[];
}

export interface PtahUiSourceListElement {
  readonly kind: 'list';
  readonly source: PtahUiSourceName;
}

export interface PtahUiChartElement {
  readonly kind: 'chart';
  readonly chart: 'line' | 'bar';
  readonly title: string;
  readonly points: readonly { readonly label: string; readonly value: number }[];
}

export type PtahUiSourceName = 'diff' | 'tests' | 'usage';

export interface PtahUiSourceDefinition {
  readonly scalars: readonly string[];
  readonly columns: readonly string[];
}

export interface PtahUiParseFailure {
  readonly code: 'too-large' | 'too-many-lines' | 'syntax' | 'unknown-source';
  readonly message: string;
  readonly line?: number;
}

export type PtahUiParseResult =
  | { readonly ok: true; readonly doc: PtahUiDocument }
  | { readonly ok: false; readonly failure: PtahUiParseFailure };

export type PtahUiSegment =
  | { readonly kind: 'markdown'; readonly key: string; readonly text: string }
  | {
      readonly kind: 'fence';
      readonly key: string;
      readonly ordinal: number;
      readonly raw: string;
      readonly body: string;
    };
