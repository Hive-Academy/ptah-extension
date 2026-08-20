/**
 * OPTIONALITY, WITHOUT THE `null` HOLE — NFR-S7, TASK_2026_177 F-2.
 *
 * ⚠️ THIS IS A RE-EXPORT. The decorators now live once in `@ptah-api/core`
 * (`libs/api/core/src/lib/common/optional-field.ts`), beside `dtoPipe`. What was
 * three verbatim copies (this file, `learning`, `community/live-sessions`) was
 * collapsed to re-exports by TASK_2026_188 when the census that enforces them
 * had to cover libs those per-lib copies could never reach. This file is kept so
 * the local `../../common/optional-field` import paths in this lib's DTOs do not
 * churn; the canonical home, and its full docblock, is in core.
 */
export { IsOptionalNotNull, NullMeansAbsent } from '@ptah-api/core';
