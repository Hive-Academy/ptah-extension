/**
 * Static question definitions for the New Project wizard.
 * All question data is hardcoded — no LLM involved.
 * LLM is only used at plan generation time after all answers are collected.
 */
import type {
  DiscoveryQuestion,
  NewProjectTypeInfo,
  ProjectTypeQuestionConfig,
  NewProjectType,
} from '../types/new-project.types';

// ============================================================
// Project Type Definitions
// ============================================================

export const PROJECT_TYPES: NewProjectTypeInfo[] = [
  {
    id: 'full-saas',
    label: 'Full SaaS Application',
    description:
      'Complete SaaS with NestJS backend, Angular/React frontend, auth, payments, and deployment',
    icon: 'Layers',
    techStack: ['NestJS', 'Angular/React', 'PostgreSQL', 'Prisma', 'Docker'],
  },
  {
    id: 'nestjs-api',
    label: 'NestJS API',
    description: 'Backend API with NestJS, database, auth, and deployment',
    icon: 'Server',
    techStack: ['NestJS', 'TypeScript', 'PostgreSQL', 'Docker'],
  },
  {
    id: 'angular-app',
    label: 'Angular Application',
    description:
      'Frontend application with Angular, state management, and UI framework',
    icon: 'Layout',
    techStack: ['Angular', 'TypeScript', 'TailwindCSS'],
  },
  {
    id: 'react-app',
    label: 'React Application',
    description:
      'Frontend application with React, framework choice, and UI library',
    icon: 'Atom',
    techStack: ['React', 'TypeScript', 'TailwindCSS'],
  },
];

// ============================================================
// Shared Questions
// ============================================================

const SHARED_QUESTIONS = {
  projectName: {
    id: 'project-name',
    text: 'What is your project name?',
    inputType: 'text',
    placeholder: 'my-awesome-app',
    required: true,
  },
  appType: {
    id: 'app-type',
    text: 'What type of application are you building?',
    inputType: 'single-select',
    options: [
      {
        value: 'dashboard',
        label: 'Admin Dashboard',
        description: 'Data tables, charts, analytics',
      },
      {
        value: 'ecommerce',
        label: 'E-Commerce',
        description: 'Product listings, cart, checkout',
      },
      {
        value: 'content',
        label: 'Content Platform',
        description: 'Blog, CMS, media gallery',
      },
      {
        value: 'social',
        label: 'Social / Community',
        description: 'User profiles, feeds, messaging',
      },
      {
        value: 'saas',
        label: 'SaaS Tool',
        description: 'Multi-tenant business application',
      },
      {
        value: 'other',
        label: 'Other',
        description: 'Custom application type',
      },
    ],
    required: true,
  },
  deploymentTarget: {
    id: 'deployment-target',
    text: 'Where will you deploy?',
    inputType: 'single-select',
    options: [
      { value: 'docker', label: 'Docker / Docker Compose' },
      { value: 'vercel', label: 'Vercel' },
      { value: 'aws', label: 'AWS (ECS, Lambda, etc.)' },
      { value: 'gcp', label: 'Google Cloud' },
      { value: 'digitalocean', label: 'DigitalOcean App Platform' },
      { value: 'self-hosted', label: 'Self-hosted VPS' },
      { value: 'undecided', label: 'Not decided yet' },
    ],
    required: true,
  },
  teamSize: {
    id: 'team-size',
    text: 'What is your team size?',
    inputType: 'single-select',
    options: [
      { value: 'solo', label: 'Solo developer' },
      { value: 'small', label: 'Small team (2-5)' },
      { value: 'medium', label: 'Medium team (6-15)' },
      { value: 'large', label: 'Large team (15+)' },
    ],
    required: true,
  },
  timeline: {
    id: 'timeline',
    text: 'What is your timeline goal?',
    inputType: 'single-select',
    options: [
      {
        value: 'mvp',
        label: 'MVP / Prototype',
        description: 'Ship fast, iterate later',
      },
      {
        value: 'production',
        label: 'Production-ready',
        description: 'Full quality from the start',
      },
    ],
    required: true,
  },
  authMethod: {
    id: 'auth-method',
    text: 'How will users authenticate?',
    inputType: 'single-select',
    options: [
      { value: 'jwt', label: 'JWT (email/password)' },
      { value: 'oauth', label: 'OAuth (Google, GitHub, etc.)' },
      { value: 'both', label: 'Both JWT + OAuth' },
      { value: 'api-keys', label: 'API Keys only' },
      { value: 'none', label: 'No auth needed' },
    ],
    required: true,
  },
} satisfies Record<string, DiscoveryQuestion>;

