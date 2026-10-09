/** Parsed, zod-free representation of a `ptah-ui` fence body. */
export interface PtahUiDocument {
  readonly title?: string;
  /** Depth-0 items in body order; containers carry their children. */
  readonly elements: readonly PtahUiNode[];
}

/** One `item(d)` of the grammar: a layout container or an element. */
export type PtahUiNode = PtahUiContainerElement | PtahUiElement;

/** The `element(d)` productions: 610 elements plus the single-line atoms. */
export type PtahUiElement =
  | PtahUiStatsElement
  | PtahUiLiteralTableElement
  | PtahUiSourceTableElement
  | PtahUiLiteralListElement
  | PtahUiSourceListElement
  | PtahUiChartElement
  | PtahUiNoteElement
  | PtahUiProgressElement
  | PtahUiBadgeElement
  | PtahUiAvatarElement;

/** The `container(d)` productions. Every container has at least one child. */
export type PtahUiContainerElement =
  | PtahUiStackElement
  | PtahUiGridElement
  | PtahUiCardElement
  | PtahUiTitledContainerElement;

/** Source scope: `session` is valid only after `$agents` (R5.11). */
export type PtahUiSourceScope = 'session';

export interface PtahUiScalar {
  readonly source: PtahUiSourceName;
  readonly field: string;
  readonly scope?: PtahUiSourceScope;
}

export type PtahUiValue = string | PtahUiScalar;

/** A statline trend; `amount` is a magnitude and `direction` its sign. */
export interface PtahUiTrend {
  readonly direction: 'up' | 'down';
  readonly amount: number;
  readonly percent: boolean;
  readonly polarity?: 'good' | 'bad';
}

export interface PtahUiStatItem {
  readonly label: string;
  readonly value: PtahUiValue;
  readonly trend?: PtahUiTrend;
  /** At least two points when present. */
  readonly spark?: readonly number[];
}

export interface PtahUiStatsElement {
  readonly kind: 'stats';
  readonly items: readonly PtahUiStatItem[];
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
  readonly scope?: PtahUiSourceScope;
}

export interface PtahUiLiteralListElement {
  readonly kind: 'list';
  readonly items: readonly string[];
}

export interface PtahUiSourceListElement {
  readonly kind: 'list';
  readonly source: PtahUiSourceName;
  readonly scope?: PtahUiSourceScope;
}

export interface PtahUiChartElement {
  readonly kind: 'chart';
  readonly chart: 'line' | 'bar';
  readonly title: string;
  readonly points: readonly {
    readonly label: string;
    readonly value: number;
  }[];
}

/** `ntone` of the grammar. */
export type PtahUiNoteTone = 'info' | 'ok' | 'warn' | 'error';
/** `tone` of the grammar. */
export type PtahUiTone = 'neutral' | PtahUiNoteTone;

export interface PtahUiNoteElement {
  readonly kind: 'note';
  readonly tone: PtahUiNoteTone;
  readonly text: string;
}

export interface PtahUiProgressElement {
  readonly kind: 'progress';
  readonly label: string;
  /** 0 to 100 inclusive. */
  readonly value: number;
  readonly tone?: PtahUiTone;
}

export interface PtahUiBadgeElement {
  readonly kind: 'badge';
  readonly tone: PtahUiTone;
  readonly text: string;
}

export interface PtahUiAvatarElement {
  readonly kind: 'avatar';
  readonly name: string;
  readonly subtitle?: string;
}

/** `row` (horizontal) and `col` (vertical). */
export interface PtahUiStackElement {
  readonly kind: 'row' | 'col';
  readonly children: readonly PtahUiNode[];
}

export interface PtahUiGridElement {
  readonly kind: 'grid';
  /** 1 to `SURFACE_LIMITS.maxGridColumns`. */
  readonly columns: number;
  readonly children: readonly PtahUiNode[];
}

export interface PtahUiCardElement {
  readonly kind: 'card';
  readonly title?: string;
  readonly children: readonly PtahUiNode[];
}

/** `section` and `accordion` (collapsed by default); both require a title. */
export interface PtahUiTitledContainerElement {
  readonly kind: 'section' | 'accordion';
  readonly title: string;
  readonly children: readonly PtahUiNode[];
}

export type PtahUiSourceName = 'diff' | 'tests' | 'usage' | 'agents' | 'limits';

export interface PtahUiSourceDefinition {
  readonly scalars: readonly string[];
  readonly columns: readonly string[];
}

export type PtahUiParseFailureCode =
  | 'too-large'
  | 'too-many-lines'
  | 'syntax'
  | 'unknown-source'
  /** Odd indentation or a depth jump; the message names the expected depth. */
  | 'depth'
  /** A display id an agent block may not name (R2.5, D11). */
  | 'reserved-id'
  /** A catalog budget exceeded; the message names the limit. */
  | 'limit';

export interface PtahUiParseFailure {
  readonly code: PtahUiParseFailureCode;
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
      /**
       * `display` on `ptah-ui display [id]` fences (the panel target). A plain
       * `ptah-ui` fence omits it and renders inline, so 610 segments keep their
       * exact shape.
       */
      readonly target?: 'display';
      /** The `<id>` of `ptah-ui display <id>`; absent when no id was given. */
      readonly displayId?: string;
    };
