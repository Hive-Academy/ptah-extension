/* Empty-state sample content (categories + prompts). */
window.PtahEmpty = {
  cats: [['build', 'Build', 'hammer'], ['fix', 'Fix', 'wrench'], ['review', 'Review', 'shield'], ['agents', 'Agents', 'users'], ['explore', 'Explore', 'compass'], ['creative', 'Creative', 'palette']],
  tone: { build: '', fix: 'm-lapis', review: 'm-teal', agents: '', explore: 'm-lapis', creative: 'm-teal' },
  data: {
    build: [['Add a new feature', 'Scaffold a feature end to end with tests'], ['Create a component', 'Generate a typed, accessible UI component'], ['Write unit tests', 'Cover the untested paths in this module'], ['Set up CI pipeline', 'Lint, test and build on every push']],
    fix: [['Debug a failing test', 'Find the root cause and patch it'], ['Fix a bug', 'Trace an error from stack to source'], ['Resolve type errors', 'Clear the TypeScript diagnostics'], ['Speed up a slow query', 'Profile it and propose an index']],
    review: [['Review my changes', 'Check the diff for bugs and style'], ['Security audit', 'Scan for common vulnerabilities'], ['Find dead code', 'List unused exports and files'], ['Check accessibility', 'Audit this view against WCAG AA']],
    agents: [['Run a multi-agent task', 'Split work across specialist agents'], ['Configure agents', 'Tailor agents to this codebase'], ['Compare two models', 'Run one prompt on both, side by side'], ['Schedule a recurring job', 'Automate a repeating task']],
    explore: [['Explain this codebase', 'Get a guided tour of the architecture'], ['Find where a thing lives', 'Search symbols across the workspace'], ['Map dependencies', 'Visualise how libraries connect'], ['Summarise recent commits', 'What changed this week, and why']],
    creative: [['Draft release notes', 'Turn commits into friendly notes'], ['Name this feature', 'Brainstorm names and taglines'], ['Write a README', 'Document setup, usage and examples'], ['Design an empty state', 'Sketch copy and layout options']]
  }
};
