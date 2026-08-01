import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Lowercase slug: 2–64 chars of [a-z0-9-]. Matches the frontend PACK_SLUG_REGEX. */
const PACK_SLUG_REGEX = /^[a-z0-9-]{2,64}$/;

/** Cohort label: the same lowercase slug shape as `MemberGroup.key`. */
const COHORT_KEY_REGEX = /^[a-z0-9-]{2,40}$/;

/**
 * A pack's repository URL must be an `https://github.com/<owner>/<repo>` URL.
 *
 * SECURITY (leak risk L4): this value is rendered as `<a [href]>` in the admin
 * console, so an unconstrained string is a stored-XSS vector (`javascript:` URI)
 * against a high-value target. The server is the boundary — Angular's
 * DomSanitizer is only defence in depth.
 */
const GITHUB_REPO_URL_REGEX =
  /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/?$/;

const GITHUB_URL_MESSAGE =
  'repoUrl must be an https://github.com/<owner>/<repo> URL';

/**
 * Query DTO for GET /api/v1/admin/packs.
 *
 * `search` is matched against a FIXED set of columns (title, slug) inside the
 * service — it is never a caller-supplied field NAME, so the `assertAllowedField`
 * allowlist discipline is satisfied by construction.
 */
export class ListPacksQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  cohortKey?: string;
}

/**
 * Body DTO for POST /api/v1/admin/packs.
 *
 * `cohortKey` is a BOOKKEEPING LABEL ONLY — it gates nothing (see the Pack model
 * docblock in schema.prisma). Omit it (or send null) for an unlabelled pack.
 */
export class CreatePackDto {
  @IsString()
  @Matches(PACK_SLUG_REGEX, {
    message: 'slug must be a lowercase slug (2-64 chars of a-z, 0-9, -)',
  })
  slug!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description!: string;

  @IsString()
  @MaxLength(300)
  @Matches(GITHUB_REPO_URL_REGEX, { message: GITHUB_URL_MESSAGE })
  repoUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  @Matches(COHORT_KEY_REGEX, {
    message: 'cohortKey must be a lowercase slug (2-40 chars of a-z, 0-9, -)',
  })
  cohortKey?: string | null;
}

/**
 * Body DTO for PATCH /api/v1/admin/packs/:id.
 *
 * All fields optional. `notes` and `cohortKey` accept `null` to clear the stored
 * value (`@IsOptional()` skips validation for null while keeping the key
 * present, so the service can distinguish "clear it" from "not supplied").
 */
export class UpdatePackDto {
  @IsOptional()
  @IsString()
  @Matches(PACK_SLUG_REGEX, {
    message: 'slug must be a lowercase slug (2-64 chars of a-z, 0-9, -)',
  })
  slug?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Matches(GITHUB_REPO_URL_REGEX, { message: GITHUB_URL_MESSAGE })
  repoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  @Matches(COHORT_KEY_REGEX, {
    message: 'cohortKey must be a lowercase slug (2-40 chars of a-z, 0-9, -)',
  })
  cohortKey?: string | null;
}
