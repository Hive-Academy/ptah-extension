import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
  NO_REFERENCES_LINE,
  RATER_CSV_COLUMNS,
  REFERENCES_SEPARATOR,
  buildLabellingPacket,
  parseSkillMarkdown,
  renderDocument,
  yamlScalarText,
  type DocumentReader,
} from './build-labelling-packet';
import {
  RUBRIC_STRATA,
  type RubricSample,
  type SampledDocument,
} from './select-rubric-sample';

function syntheticSample(): RubricSample {
  const documents: SampledDocument[] = [
    {
      stratum: 'authored',
      key: 'repo:synthetic-authored-alpha',
      slug: 'synthetic-authored-alpha',
      source: { kind: 'repo-skill', slug: 'synthetic-authored-alpha' },
    },
    {
      stratum: 'promoted-synthesized',
      key: 'repo:synthetic-promoted-beta',
      slug: 'synthetic-promoted-beta',
      source: { kind: 'repo-skill', slug: 'synthetic-promoted-beta' },
    },
    {
      stratum: 'anchor-471',
      key: 'candidate:synthetic-anchor-gamma',
      slug: 'synthetic-anchor-gamma',
      source: {
        kind: 'candidate',
        slug: 'synthetic-anchor-gamma',
        candidateId: 'ROWID-ANCHOR-0001',
      },
      anchor471Total: 17,
    },
    {
      stratum: 'suggestion',
      key: 'suggestion:SUGGESTION-ROW-0001',
      slug: 'synthetic-suggestion-delta',
      source: {
        kind: 'suggestion',
        suggestionId: 'SUGGESTION-ROW-0001',
        name: 'synthetic-suggestion-delta',
      },
    },
    {
      stratum: 'judged-model',
      key: 'candidate:synthetic-judged-epsilon',
      slug: 'synthetic-judged-epsilon',
      source: {
        kind: 'candidate',
        slug: 'synthetic-judged-epsilon',
        candidateId: 'ROWID-JUDGED-0002',
      },
      cell: 'w2-above',
    },
    {
      stratum: 'fallback',
      key: 'candidate:synthetic-fallback-zeta',
      slug: 'synthetic-fallback-zeta',
      source: {
        kind: 'candidate',
        slug: 'synthetic-fallback-zeta',
        candidateId: null,
      },
    },
    {
      stratum: 'random',
      key: 'candidate:synthetic-random-eta',
      slug: 'synthetic-random-eta',
      source: {
        kind: 'candidate',
        slug: 'synthetic-random-eta',
        candidateId: 'ROWID-RANDOM-0003',
      },
    },
  ];
  const counts = Object.fromEntries(
    RUBRIC_STRATA.map((s) => [s, 1]),
  ) as RubricSample['counts'];
  return {
    seed: 'spec-seed',
    documents,
    counts,
    shortfalls: [],
    fallbackIdentifiable: true,
    judgedModelCells: [{ cell: 'w2-above', pool: 4, selected: 1 }],
    judgedModelMedianTurns: 120,
    pools: { candidates: 7 },
    notes: [],
  };
}

const reader: DocumentReader = async (doc) => {
  const frontmatter =
    doc.source.kind === 'suggestion'
      ? ''
      : `---\nname: ${doc.slug}\ndescription: 'Use when the ${doc.slug} job runs; it''s quoted'\nlicense: Proprietary\n---\n`;
  return {
    skillMd: `${frontmatter}\r\n## Steps\r\n\r\n1. Run ${doc.slug} carefully.\r\n`,
    fallbackDescription: 'Use when a synthetic routine repeats.',
    references:
      doc.source.kind === 'repo-skill'
        ? [{ name: 'patterns.md', content: `See the ${doc.slug} notes.` }]
        : [],
  };
};

async function listAll(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listAll(path)));
    else out.push(path);
  }
  return out;
}

