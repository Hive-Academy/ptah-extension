import { ResourceWithOptions } from 'adminjs';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * AdminJS resource configuration for the License model
 *
 * TASK_2025_286: Provides admin UI for viewing and managing licenses.
 *
 * Constraints:
 * - licenseKey is excluded from editProperties (immutable after creation)
 * - Delete and bulkDelete are disabled for safety
 * - licenseKey is shown in list but should be treated as sensitive
 *
 * @param prisma - PrismaService instance (with DMMF compat applied)
 * @param dmmf - DMMF metadata containing modelMap
 */
export function getLicenseResource(
  prisma: PrismaService,
  dmmf: { modelMap: Record<string, unknown> },
): ResourceWithOptions {
  return {
    resource: {
      model: dmmf.modelMap['License'],
      client: prisma,
    },
    options: {
      navigation: { name: 'Licensing', icon: 'Key' },
      listProperties: [
        'id',
        'licenseKey',
        'plan',
        'status',
        'expiresAt',
        'createdAt',
      ],
      showProperties: [
        'id',
        'userId',
        'licenseKey',
        'plan',
        'status',
        'expiresAt',
        'createdAt',
        'createdBy',
      ],
      editProperties: ['plan', 'status', 'expiresAt'],
      filterProperties: ['plan', 'status', 'expiresAt'],
      actions: {
        delete: { isAccessible: false },
        bulkDelete: { isAccessible: false },
      },
    },
  };
}
