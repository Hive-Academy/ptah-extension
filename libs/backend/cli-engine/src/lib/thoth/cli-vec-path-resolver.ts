import { createRequire } from 'node:module';
import * as path from 'node:path';

import type { Logger } from '@ptah-extension/vscode-core';
import {
  resolveVecPackageName,
  resolveVecBinaryName,
  type SqliteVecPathResolver,
} from '@ptah-extension/persistence-sqlite';

export function createCliVecPathResolver(
  logger: Logger,
): SqliteVecPathResolver {
  const req = createRequire(__filename);
  return () => {
    try {
      const sqliteVec = req('sqlite-vec') as {
        getLoadablePath?: () => string;
      };
      if (typeof sqliteVec.getLoadablePath === 'function') {
        return sqliteVec.getLoadablePath();
      }
    } catch (error: unknown) {
      logger.debug(
        '[CLI DI] sqlite-vec getLoadablePath unavailable, falling through',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }

    const packageName = resolveVecPackageName();
    if (!packageName) {
      throw new Error(
        `[CLI DI] no sqlite-vec package mapping for ${process.platform}/${process.arch}`,
      );
    }
    const binaryName = resolveVecBinaryName();
    const packageJsonPath = req.resolve(`${packageName}/package.json`);
    return path.join(path.dirname(packageJsonPath), binaryName);
  };
}