describe('buildLabellingPacket', () => {
  let benchDataDir: string;

  beforeEach(async () => {
    benchDataDir = await mkdtemp(join(tmpdir(), 'ptah-620-packet-'));
  });

  afterEach(async () => {
    await rm(benchDataDir, { recursive: true, force: true });
  });

  it('writes one blind packet per rater with no stratum, slug or pipeline data visible', async () => {
    const sample = syntheticSample();
    const result = await buildLabellingPacket({
      benchDataDir,
      sample,
      read: reader,
      provenance: { commit: 'abc' },
    });

    const files = await listAll(benchDataDir);
    expect(
      files.every((f) => !relative(benchDataDir, f).startsWith('..')),
    ).toBe(true);
    const raterVisible = files.filter((f) =>
      relative(result.packetDir, f).startsWith('raters'),
    );
    expect(raterVisible.length).toBe(2 * (sample.documents.length + 3));
    const forbidden = [
      ...RUBRIC_STRATA,
      ...sample.documents.map((d) => d.slug),
      'ROWID-ANCHOR-0001',
      'ROWID-JUDGED-0002',
      'ROWID-RANDOM-0003',
      'SUGGESTION-ROW-0001',
      'w2-above',
      'anchor471Total',
      'Proprietary',
      'spec-seed',
    ];
    for (const file of raterVisible) {
      const text = await readFile(file, 'utf8');
      for (const token of forbidden) {
        if (text.includes(token))
          throw new Error(
            `${token} leaked into ${relative(benchDataDir, file)}`,
          );
      }
    }

    const idMap = JSON.parse(
      await readFile(result.idMapPath, 'utf8'),
    ) as Record<string, { stratum: string; slug: string; sha256: string }>;
    expect(
      Object.values(idMap)
        .map((e) => e.stratum)
        .sort(),
    ).toEqual([...RUBRIC_STRATA].sort());
    const manifest = JSON.parse(
      await readFile(result.manifestPath, 'utf8'),
    ) as { seed: string; orders: Record<string, string[]> };
    expect(manifest.seed).toBe('spec-seed');
    expect(manifest.orders['r1']).not.toEqual(manifest.orders['r2']);
    expect([...(manifest.orders['r1'] ?? [])].sort()).toEqual(
      Object.keys(idMap).sort(),
    );
  });

  it('writes CSV templates in each rater order with empty scores and no note column', async () => {
    const result = await buildLabellingPacket({
      benchDataDir,
      sample: syntheticSample(),
      read: reader,
      provenance: {},
    });
    const manifest = JSON.parse(
      await readFile(result.manifestPath, 'utf8'),
    ) as { orders: Record<string, string[]> };
    for (const rater of ['r1', 'r2']) {
      const lines = (await readFile(result.raterCsvPaths[rater] ?? '', 'utf8'))
        .trimEnd()
        .split('\n');
      expect(lines[0]).toBe(RATER_CSV_COLUMNS.join(','));
      expect(lines[0]).not.toContain('note');
      const rows = lines.slice(1).map((l) => l.split(','));
      expect(rows.map((r) => r[0])).toEqual(manifest.orders[rater]);
      for (const row of rows) {
        expect(row).toHaveLength(RATER_CSV_COLUMNS.length);
        expect(row[1]).toBe(rater);
        expect(row.slice(2).every((cell) => cell === '')).toBe(true);
      }
      const notes = await readFile(result.notesCsvPaths[rater] ?? '', 'utf8');
      expect(notes.split('\n')[0]).toBe('opaqueId,raterId,note');
      const sheet = await readFile(
        join(result.raterDirs[rater] ?? '', 'INSTRUCTIONS.md'),
        'utf8',
      );
      expect(sheet).toContain('C8. Progressive Disclosure & Token Economics');
      expect(sheet).toContain('Total score ≥ 64/80');
    }
  });

  it('renders documents with the opaque id, kept keys only, and the fixed reference separator', async () => {
    const result = await buildLabellingPacket({
      benchDataDir,
      sample: syntheticSample(),
      read: reader,
      provenance: {},
    });
    const idMap = JSON.parse(
      await readFile(result.idMapPath, 'utf8'),
    ) as Record<string, { stratum: string; droppedFrontmatterKeys: string[] }>;
    for (const [opaqueId, entry] of Object.entries(idMap)) {
      const text = await readFile(
        join(result.raterDirs['r1'] ?? '', 'documents', `${opaqueId}.md`),
        'utf8',
      );
      expect(text.startsWith(`---\nname: ${opaqueId}\ndescription: "`)).toBe(
        true,
      );
      expect(text).toContain(REFERENCES_SEPARATOR);
      expect(text).not.toContain('\r');
      const isRepo =
        entry.stratum === 'authored' ||
        entry.stratum === 'promoted-synthesized';
      expect(text.includes(NO_REFERENCES_LINE)).toBe(!isRepo);
      if (entry.stratum !== 'suggestion')
        expect(entry.droppedFrontmatterKeys).toEqual(['license']);
    }
  });

  it('is byte-identical across two builds', async () => {
    const first = await buildLabellingPacket({
      benchDataDir,
      sample: syntheticSample(),
      read: reader,
      provenance: {},
    });
    const a = await Promise.all(
      (await listAll(first.packetDir)).sort().map((f) => readFile(f, 'utf8')),
    );
    await buildLabellingPacket({
      benchDataDir,
      sample: syntheticSample(),
      read: reader,
      provenance: {},
      overwrite: true,
    });
    const b = await Promise.all(
      (await listAll(first.packetDir)).sort().map((f) => readFile(f, 'utf8')),
    );
    expect(b).toEqual(a);
  });

  it('refuses to replace a packet without overwrite, and never one that holds scores', async () => {
    const result = await buildLabellingPacket({
      benchDataDir,
      sample: syntheticSample(),
      read: reader,
      provenance: {},
    });
    await expect(
      buildLabellingPacket({
        benchDataDir,
        sample: syntheticSample(),
        read: reader,
        provenance: {},
      }),
    ).rejects.toThrow('already exists');
    const csvPath = result.raterCsvPaths['r1'] ?? '';
    const lines = (await readFile(csvPath, 'utf8')).split('\n');
    lines[1] =
      lines[1]?.replace(/,r1,.*/, ',r1,7,7,7,7,7,7,7,7,56,false,2026-10-07') ??
      '';
    await writeFile(csvPath, lines.join('\n'), 'utf8');
    await expect(
      buildLabellingPacket({
        benchDataDir,
        sample: syntheticSample(),
        read: reader,
        provenance: {},
        overwrite: true,
      }),
    ).rejects.toThrow('already holds scores');
    expect(await readFile(csvPath, 'utf8')).toContain('56,false');
  });

  it('refuses a bench data dir under the real ~/.ptah', async () => {
    await expect(
      buildLabellingPacket({
        benchDataDir: join(benchDataDir, '.ptah', 'bench'),
        sample: syntheticSample(),
        read: reader,
        provenance: {},
        benchDataRules: { realHome: benchDataDir },
      }),
    ).rejects.toThrow('real Ptah state directory');
  });

  it('refuses a bench data dir inside the repository (619 resolveBenchDataDir)', async () => {
    await expect(
      buildLabellingPacket({
        benchDataDir: join(benchDataDir, 'checkout', 'bench'),
        sample: syntheticSample(),
        read: reader,
        provenance: {},
        benchDataRules: { repoRoot: join(benchDataDir, 'checkout') },
      }),
    ).rejects.toThrow('inside it');
  });

  it('never hands two raters the same order, even with two documents', async () => {
    const two = syntheticSample();
    two.documents = two.documents.slice(0, 2);
    let collisions = 0;
    for (let i = 0; i < 16; i += 1) {
      const sample = { ...two, seed: `two-doc-seed-${i}` };
      try {
        const result = await buildLabellingPacket({
          benchDataDir,
          sample,
          read: reader,
          provenance: {},
          overwrite: true,
        });
        const manifest = JSON.parse(
          await readFile(result.manifestPath, 'utf8'),
        ) as { orders: Record<string, string[]> };
        expect(manifest.orders['r1']).not.toEqual(manifest.orders['r2']);
      } catch (error) {
        expect((error as Error).message).toContain('same document order');
        collisions += 1;
      }
    }
    // With two documents half of all seeds collide; the guard must fire.
    expect(collisions).toBeGreaterThan(0);
  });

  it('cleans up staging and writes nothing when a document cannot be read', async () => {
    const failing: DocumentReader = async (doc) => {
      if (doc.stratum === 'random') throw new Error('unreadable body');
      return reader(doc);
    };
    await expect(
      buildLabellingPacket({
        benchDataDir,
        sample: syntheticSample(),
        read: failing,
        provenance: {},
      }),
    ).rejects.toThrow('unreadable body');
    expect(await listAll(benchDataDir)).toEqual([]);
  });
});

