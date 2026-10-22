import { readFileSync } from 'node:fs';

const shard = Number(process.argv[2]);
const shardCount = Number(process.argv[3]);
if (!Number.isInteger(shardCount) || shardCount < 1 ||
    !Number.isInteger(shard) || shard < 1 || shard > shardCount) {
  throw new Error('Usage: AFFECTED_PROJECTS=<JSON array> node assign-test-shard.mjs <shard> <count>');
}

const affected = JSON.parse(process.env.AFFECTED_PROJECTS ?? 'null');
if (!Array.isArray(affected) || affected.some((project) =>
  typeof project !== 'string' || !/^(?:@[\w.-]+\/)?[\w.-]+$/.test(project))) {
  throw new Error('AFFECTED_PROJECTS must be a JSON array of project names');
}

const weights = JSON.parse(readFileSync(new URL('../../.github/ci/test-weights.json', import.meta.url), 'utf8'));
if ([weights.defaultSeconds, ...Object.values(weights.projects)].some((weight) =>
  typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0)) {
  throw new Error('Test weights must be finite positive seconds');
}

const weightOf = (project) => Object.hasOwn(weights.projects, project)
  ? weights.projects[project] : weights.defaultSeconds;
// Stable ties keep all four independent jobs in agreement, regardless of input order.
const ordered = [...new Set(affected)].sort((a, b) =>
  weightOf(b) - weightOf(a) || (a < b ? -1 : a > b ? 1 : 0));
const buckets = Array.from({ length: shardCount }, () => ({ projects: [], seconds: 0 }));
for (const project of ordered) {
  const bucket = buckets.reduce((least, candidate) =>
    candidate.seconds < least.seconds ? candidate : least);
  bucket.projects.push(project);
  bucket.seconds += weightOf(project);
}

const bucket = buckets[shard - 1];
console.error(`Estimated shard loads (timing proxies): ${buckets.map((entry) => entry.seconds.toFixed(1)).join(', ')} seconds`);
console.error(`Shard ${shard}/${shardCount}: ${bucket.projects.join(', ') || 'no affected test projects'}`);
console.log(`projects=${bucket.projects.join(',')}`);
