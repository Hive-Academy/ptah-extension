import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const MotionPreferenceSchema = z.enum(['always', 'system', 'reduce']);
export type MotionPreference = z.infer<typeof MotionPreferenceSchema>;

/** The workspace provider stores Electron-only configuration in config.json. */
export function parseMotionPreference(config: unknown): MotionPreference {
  const parsed = z.object({
    ptah: z.object({ motionPreference: MotionPreferenceSchema }).partial(),
  }).safeParse(config);
  return parsed.success ? (parsed.data.ptah.motionPreference ?? 'always') : 'always';
}

export function readMotionPreference(userDataPath: string): MotionPreference {
  try {
    return parseMotionPreference(JSON.parse(readFileSync(join(userDataPath, 'config.json'), 'utf8')));
  } catch {
    // degradation-audit: optional-capability - Missing or invalid config must not prevent app startup.
    return 'always';
  }
}

/** CSS media value to apply to each Electron renderer at startup. */
export function motionMediaValue(preference: MotionPreference): 'reduce' | 'no-preference' | null {
  switch (preference) {
    case 'always': return 'no-preference';
    case 'reduce': return 'reduce';
    case 'system': return null;
  }
}