describe('document rendering helpers', () => {
  it('reads plain, quoted and folded YAML scalars', () => {
    expect(yamlScalarText("'It''s quoted'")).toBe("It's quoted");
    expect(yamlScalarText('"Double \\"q\\""')).toBe('Double "q"');
    expect(yamlScalarText('>\nfolded line one\nline two')).toBe(
      'folded line one line two',
    );
    expect(yamlScalarText('plain: with colon')).toBe('plain: with colon');
  });

  it('splits frontmatter that is not valid YAML', () => {
    const parsed = parseSkillMarkdown(
      '---\nname: x-y\ndescription: Do this: then that\n---\n\nBody\n',
    );
    expect(parsed.keys.get('description')).toBe('Do this: then that');
    expect(parsed.body).toBe('\nBody\n');
  });

  it('redacts hyphenated slugs but leaves single-word slugs in prose', () => {
    const multi = renderDocument('SKD-1', 'run-the-thing', {
      skillMd: 'Use run-the-thing, not run-the-things.',
      references: [],
    });
    expect(multi.text).toContain('Use SKD-1, not run-the-things.');
    const single = renderDocument('SKD-2', 'orchestration', {
      skillMd: 'Plan the orchestration.',
      references: [],
    });
    expect(single.text).toContain('Plan the orchestration.');
  });
});
