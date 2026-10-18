# Module Boundaries — ESLint Config and Tags

## Enforce with `@nx/enforce-module-boundaries`

Configure in `eslint.config.mjs` (flat config):

```js
import nx from '@nx/eslint-plugin';

export default [
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    plugins: { '@nx': nx },
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          depConstraints: [
            {
              sourceTag: 'type:feature',
              onlyDependOnLibsWithTags: ['type:feature', 'type:ui', 'type:data-access', 'type:util', 'type:api-interfaces'],
            },
            {
              sourceTag: 'type:ui',
              onlyDependOnLibsWithTags: ['type:ui', 'type:util', 'type:api-interfaces'],
            },
            {
              sourceTag: 'type:data-access',
              onlyDependOnLibsWithTags: ['type:data-access', 'type:util', 'type:api-interfaces'],
            },
            {
              sourceTag: 'type:util',
              onlyDependOnLibsWithTags: ['type:util'],
            },
            {
              sourceTag: 'type:api-interfaces',
              onlyDependOnLibsWithTags: ['type:api-interfaces'],
            },
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },
          ],
        },
      ],
    },
  },
];
```

## Tagging Strategy

In each library's `project.json`:

```json
{
  "tags": ["scope:user-management", "type:feature", "platform:react"]
}
```

**Tag Dimensions:**

- `scope:` - Business domain (user-management, products, shared)
- `type:` - Library type (feature, ui, data-access, util)
- `platform:` - Target platform (react, next, shared)