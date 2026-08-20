// `class-transformer`/`class-validator` decorators on the DTO evaluate at
// import time and need the metadata shim — the `issue-complimentary-license.dto.spec.ts`
// idiom. It is imported first, before anything that reaches a DTO.
import 'reflect-metadata';

import { Prisma } from '@ptah-api/core';
import type { MemberContext } from '@ptah-api/membership';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  asPrismaService,
  countQueries,
  createMockPrisma,
  type MockForumPrisma,
} from '../../testing/mock-forum-prisma';

import { SearchQueryDto } from './dto/search.query.dto';
import {
  buildExcerpt,
  buildPostCountSql,
  buildPostSearchSql,
  buildTopicCountSql,
  buildTopicSearchSql,
  SearchService,
  toLikePattern,
} from './search.service';

/**
 * `SearchService` — R1.7, A-7, NFR-S1.
 *
 * ⚠️ THE CENTRAL ASSERTIONS HERE RUN AGAINST THE GENERATED SQL, NOT AGAINST THE
 * SOURCE. `Prisma.sql` produces a `Sql` object carrying `.text` (with `$1`
 * placeholders) and `.values` (the bound parameters) — so "is `q`
 * parameterised?" is answerable by checking that the member's search term
 * appears in `.values` and does NOT appear anywhere in `.text`. Reading the
 * source and observing that it uses a tagged template proves nothing about what
 * the driver receives; this does.
 *
 * The same technique carries the two properties `soft-delete-filter.spec.ts`
 * structurally CANNOT check, because it parses Prisma call expressions and this
 * file emits SQL text: the `deleted_at IS NULL` predicates, and the category
 * visibility clause.
 */

const CTX: MemberContext = {
  userId: 'user-1',
  email: 'member@example.com',
  entitled: true,
  cohortKeys: [],
  isAdmin: false,
};

function query(overrides: Partial<SearchQueryDto> = {}): SearchQueryDto {
  return Object.assign(new SearchQueryDto(), { q: 'ptah' }, overrides);
}

function build(prisma: MockForumPrisma): SearchService {
  return new SearchService(asPrismaService(prisma));
}

/** Every `Sql` this file produces, so the invariants below run over all of them. */
const ALL_BUILDERS = [
  [
    'topic page',
    () => buildTopicSearchSql(toLikePattern('ptah'), ['cat-1', 'cat-2'], 0, 25),
  ],
  [
    'topic count',
    () => buildTopicCountSql(toLikePattern('ptah'), ['cat-1', 'cat-2']),
  ],
  [
    'post page',
    () => buildPostSearchSql(toLikePattern('ptah'), ['cat-1', 'cat-2'], 0, 25),
  ],
  [
    'post count',
    () => buildPostCountSql(toLikePattern('ptah'), ['cat-1', 'cat-2']),
  ],
] as const satisfies readonly (readonly [string, () => Prisma.Sql])[];

