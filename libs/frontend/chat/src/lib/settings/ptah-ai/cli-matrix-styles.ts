import type { CliMatrixStatus } from './cli-matrix-rows';

/** Tone → status dot. Colour sits on dots, badge borders and backgrounds; text stays `text-base-content` (deviation 6). */
export const CLI_MATRIX_DOT: Readonly<Record<CliMatrixStatus['tone'], string>> = {
  success: 'bg-success',
  neutral: 'bg-base-content-muted',
  warning: 'bg-warning',
  error: 'bg-error',
  info: 'bg-info',
};
export const CLI_MATRIX_FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';
/** A model or effort cell; each caller adds its own max width (a table column, or the full width of an instance card). */
export const CLI_MATRIX_CELL_BASE = `link link-hover inline-flex items-center gap-1 rounded px-1.5 py-1 text-left font-mono text-xs text-base-content no-underline hover:bg-base-200 disabled:cursor-not-allowed ${CLI_MATRIX_FOCUS}`;
/** An underlined text action (Tiers, Test, Credentials, Install, the delete confirm). */
export const CLI_MATRIX_ACTION = `btn btn-ghost btn-sm px-2 text-xs font-medium text-base-content underline underline-offset-2 ${CLI_MATRIX_FOCUS}`;
