# Contributing to Ptah

We welcome contributions! Here's how to get started.

## Getting Started

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Run quality gates: `npm run lint:all && npm run typecheck:all`
5. Commit with conventional commits: `git commit -m "feat(scope): description"`
6. Push and open a pull request

## Development Setup

```bash
git clone https://github.com/Hive-Academy/ptah-extension.git
cd ptah-extension
npm install
npm run build:all
```

Press F5 in VS Code to launch the Extension Development Host.

## Code Standards

- TypeScript strict mode
- ESLint + Prettier formatting
- Conventional commits (enforced by commitlint)
- Signal-based state management (no RxJS BehaviorSubject)
- Standalone Angular components (no NgModules)

## Pull Request Guidelines

- Keep PRs focused on a single concern
- Include a clear description of what and why
- Ensure all quality gates pass
- Add tests for new functionality

## License

Ptah is licensed under the [Functional Source License, Version 1.1, MIT Future License](LICENSE.md) (FSL-1.1-MIT). This is a Fair Source license that protects against harmful free-riding while converting to full MIT open source after two years.

By submitting a pull request or otherwise contributing to this repository, you agree that your contributions will be licensed under the same FSL-1.1-MIT license that covers the project. You also represent that you have the right to submit the contribution and that it does not violate any third-party rights.

We do not require a formal Contributor License Agreement (CLA). The "inbound = outbound" principle applies: contributions are made under the same terms as the project license.