describe('SearchService', () => {
  let prisma: MockForumPrisma;
  let service: SearchService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = build(prisma);
    prisma.category.findMany.mockResolvedValue([{ id: 'cat-1' }]);
    prisma.$queryRaw.mockResolvedValue([]);
  });

  /* ---------------------------------------------------------------------- */
  /* NFR-S1 — parameterisation, asserted against the generated SQL           */
  /* ---------------------------------------------------------------------- */

  describe('NFR-S1 — the query is parameterised', () => {
    it.each(ALL_BUILDERS)(
      '%s: binds the search term as a PARAMETER and never puts it in the SQL text',
      (_label, make) => {
        const sql = make();

        // The pattern travels in `values`…
        expect(sql.values).toContain('%ptah%');
        // …and the SQL text carries a placeholder, not the term.
        expect(sql.text).not.toContain('ptah');
        expect(sql.text).toMatch(/ILIKE \$\d+/);
      },
    );

    it.each(ALL_BUILDERS)(
      '%s: binds the category ids as parameters, one placeholder each',
      (_label, make) => {
        const sql = make();

        expect(sql.values).toContain('cat-1');
        expect(sql.values).toContain('cat-2');
        expect(sql.text).not.toContain('cat-1');
        // `Prisma.join` emits `IN ($n,$m)`, never a comma-joined literal.
        expect(sql.text).toMatch(/IN \(\$\d+,\$\d+\)/);
      },
    );

    it('a term containing SQL metacharacters cannot break out of the parameter', () => {
      // The canonical injection attempt. If it were concatenated, `.text` would
      // contain `DROP TABLE`; parameterised, the whole string is one value.
      const hostile = `'; DROP TABLE community_posts; --`;
      const sql = buildPostSearchSql(toLikePattern(hostile), ['cat-1'], 0, 25);

      expect(sql.text).not.toContain('DROP TABLE');
      expect(sql.text.toLowerCase()).not.toContain('drop');

      // It survives as ONE bound value — with its `_` LIKE-escaped, which is
      // the second, independent defence: the whole string is data to the
      // driver AND a literal to the pattern matcher.
      expect(sql.values).toContain(`%'; DROP TABLE community\\_posts; --%`);
      expect(
        sql.values.filter((value) => String(value).includes('DROP')),
      ).toHaveLength(1);
    });

    it('escapes LIKE metacharacters so a wildcard search cannot force a full scan', () => {
      // Parameterisation alone does NOT do this: `%` and `_` are pattern
      // syntax, not SQL syntax. `_` unescaped matches every single character.
      expect(toLikePattern('100%')).toBe('%100\\%%');
      expect(toLikePattern('a_b')).toBe('%a\\_b%');
      // The backslash itself is escaped FIRST, or the two rules above corrupt it.
      expect(toLikePattern('c:\\dir')).toBe('%c:\\\\dir%');
    });

    it.each(ALL_BUILDERS)(
      '%s: declares the ESCAPE character',
      (_label, make) => {
        // Without `ESCAPE`, the backslashes `toLikePattern` inserts are literal
        // characters and the escaping above silently does nothing.
        expect(make().text).toMatch(/ESCAPE \$\d+/);
      },
    );
  });

  /* ---------------------------------------------------------------------- */
  /* R1.7.2 — visibility and AD-5, in the SQL                                */
  /* ---------------------------------------------------------------------- */

  describe('R1.7.2 — visibility is a WHERE clause in the query', () => {
    it.each(ALL_BUILDERS)('%s: restricts on category_id', (_label, make) => {
      expect(make().text).toContain('t.category_id IN');
    });

    it.each(ALL_BUILDERS)(
      '%s: filters soft-deleted rows in the SQL (AD-5, which the structural spec cannot see here)',
      (_label, make) => {
        expect(make().text).toContain('t.deleted_at IS NULL');
      },
    );

    it('the post queries additionally exclude tombstones themselves', () => {
      // A tombstone has no body on the wire (R1.3.5) — matching one would
      // return an excerpt of text the member may not read.
      expect(buildPostSearchSql('%x%', ['c'], 0, 10).text).toContain(
        'p.deleted_at IS NULL',
      );
      expect(buildPostCountSql('%x%', ['c']).text).toContain(
        'p.deleted_at IS NULL',
      );
    });

    it('a member who can see no category matches nothing, without querying', async () => {
      prisma.category.findMany.mockResolvedValue([]);

      const results = await service.search(CTX, query());

      expect(results.topics.items).toEqual([]);
      expect(results.topics.total).toBe(0);
      expect(results.posts.total).toBe(0);
      // Short-circuited: no `IN ()`, which is a Postgres syntax error.
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(countQueries(prisma)).toBe(1);
    });

    it('the visible category ids reach the SQL the client actually received', async () => {
      prisma.category.findMany.mockResolvedValue([{ id: 'visible-1' }]);

      await service.search(CTX, query({ kinds: ['topics'] }));

      const sent = prisma.$queryRaw.mock.calls[0]?.[0] as Prisma.Sql;
      expect(sent.values).toContain('visible-1');
      // The one category the member cannot see never reaches the query.
      expect(sent.values).not.toContain('invisible-1');
    });

    it('asks the shared visibility builder — it does not re-derive visibility', async () => {
      const admin: MemberContext = {
        ...CTX,
        isAdmin: true,
        cohortKeys: ['founding'],
      };

      await service.search(admin, query());

      // The `OR` shape is `buildCategoryVisibilityWhere`'s, not a local copy:
      // three branches for an admin holding a cohort key.
      const where = prisma.category.findMany.mock.calls[0]?.[0]?.where;
      expect(where.OR).toHaveLength(3);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* R1.7.1 — result grouping and kinds                                      */
  /* ---------------------------------------------------------------------- */

  describe('R1.7.1 — grouped results', () => {
    it('kinds=lessons returns an EMPTY page, not a 400', async () => {
      const results = await service.search(CTX, query({ kinds: ['lessons'] }));

      expect(results.lessons).toEqual({
        items: [],
        page: 1,
        pageSize: 25,
        total: 0,
        hasMore: false,
      });
      // The shape is declared now so Batch 9 changes VALUES, not SHAPE.
      expect(results.topics.items).toEqual([]);
      expect(results.posts.items).toEqual([]);
      // Neither live kind was asked for, so neither was queried.
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('all three groups are always present, even when one kind was requested', async () => {
      const results = await service.search(CTX, query({ kinds: ['topics'] }));

      expect(Object.keys(results).sort()).toEqual([
        'lessons',
        'posts',
        'topics',
      ]);
      expect(results.posts.total).toBe(0);
      expect(results.lessons.total).toBe(0);
    });

    it('omitting kinds searches topics and posts — four raw queries, five in total', async () => {
      await service.search(CTX, query());

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(4);
      expect(countQueries(prisma)).toBe(5);
    });

    it('maps a topic hit, coercing the bigint count() Postgres returns', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([
          {
            id: 't1',
            slug: 'ptah-rocks',
            title: 'Why ptah rocks',
            post_count: 4,
            last_posted_at: new Date('2026-08-01T10:00:00.000Z'),
            category_name: 'General',
            first_name: 'Ada',
            last_name: 'Lovelace',
          },
        ])
        // `count(*)` is a bigint. Passed through, `JSON.stringify` would THROW
        // at serialisation time and turn a working search into a 500.
        .mockResolvedValueOnce([{ total: 1n }]);

      const results = await service.search(CTX, query({ kinds: ['topics'] }));

      expect(results.topics.total).toBe(1);
      expect(typeof results.topics.total).toBe('number');
      expect(results.topics.items[0]).toMatchObject({
        id: 't1',
        slug: 'ptah-rocks',
        categoryName: 'General',
        authorName: 'Ada Lovelace',
        replyCount: 4,
        lastPostedAt: '2026-08-01T10:00:00.000Z',
      });
      expect(() => JSON.stringify(results)).not.toThrow();
    });

    it('a hit whose author is null (migrated content, A-4) reports authorName null', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([
          {
            id: 't1',
            slug: 's',
            title: 'ptah',
            post_count: 0,
            last_posted_at: new Date('2026-08-01T10:00:00.000Z'),
            category_name: 'General',
            first_name: null,
            last_name: null,
          },
        ])
        .mockResolvedValueOnce([{ total: 1 }]);

      const results = await service.search(CTX, query({ kinds: ['topics'] }));

      expect(results.topics.items[0]?.authorName).toBeNull();
    });
  });

  /* ---------------------------------------------------------------------- */
  /* R1.7.5 — excerpts are plain text plus offsets                           */
  /* ---------------------------------------------------------------------- */

  describe('R1.7.5 — excerpts carry offsets and NEVER HTML', () => {
    it('returns plain text and offsets, with no markup of any kind', () => {
      const excerpt = buildExcerpt('The ptah runtime is fast', 'ptah');

      expect(excerpt.text).toBe('The ptah runtime is fast');
      expect(excerpt.text).not.toContain('<');
      expect(excerpt.matches).toEqual([{ start: 4, length: 4 }]);
    });

    it('the offsets index the RETURNED text, not the source body', () => {
      // A long prefix forces a window; an offset into the source would
      // highlight the wrong characters — or characters that are not there.
      const source = `${'x'.repeat(300)}ptah tail`;
      const excerpt = buildExcerpt(source, 'ptah');
      const match = excerpt.matches[0];

      expect(match).toBeDefined();
      expect(
        excerpt.text.slice(match!.start, match!.start + match!.length),
      ).toBe('ptah');
    });

    it('matches case-insensitively, like the ILIKE that produced the hit', () => {
      const excerpt = buildExcerpt('PTAH and Ptah', 'ptah');

      expect(excerpt.matches).toHaveLength(2);
      expect(excerpt.text.slice(0, 4)).toBe('PTAH');
    });

    it('never emits highlight markup even when the body CONTAINS markup', () => {
      // The body is member-authored markdown. The server must not be able to
      // produce a string a client would be tempted to bind as HTML.
      const excerpt = buildExcerpt('<script>alert(1)</script> ptah', 'ptah');

      expect(excerpt.text).toContain('<script>');
      expect(excerpt.text).not.toContain('<mark>');
      // The body's own markup is returned VERBATIM as text, not escaped and not
      // stripped — sanitisation belongs to the one client-side chokepoint.
      expect(JSON.stringify(excerpt)).not.toContain('mark>');
    });

    it('returns [] matches rather than failing when the field does not contain the term', () => {
      // A post can match on a different field than the one excerpted.
      const excerpt = buildExcerpt('nothing relevant here', 'ptah');

      expect(excerpt.matches).toEqual([]);
      expect(excerpt.text).toBe('nothing relevant here');
    });

    it('drops a match that straddles the window edge rather than clipping it', () => {
      const source = `ptah${'y'.repeat(400)}ptah`;
      const excerpt = buildExcerpt(source, 'ptah');

      for (const match of excerpt.matches) {
        expect(match.start).toBeGreaterThanOrEqual(0);
        expect(match.start + match.length).toBeLessThanOrEqual(
          excerpt.text.length,
        );
        expect(
          excerpt.text
            .slice(match.start, match.start + match.length)
            .toLowerCase(),
        ).toBe('ptah');
      }
    });
  });

  /* ---------------------------------------------------------------------- */
  /* NFR-P5 — paging                                                         */
  /* ---------------------------------------------------------------------- */

  describe('NFR-P5 — paging', () => {
    it('binds LIMIT and OFFSET as parameters derived from the 1-based page', () => {
      const sql = buildTopicSearchSql('%x%', ['c'], 50, 25);

      expect(sql.text).toMatch(/LIMIT \$\d+ OFFSET \$\d+/);
      expect(sql.values).toContain(25);
      expect(sql.values).toContain(50);
    });

    it('page 3 at pageSize 10 skips 20 rows', async () => {
      await service.search(
        CTX,
        query({ kinds: ['topics'], page: 3, pageSize: 10 }),
      );

      const sent = prisma.$queryRaw.mock.calls[0]?.[0] as Prisma.Sql;
      expect(sent.values).toContain(20);
      expect(sent.values).toContain(10);
    });

    it('echoes the EFFECTIVE paging values, so an omitted pageSize is discoverable', async () => {
      const results = await service.search(CTX, query());

      expect(results.topics.page).toBe(1);
      expect(results.topics.pageSize).toBe(25);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* The DTO — the gate that runs BEFORE the service is entered              */
  /* ---------------------------------------------------------------------- */

  describe('SearchQueryDto', () => {
    const invalidProps = async (payload: Record<string, unknown>) => {
      const dto = plainToInstance(SearchQueryDto, payload);
      return (await validate(dto)).map((error) => error.property);
    };

    it('rejects q shorter than 2 characters — a 400, not an empty result', async () => {
      // Below two characters an ILIKE cannot use the trigram index and degrades
      // to a sequential scan of every post body (R1.7.3).
      expect(await invalidProps({ q: 'a' })).toEqual(['q']);
    });

    it('rejects q longer than 200 characters', async () => {
      expect(await invalidProps({ q: 'x'.repeat(201) })).toEqual(['q']);
    });

    it('rejects pageSize above the 50 hard cap (NFR-P5) rather than clamping it', async () => {
      expect(await invalidProps({ q: 'ptah', pageSize: 51 })).toEqual([
        'pageSize',
      ]);
      expect(await invalidProps({ q: 'ptah', pageSize: 50 })).toEqual([]);
    });

    it('rejects page 0 — paging is 1-based', async () => {
      expect(await invalidProps({ q: 'ptah', page: 0 })).toEqual(['page']);
    });

    it('splits a comma-joined kinds parameter, because a query value is a string', async () => {
      const dto = plainToInstance(SearchQueryDto, {
        q: 'ptah',
        kinds: 'topics,posts',
      });

      expect(dto.kinds).toEqual(['topics', 'posts']);
      expect(await validate(dto)).toEqual([]);
    });

    it('rejects an unknown kind rather than silently ignoring it', async () => {
      expect(await invalidProps({ q: 'ptah', kinds: 'lesson' })).toEqual([
        'kinds',
      ]);
    });

    it('coerces numeric query strings, which is what @Type(() => Number) is for', async () => {
      const dto = plainToInstance(SearchQueryDto, {
        q: 'ptah',
        page: '2',
        pageSize: '10',
      });

      expect(dto.page).toBe(2);
      expect(dto.pageSize).toBe(10);
      expect(await validate(dto)).toEqual([]);
    });
  });
});