// ============================================================
// Full SaaS Questions
// ============================================================

const FULL_SAAS_QUESTIONS: ProjectTypeQuestionConfig = {
  projectType: 'full-saas',
  groups: [
    {
      id: 'business',
      title: 'Business Context',
      description: 'Help us understand your SaaS business model',
      questions: [
        SHARED_QUESTIONS.projectName,
        {
          id: 'saas-type',
          text: 'What type of SaaS are you building?',
          inputType: 'single-select',
          options: [
            {
              value: 'b2b',
              label: 'B2B',
              description: 'Business customers, workspaces/organizations',
            },
            {
              value: 'b2c',
              label: 'B2C',
              description: 'Individual consumers',
            },
            {
              value: 'b2b2c',
              label: 'B2B2C',
              description: 'Platform connecting businesses and consumers',
            },
          ],
          required: true,
        },
        {
          id: 'tenant-model',
          text: 'What tenant isolation model?',
          inputType: 'single-select',
          options: [
            {
              value: 'shared-db',
              label: 'Shared database (row-level)',
              description: 'One DB, tenantId column',
            },
            {
              value: 'schema-per-tenant',
              label: 'Schema per tenant',
              description: 'One DB, separate schemas',
            },
            {
              value: 'db-per-tenant',
              label: 'Database per tenant',
              description: 'Full isolation',
            },
            {
              value: 'no-multitenancy',
              label: 'No multi-tenancy',
              description: 'Single-tenant application',
            },
          ],
          required: true,
        },
        {
          id: 'initial-domains',
          text: 'What are your core business domains? (comma-separated)',
          inputType: 'text',
          placeholder: 'e.g., users, billing, projects, analytics',
          required: true,
        },
      ],
    },
    {
      id: 'technical',
      title: 'Technical Stack',
      description: 'Configure your technical choices',
      questions: [
        {
          id: 'frontend-framework',
          text: 'Which frontend framework?',
          inputType: 'single-select',
          options: [
            { value: 'angular', label: 'Angular' },
            { value: 'react', label: 'React (Next.js)' },
          ],
          required: true,
        },
        SHARED_QUESTIONS.authMethod,
        {
          id: 'database',
          text: 'Which database?',
          inputType: 'single-select',
          options: [
            {
              value: 'postgresql',
              label: 'PostgreSQL',
              description: 'Best for relational data',
            },
            { value: 'mysql', label: 'MySQL' },
            {
              value: 'mongodb',
              label: 'MongoDB',
              description: 'Document store',
            },
          ],
          defaultValue: 'postgresql',
          required: true,
        },
        SHARED_QUESTIONS.deploymentTarget,
      ],
    },
    {
      id: 'monetization',
      title: 'Monetization',
      description: 'Configure your pricing and payment setup',
      questions: [
        {
          id: 'pricing-model',
          text: 'What pricing model?',
          inputType: 'single-select',
          options: [
            {
              value: 'freemium',
              label: 'Freemium',
              description: 'Free tier + paid upgrades',
            },
            {
              value: 'trial',
              label: 'Free trial',
              description: 'Time-limited full access',
            },
            {
              value: 'usage-based',
              label: 'Usage-based',
              description: 'Pay per API call / resource',
            },
            {
              value: 'seat-based',
              label: 'Seat-based',
              description: 'Per-user pricing',
            },
            {
              value: 'flat',
              label: 'Flat-rate',
              description: 'Fixed monthly/annual price',
            },
            { value: 'none', label: 'No monetization yet' },
          ],
          required: true,
        },
        {
          id: 'payment-provider',
          text: 'Which payment provider?',
          inputType: 'single-select',
          options: [
            { value: 'stripe', label: 'Stripe' },
            { value: 'paddle', label: 'Paddle' },
            { value: 'lemon-squeezy', label: 'Lemon Squeezy' },
            { value: 'none', label: 'None / Decide later' },
          ],
          required: true,
        },
        {
          id: 'email-needs',
          text: 'What email capabilities do you need?',
          inputType: 'multi-select',
          options: [
            {
              value: 'transactional',
              label: 'Transactional (welcome, reset password)',
            },
            { value: 'marketing', label: 'Marketing campaigns' },
            {
              value: 'notifications',
              label: 'In-app notification emails',
            },
            { value: 'none', label: 'No email needed' },
          ],
          minSelections: 1,
          required: true,
        },
      ],
    },
    {
      id: 'scale',
      title: 'Scale & Timeline',
      description: 'Help us right-size the architecture',
      questions: [
        SHARED_QUESTIONS.teamSize,
        SHARED_QUESTIONS.timeline,
        {
          id: 'realtime',
          text: 'Do you need real-time features?',
          inputType: 'multi-select',
          options: [
            { value: 'websockets', label: 'WebSocket connections' },
            { value: 'sse', label: 'Server-Sent Events' },
            {
              value: 'push-notifications',
              label: 'Push notifications',
            },
            { value: 'none', label: 'No real-time needed' },
          ],
          minSelections: 1,
          required: true,
        },
      ],
    },
  ],
};

