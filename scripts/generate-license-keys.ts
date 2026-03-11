/**
 * Generate Ed25519 key pair for license response signing.
 *
 * TASK_2025_188: License response signing to prevent MITM attacks.
 *
 * Usage:
 *   npx ts-node scripts/generate-license-keys.ts
 *
 * Output:
 *   - Private key (base64 DER PKCS8): Set as LICENSE_SIGNING_PRIVATE_KEY env var on server
 *   - Public key (base64 DER SPKI): Embed in extension as LICENSE_PUBLIC_KEY_BASE64 constant
 *
 * Security:
 *   - Keep the private key SECRET. Never commit it to source control.
 *   - Only the public key should be embedded in the extension source code.
 */

import { generateKeyPairSync } from 'crypto';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');

const privateDer = privateKey.export({ format: 'der', type: 'pkcs8' });
const publicDer = publicKey.export({ format: 'der', type: 'spki' });

console.log('=== License Signing Keys (Ed25519) ===\n');
console.log(
  'Private key (set as LICENSE_SIGNING_PRIVATE_KEY env var on server):'
);
console.log((privateDer as Buffer).toString('base64'));
console.log('\nPublic key (embed in extension as LICENSE_PUBLIC_KEY_BASE64):');
console.log((publicDer as Buffer).toString('base64'));
console.log(
  '\nIMPORTANT: Keep the private key secret. Only the public key goes in source code.'
);
