import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import type { MemberPack } from '@ptah-contracts/community';

import {
  DEFAULT_ACCESS_NOTE,
  MemberPacksApiService,
  accessNoteFor,
} from './member-packs-api.service';

const PACKS = '/api/v1/members/packs';

/**
 * The exact body the live server returned for a cohort-labelled pack, captured
 * on `:3011` at commit `54650edee` against a member holding ZERO cohort
 * assignments. Copied rather than invented, so the fixture cannot drift into a
 * shape the endpoint never produces.
 */
function labelledPack(overrides: Partial<MemberPack> = {}): MemberPack {
  return {
    id: 'b15a_pack_labelled',
    slug: 'b15a-labelled',
    title: 'B15A Labelled Pack',
    description: 'Visible and cohort-labelled.',
    repoUrl: 'https://github.com/x/labelled',
    tags: ['agents', 'nx'],
    cohortName: 'Founding Members',
    accessNote: 'Invite lands within 24h of your GitHub handle being shared.',
    ...overrides,
  };
}

/** The live unlabelled pack — BOTH nullable fields actually null. */
function unlabelledPack(): MemberPack {
  return {
    id: 'b15a_pack_unlabelled',
    slug: 'b15a-unlabelled',
    title: 'B15A Unlabelled Pack',
    description: 'Visible with no cohort label.',
    repoUrl: 'https://github.com/x/unlabelled',
    tags: [],
    cohortName: null,
    accessNote: null,
  };
}

