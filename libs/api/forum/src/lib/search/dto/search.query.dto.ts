import {
  DEFAULT_PAGE_SIZE,
  FIRST_PAGE,
  MAX_PAGE_SIZE,
  SEARCH_KINDS,
  type SearchKind,
} from '@ptah-contracts/community';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { IsOptionalNotNull } from '../../common/optional-field';

/**
 * `GET /api/v1/members/search` — R1.7.1, R1.7.3, NFR-P5, NFR-S1, plan §3.3.
 *
 * ⚠️ ONE WHOLE-OBJECT `@Query()` DTO, BOUND WITH `dtoPipe(SearchQueryDto)`
 * (PRE-1, RISK-I). This is the endpoint most likely to be written as
 * `@Query('q') q: string`, and doing so fails the build: `NAMED_PRIMITIVE_PARAM_COUNT
 * = 6` in `controller-validation.spec.ts` is an EXACT-EQUALITY assertion, not a
 * floor. It would also be the one place in this batch where free-form member
 * text reached a service completely unvalidated.
 *
 * ⚠️ `q` IS THE ONLY FREE-FORM MEMBER TEXT THAT REACHES A QUERY IN THIS LIB, AND
 * ITS SAFETY IS NOT ESTABLISHED HERE. The length bounds below stop an
 * unbounded `ILIKE` scan; they do NOT make `q` safe to concatenate into SQL.
 * `SearchService` parameterises it through `Prisma.sql` and additionally escapes
 * the `LIKE` metacharacters — see that file. A validator that tried to
 * "sanitize" `q` by stripping quotes would be security theatre AND a functional
 * bug: an apostrophe is a legitimate thing to search for.
 */
export class SearchQueryDto {
  /**
   * 2–200 characters (§3.3). Shorter than 2 is a `400`, not an empty result.
   *
   * The floor is a cost control, not a validation nicety: `ILIKE '%a%'` cannot
   * use the trigram index (a GIN trigram index needs at least three characters
   * to form a trigram) and degrades to a sequential scan of every post body in
   * the forum. Two characters is the boundary R1.7.3 sets; below it the request
   * is refused rather than served slowly.
   */
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  q!: string;

  /**
   * A comma-joined subset of `topics,posts,lessons`. Omitted searches all three.
   *
   * ⚠️ SPLIT IN A `@Transform`, BECAUSE A QUERY PARAMETER IS A STRING. Express
   * gives `?kinds=topics,posts` as the single string `'topics,posts'`, so
   * `@IsIn(..., { each: true })` would run against a string's characters
   * without this. Express ALSO gives `?kinds=topics&kinds=posts` as a real
   * array, so both forms are normalised here and the rest of the stack sees one
   * shape.
   *
   * An unknown kind is a `400` rather than being ignored: silently dropping
   * `?kinds=lesson` (singular) would return topic and post results the caller
   * did not ask for and no error to explain why.
   */
  @IsOptionalNotNull()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((kind) => kind.trim())
        .filter((kind) => kind.length > 0);
    }
    return value;
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(SEARCH_KINDS.length)
  @IsIn(SEARCH_KINDS, {
    each: true,
    message: `kinds must be a comma-separated subset of: ${SEARCH_KINDS.join(', ')}`,
  })
  kinds?: SearchKind[];

  /** 1-BASED, per NFR-P5. Applied independently to each result group. */
  @IsOptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(FIRST_PAGE)
  page?: number;

  /** Default 25, hard maximum 50 — `> 50` is a `400` (NFR-P5). */
  @IsOptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number;
}

/**
 * Defaults resolved ONCE, outside the DTO — see `ListTopicsQueryDto` for why
 * class-field initialisers are avoided.
 *
 * An omitted `kinds` becomes ALL THREE rather than an empty set, so "search
 * everything" is the default and `?kinds=` never means "search nothing".
 */
export function resolveSearchQuery(query: SearchQueryDto): {
  q: string;
  kinds: ReadonlySet<SearchKind>;
  page: number;
  pageSize: number;
} {
  return {
    q: query.q.trim(),
    kinds: new Set(query.kinds ?? SEARCH_KINDS),
    page: query.page ?? FIRST_PAGE,
    pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
  };
}
