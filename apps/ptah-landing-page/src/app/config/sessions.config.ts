export interface SessionTopic {
  id: string;
  title: string;
  description: string;
  icon: string;
  duration: string;
  topics: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
}

export const SESSION_TOPICS: SessionTopic[] = [
  {
    id: 'nx-monorepo-mastery',
    title: 'NX Monorepo Mastery',
    description:
      'Learn how to set up Ptah for NX workspaces, leverage agent orchestration across multiple projects, and harness workspace intelligence for maximum productivity.',
    icon: 'layers',
    duration: '2 hours',
    topics: [
      'NX workspace configuration for Ptah',
      'Multi-project agent orchestration',
      'Workspace intelligence deep dive',
      'Custom agent templates for NX',
      'Performance optimization tips',
    ],
    difficulty: 'intermediate',
  },
  {
    id: 'orchestration-workflow',
    title: 'Orchestration Workflow Deep Dive',
    description:
      "Master the PM to Architect to Developer pipeline, learn task tracking best practices, and create custom agents tailored to your team's workflow.",
    icon: 'git-branch',
    duration: '2 hours',
    topics: [
      'PM → Architect → Dev pipeline',
      'Task tracking with orchestration',
      'Custom agent creation',
      'Multi-agent collaboration patterns',
      'Quality gates and review workflows',
    ],
    difficulty: 'advanced',
  },
  {
    id: 'getting-started-ptah',
    title: 'Getting the Most Out of Ptah',
    description:
      'From setup wizard to advanced usage — learn chat tips, MCP integration, cost tracking, and everything you need to be productive with Ptah from day one.',
    icon: 'rocket',
    duration: '2 hours',
    topics: [
      'Setup wizard walkthrough',
      'Chat tips and shortcuts',
      'MCP server integration',
      'Cost and token tracking',
      'Provider configuration',
    ],
    difficulty: 'beginner',
  },
];
