export interface LiveDemoCatalogEntry {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly poster: string;
  readonly video: string;
}

export const LIVE_DEMO_CATALOG: readonly LiveDemoCatalogEntry[] = [
  {
    id: 'orchestration',
    label: 'Orchestration',
    description: 'Watch a real PtahCode session coordinate work from a single prompt.',
    poster: '/assets/live-demo/orchestration.jpg',
    video: '/assets/live-demo/orchestration.webm',
  },
  {
    id: 'tribunal-council',
    label: 'Tribunal Council',
    description: 'See PtahCode bring several perspectives into one decision.',
    poster: '/assets/live-demo/tribunal-council.jpg',
    video: '/assets/live-demo/tribunal-council.webm',
  },
  {
    id: 'command-center',
    label: 'Command Center',
    description: 'Follow work and activity across PtahCode in one place.',
    poster: '/assets/live-demo/command-center.jpg',
    video: '/assets/live-demo/command-center.webm',
  },
  {
    id: 'multi-agent',
    label: 'Multi-agent orchestration',
    description: 'See PtahCode coordinate multiple agents through a shared task.',
    poster: '/assets/live-demo/multi-agent.jpg',
    video: '/assets/live-demo/multi-agent.webm',
  },
];