// ============================================================
// NestJS API Questions
// ============================================================

const NESTJS_API_QUESTIONS: ProjectTypeQuestionConfig = {
  projectType: 'nestjs-api',
  groups: [
    {
      id: 'basics',
      title: 'Project Basics',
      description: 'Core API configuration',
      questions: [
        SHARED_QUESTIONS.projectName,
        {
          id: 'api-style',
          text: 'What API style?',
          inputType: 'single-select',
          options: [
            {
              value: 'rest',
              label: 'REST',
              description: 'Traditional RESTful endpoints',
            },
            {
              value: 'graphql',
              label: 'GraphQL',
              description: 'Schema-first or code-first',
            },
            {
              value: 'hybrid',
              label: 'REST + GraphQL',
              description: 'Both styles',
            },
            {
              value: 'grpc',
              label: 'gRPC',
              description: 'Protocol Buffers based',
            },
          ],
          required: true,
        },
        {
          id: 'database',
          text: 'Which database?',
          inputType: 'single-select',
          options: [
            { value: 'postgresql', label: 'PostgreSQL' },
            { value: 'mysql', label: 'MySQL' },
            { value: 'mongodb', label: 'MongoDB' },
            {
              value: 'sqlite',
              label: 'SQLite',
              description: 'Good for prototyping',
            },
            { value: 'none', label: 'No database' },
          ],
          defaultValue: 'postgresql',
          required: true,
        },
        {
          id: 'orm',
          text: 'Which ORM/ODM?',
          inputType: 'single-select',
          options: [
            {
              value: 'prisma',
              label: 'Prisma',
              description: 'Type-safe, schema-first',
            },
            {
              value: 'typeorm',
              label: 'TypeORM',
              description: 'Decorator-based',
            },
            {
              value: 'drizzle',
              label: 'Drizzle',
              description: 'Lightweight, SQL-like',
            },
            {
              value: 'mongoose',
              label: 'Mongoose',
              description: 'MongoDB ODM',
            },
            { value: 'none', label: 'None / Raw queries' },
          ],
          required: true,
        },
      ],
    },
    {
      id: 'auth',
      title: 'Authentication & Security',
      description: 'How will your API be secured?',
      questions: [
        SHARED_QUESTIONS.authMethod,
        {
          id: 'rbac',
          text: 'Do you need role-based access control?',
          inputType: 'single-select',
          options: [
            { value: 'simple', label: 'Simple roles (admin/user)' },
            {
              value: 'rbac',
              label: 'Full RBAC (roles + permissions)',
            },
            { value: 'none', label: 'No RBAC' },
          ],
          required: true,
        },
      ],
    },
    {
      id: 'features',
      title: 'Features',
      description: 'Select the features you need',
      questions: [
        {
          id: 'features',
          text: 'Which features do you need?',
          inputType: 'multi-select',
          options: [
            { value: 'caching', label: 'Caching (Redis)' },
            { value: 'queues', label: 'Job queues (Bull)' },
            { value: 'file-uploads', label: 'File uploads (S3/local)' },
            { value: 'websockets', label: 'WebSockets' },
            { value: 'rate-limiting', label: 'Rate limiting' },
            { value: 'swagger', label: 'Swagger/OpenAPI docs' },
            { value: 'health-checks', label: 'Health checks' },
            { value: 'logging', label: 'Structured logging' },
          ],
          minSelections: 0,
          required: false,
        },
      ],
    },
    {
      id: 'deployment',
      title: 'Deployment & Scale',
      description: 'Production configuration',
      questions: [
        SHARED_QUESTIONS.deploymentTarget,
        SHARED_QUESTIONS.teamSize,
        SHARED_QUESTIONS.timeline,
      ],
    },
  ],
};

