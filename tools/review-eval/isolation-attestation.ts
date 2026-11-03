import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import { z } from 'zod';

const digest = z.string().regex(/^[0-9a-f]{64}$/);
const probeName = z.enum(['gh', 'github', 'network', 'secret', 'mcp', 'postHeadRef', 'model']);
const probe = z.object({ name: probeName, denied: z.boolean(), detail: z.string().min(1) }).strict();
export const attestationSchema = z.object({
  schemaVersion: z.literal(1),
  os: z.literal('linux'), kernel: z.string().min(1), bwrapVersion: z.string().min(1),
  namespaceId: z.string().min(1), laneId: z.string().min(1),
  snapshotHash: digest, reachableCommitsHash: digest, argvPolicyHash: digest, brokerPolicyHash: digest,
  codexVersion: z.string().min(1),
  mounts: z.array(z.object({ source: z.string(), target: z.string(), readonly: z.boolean() }).strict()),
  clearedEnvKeys: z.array(z.string()),
  probes: z.array(probe), modelCalls: z.number().int().nonnegative(),
  failures: z.array(z.string()),
}).strict();
export type IsolationAttestation = z.infer<typeof attestationSchema>;
const requiredDenials = ['gh', 'github', 'network', 'secret', 'mcp', 'postHeadRef'] as const;

export type DenialProbeName = typeof requiredDenials[number];
export interface ReplayProbeRunner {
  attempt(name: DenialProbeName): Promise<{ denied: boolean; detail: string }>;
}

/** The caller supplies a process-backed runner inside the namespace; failure to execute a probe fails closed. */
export async function runIsolationProbes(runner: ReplayProbeRunner): Promise<IsolationAttestation['probes']> {
  const results: IsolationAttestation['probes'] = [];
  for (const name of requiredDenials) {
    try {
      const result = await runner.attempt(name);
      results.push(probe.parse({ name, ...result }));
    } catch {
      results.push({ name, denied: false, detail: 'Probe could not complete' });
    }
  }
  return results;
}

export function evaluateIsolation(input: unknown): { valid: boolean; failures: string[]; hash: string } {
  const value = attestationSchema.parse(input);
  const failures = [...value.failures];
  for (const name of requiredDenials) {
    const matches = value.probes.filter(item => item.name === name);
    if (matches.length !== 1 || !matches[0].denied) failures.push(`Isolation probe failed: ${name}`);
  }
  if (!value.mounts.some(m => m.target === '/work/src' && m.readonly) ||
      !value.mounts.some(m => m.target === '/work/out' && !m.readonly)) failures.push('Mount policy failed');
  const hash = createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return { valid: failures.length === 0, failures, hash };
}

export function persistIsolationAttestation(input: unknown, outputPath: string, laneRoot: string): { valid: boolean; hash: string } {
  const value = attestationSchema.parse(input);
  if (!isAbsolute(outputPath) || !isAbsolute(laneRoot)) throw new Error('Absolute attestation paths required');
  const rel = relative(laneRoot, outputPath);
  if (rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)))
    throw new Error('Attestation must be outside lane root');
  const result = evaluateIsolation(value);
  writeFileSync(outputPath, JSON.stringify({ ...value, valid: result.valid, failures: result.failures, sha256: result.hash }, null, 2), { flag: 'wx', mode: 0o600 });
  return { valid: result.valid, hash: result.hash };
}