describe('MemberPacksApiService (R5.1, R5.3, NFR-S1, NFR-S5)', () => {
  let service: MemberPacksApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MemberPacksApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /* ---------------------------------------------------------------------- */
  /* The request                                                            */
  /* ---------------------------------------------------------------------- */

  describe('the request', () => {
    it('GETs the relative packs URL', async () => {
      const promise = firstValueFrom(service.list());
      const request = http.expectOne(PACKS);

      expect(request.request.method).toBe('GET');
      // Relative — `apiInterceptor` prepends the base and sets
      // `withCredentials`, so the `ptah_auth` cookie rides along. An absolute
      // URL here would bypass the interceptor and arrive unauthenticated.
      expect(request.request.url).toBe(PACKS);

      request.flush([]);
      await promise;
    });

    it('🔴 sends NO query parameters at all — not page, not pageSize', async () => {
      // The server returns a BARE ARRAY by contract and `MemberPacksController`
      // declares no `@Query()`. This assertion is the only thing standing
      // between us and a pagination parameter, because — measured live on
      // :3011 — `GET /v1/members/packs?page=1` answers `200`, NOT `400`.
      // `forbidNonWhitelisted` only bites where a DTO is bound and this
      // controller binds none, so a stray parameter would be silently ignored
      // and the client would believe it was paging something.
      const promise = firstValueFrom(service.list());
      const request = http.expectOne(PACKS);

      expect(request.request.params.keys()).toEqual([]);
      expect(request.request.urlWithParams).toBe(PACKS);

      request.flush([]);
      await promise;
    });

    it('issues exactly ONE request per call', async () => {
      const promise = firstValueFrom(service.list());
      http.expectOne(PACKS).flush([]);
      await promise;

      http.verify();
    });
  });

  /* ---------------------------------------------------------------------- */
  /* The boundary parse is LIVE, not decorative                              */
  /* ---------------------------------------------------------------------- */

  describe('the schema parse at the HTTP boundary', () => {
    it('the live two-pack body parses unchanged', async () => {
      const wire = [labelledPack(), unlabelledPack()];

      const promise = firstValueFrom(service.list());
      http.expectOne(PACKS).flush(wire);

      await expect(promise).resolves.toEqual(wire);
    });

    it('an empty array is a valid answer, not a parse failure', async () => {
      // "No packs are member-visible" is a legitimate server answer and the
      // page's empty cell depends on it arriving as data rather than as an
      // error. A schema that rejected `[]` would render the error cell for a
      // successful request.
      const promise = firstValueFrom(service.list());
      http.expectOne(PACKS).flush([]);

      await expect(promise).resolves.toEqual([]);
    });

    it('🔴 a body MISSING accessNote throws — the parse is live', async () => {
      // Without this case the schema could be `z.any()` and every other test
      // in this file would still pass. `accessNote` is the field chosen
      // because R5.5's whole "told in advance" requirement keys off it: a
      // response that silently lost it would render the page with the one
      // sentence R5.5 exists to guarantee simply absent.
      const wire: Record<string, unknown> = { ...labelledPack() };
      delete wire['accessNote'];

      const promise = firstValueFrom(service.list());
      http.expectOne(PACKS).flush([wire]);

      await expect(promise).rejects.toThrow(/GET \/members\/packs/);
      await expect(promise).rejects.toThrow(/accessNote/);
    });

    it('a body missing repoUrl throws — the second load-bearing field', async () => {
      const wire: Record<string, unknown> = { ...labelledPack() };
      delete wire['repoUrl'];

      const promise = firstValueFrom(service.list());
      http.expectOne(PACKS).flush([wire]);

      await expect(promise).rejects.toThrow(/repoUrl/);
    });

    it('an UNKNOWN extra field is STRIPPED rather than rejected', async () => {
      // RISK-C's asymmetry, in the tolerant direction. `z.object()` strips, so
      // a client schema may omit a field the server sends and may NEVER
      // declare one the server does not.
      const promise = firstValueFrom(service.list());
      http
        .expectOne(PACKS)
        .flush([{ ...labelledPack(), somethingNew: 'from a later server' }]);

      const [pack] = await promise;
      expect('somethingNew' in pack).toBe(false);
      expect(pack.title).toBe('B15A Labelled Pack');
    });
  });

  /* ---------------------------------------------------------------------- */
  /* NFR-S5 — `notes` cannot survive the boundary                            */
  /* ---------------------------------------------------------------------- */

  describe('🔴 NFR-S5 — the admin-only `notes` field, client half', () => {
    it('a body that DOES carry notes has it stripped before any caller sees it', async () => {
      // The server's `toMemberPack` maps explicit fields, so this body cannot
      // occur today — which is precisely why it is worth asserting. This is
      // the assertion that would catch a future contract WIDENING: the day
      // someone adds `notes` to the member shape server-side, this test fails
      // here rather than the note surfacing on a member's screen.
      //
      // Measured live for the negative control: the real endpoint returned the
      // seeded `B15A-ADMIN-ONLY-SECRET` zero times across all three packs.
      const promise = firstValueFrom(service.list());
      http
        .expectOne(PACKS)
        .flush([{ ...labelledPack(), notes: 'B15A-ADMIN-ONLY-SECRET' }]);

      const [pack] = await promise;

      expect(Object.prototype.hasOwnProperty.call(pack, 'notes')).toBe(false);
      expect(Object.keys(pack)).not.toContain('notes');
      expect(JSON.stringify(pack)).not.toContain('B15A-ADMIN-ONLY-SECRET');
    });

    it('the parsed object carries EXACTLY the eight contract keys', () => {
      // A whole-shape assertion rather than one absence, so a field added to
      // the member contract is a diff a reviewer reads rather than a discovery.
      const promise = firstValueFrom(service.list());
      http
        .expectOne(PACKS)
        .flush([
          {
            ...labelledPack(),
            notes: 'x',
            createdBy: 'y',
            memberVisible: true,
          },
        ]);

      return promise.then(([pack]) => {
        expect(Object.keys(pack).sort()).toEqual([
          'accessNote',
          'cohortName',
          'description',
          'id',
          'repoUrl',
          'slug',
          'tags',
          'title',
        ]);
      });
    });
  });

  /* ---------------------------------------------------------------------- */
  /* `accessNoteFor` — ASSUMPTION-27                                         */
  /* ---------------------------------------------------------------------- */

  describe('accessNoteFor (R5.5, ASSUMPTION-27)', () => {
    it('returns the pack’s own note when it has one', () => {
      expect(accessNoteFor(labelledPack())).toBe(
        'Invite lands within 24h of your GitHub handle being shared.',
      );
    });

    it('🔴 falls back to ONE shared line when the note is null', () => {
      // Every pack in this workspace has `accessNote` null on day one
      // (measured). A blank gap at exactly the spot R5.5 exists to fill is the
      // failure mode, so the null case must produce a sentence, not ''.
      expect(accessNoteFor(unlabelledPack())).toBe(DEFAULT_ACCESS_NOTE);
      expect(DEFAULT_ACCESS_NOTE.length).toBeGreaterThan(0);
    });

    it('the fallback never claims Ptah grants access (R5.7)', () => {
      // Ptah serves no pack content and provisions no GitHub access. A default
      // line reading "you have access" would be the product asserting an
      // entitlement it does not administer.
      expect(DEFAULT_ACCESS_NOTE).toMatch(/GitHub/);
      expect(DEFAULT_ACCESS_NOTE.toLowerCase()).not.toMatch(
        /request access|you have access|grant(ed)? by ptah/,
      );
    });

    it('an empty-string note is treated as authored, not as absent', () => {
      // `??` and not `||`. The distinction matters: `null` means "no note was
      // written", and only that case may be spoken for. Collapsing '' into the
      // default would put words in an admin's mouth.
      expect(accessNoteFor(labelledPack({ accessNote: '' }))).toBe('');
    });
  });
});