// ============================================================
// Angular App Questions
// ============================================================

const ANGULAR_APP_QUESTIONS: ProjectTypeQuestionConfig = {
  projectType: 'angular-app',
  groups: [
    {
      id: 'basics',
      title: 'Project Basics',
      description: 'Core application configuration',
      questions: [SHARED_QUESTIONS.projectName, SHARED_QUESTIONS.appType],
    },
    {
      id: 'architecture',
      title: 'Architecture',
      description: 'Application architecture choices',
      questions: [
        {
          id: 'state-management',
          text: 'State management approach?',
          inputType: 'single-select',
          options: [
            {
              value: 'signals',
              label: 'Angular Signals',
              description: 'Modern, built-in reactivity',
            },
            {
              value: 'ngrx',
              label: 'NgRx Store',
              description: 'Redux-style, enterprise',
            },
            {
              value: 'ngrx-signal-store',
              label: 'NgRx Signal Store',
              description: 'Signal-based NgRx',
            },
            {
              value: 'services',
              label: 'Simple services',
              description: 'Inject + signals/subjects',
            },
          ],
          defaultValue: 'signals',
          required: true,
        },
        {
          id: 'ui-framework',
          text: 'Which UI framework?',
          inputType: 'single-select',
          options: [
            {
              value: 'tailwind-daisy',
              label: 'TailwindCSS + DaisyUI',
              description: 'Utility-first + component library',
            },
            {
              value: 'material',
              label: 'Angular Material',
              description: 'Google Material Design',
            },
            {
              value: 'primeng',
              label: 'PrimeNG',
              description: 'Rich component suite',
            },
            {
              value: 'custom',
              label: 'Custom / None',
              description: 'Build from scratch',
            },
          ],
          required: true,
        },
        {
          id: 'routing',
          text: 'What routing strategy?',
          inputType: 'single-select',
          options: [
            {
              value: 'lazy',
              label: 'Lazy-loaded routes',
              description: 'Feature modules loaded on demand',
            },
            {
              value: 'eager',
              label: 'Eager loading',
              description: 'All routes loaded upfront',
            },
          ],
          defaultValue: 'lazy',
          required: true,
        },
      ],
    },
    {
      id: 'features',
      title: 'Features',
      description: 'Additional capabilities',
      questions: [
        {
          id: 'features',
          text: 'Which features do you need?',
          inputType: 'multi-select',
          options: [
            {
              value: 'ssr',
              label: 'Server-Side Rendering (Angular Universal)',
            },
            { value: 'pwa', label: 'Progressive Web App' },
            { value: 'i18n', label: 'Internationalization' },
            {
              value: 'auth',
              label: 'Auth integration (guards, interceptors)',
            },
            { value: 'forms', label: 'Complex reactive forms' },
            {
              value: 'testing',
              label: 'Full test setup (Jest + Cypress)',
            },
          ],
          minSelections: 0,
          required: false,
        },
        {
          id: 'api-integration',
          text: 'How will you connect to APIs?',
          inputType: 'single-select',
          options: [
            { value: 'rest', label: 'REST (HttpClient)' },
            { value: 'graphql', label: 'GraphQL (Apollo)' },
            { value: 'firebase', label: 'Firebase / Supabase' },
            { value: 'none', label: 'No API integration' },
          ],
          required: true,
        },
      ],
    },
    {
      id: 'deployment',
      title: 'Deployment',
      description: 'Where and how to deploy',
      questions: [SHARED_QUESTIONS.deploymentTarget, SHARED_QUESTIONS.timeline],
    },
  ],
};

// ============================================================
// React App Questions
// ============================================================

