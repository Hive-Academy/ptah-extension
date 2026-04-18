import type { ResourceWithOptions } from 'adminjs';
import { PrismaService } from '../../prisma/prisma.service';

export function getLicenseResource(
  prisma: PrismaService,
  model: unknown,
): ResourceWithOptions {
  return {
    resource: { model, client: prisma },
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