const REACT_APP_QUESTIONS: ProjectTypeQuestionConfig = {
  projectType: 'react-app',
  groups: [
    {
      id: 'basics',
      title: 'Project Basics',
      description: 'Core application configuration',
      questions: [
        SHARED_QUESTIONS.projectName,
        SHARED_QUESTIONS.appType,
        {
          id: 'framework',
          text: 'Which React framework?',
          inputType: 'single-select',
          options: [
            {
              value: 'nextjs',
              label: 'Next.js',
              description: 'Full-stack, SSR/SSG, file-based routing',
            },
            {
              value: 'vite',
              label: 'Vite + React',
              description: 'Fast SPA, no SSR built-in',
            },
            {
              value: 'remix',
              label: 'Remix',
              description: 'Nested routes, progressive enhancement',
            },
          ],
          required: true,
        },
      ],
    },
    {
      id: 'architecture',
      title: 'Architecture',
      description: 'Application architecture choices',
      questions: [
        {
          id: 'state-management',
          text: 'State management approach?',
          inputType: 'single-select',
          options: [
            {
              value: 'zustand',
              label: 'Zustand',
              description: 'Lightweight, hook-based',
            },
            {
              value: 'redux-toolkit',
              label: 'Redux Toolkit',
              description: 'Enterprise, predictable',
            },
            {
              value: 'jotai',
              label: 'Jotai',
              description: 'Atomic state',
            },
            {
              value: 'react-query',
              label: 'TanStack Query only',
              description: 'Server state management',
            },
            {
              value: 'context',
              label: 'React Context',
              description: 'Built-in, simple apps',
            },
          ],
          required: true,
        },
        {
          id: 'ui-framework',
          text: 'Which UI library?',
          inputType: 'single-select',
          options: [
            {
              value: 'shadcn',
              label: 'shadcn/ui',
              description: 'Copy-paste Radix components + Tailwind',
            },
            {
              value: 'tailwind',
              label: 'TailwindCSS (no component lib)',
              description: 'Utility-first only',
            },
            {
              value: 'mui',
              label: 'Material UI (MUI)',
              description: 'Comprehensive component library',
            },
            {
              value: 'chakra',
              label: 'Chakra UI',
              description: 'Accessible, composable',
            },
            {
              value: 'mantine',
              label: 'Mantine',
              description: 'Modern hooks-based',
            },
          ],
          required: true,
        },
      ],
    },
    {
      id: 'features',
      title: 'Features',
      description: 'Additional capabilities',
      questions: [
        {
          id: 'features',
          text: 'Which features do you need?',
          inputType: 'multi-select',
          options: [
            { value: 'ssr', label: 'Server-Side Rendering' },
            { value: 'ssg', label: 'Static Site Generation' },
            { value: 'pwa', label: 'Progressive Web App' },
            { value: 'i18n', label: 'Internationalization' },
            { value: 'auth', label: 'Auth integration' },
            {
              value: 'testing',
              label: 'Full test setup (Vitest + Playwright)',
            },
          ],
          minSelections: 0,
          required: false,
        },
        {
          id: 'api-integration',
          text: 'How will you connect to APIs?',
          inputType: 'single-select',
          options: [
            {
              value: 'rest',
              label: 'REST (fetch / axios + TanStack Query)',
            },
            { value: 'graphql', label: 'GraphQL (Apollo / urql)' },
            {
              value: 'trpc',
              label: 'tRPC',
              description: 'End-to-end typesafe',
            },
            { value: 'firebase', label: 'Firebase / Supabase' },
            { value: 'none', label: 'No API integration' },
          ],
          required: true,
        },
      ],
    },
    {
      id: 'deployment',
      title: 'Deployment',
      description: 'Where and how to deploy',
      questions: [SHARED_QUESTIONS.deploymentTarget, SHARED_QUESTIONS.timeline],
    },
  ],
};

// ============================================================
// Question Registry
// ============================================================

export const QUESTION_REGISTRY: Record<
  NewProjectType,
  ProjectTypeQuestionConfig
> = {
  'full-saas': FULL_SAAS_QUESTIONS,
  'nestjs-api': NESTJS_API_QUESTIONS,
  'angular-app': ANGULAR_APP_QUESTIONS,
  'react-app': REACT_APP_QUESTIONS,
};
