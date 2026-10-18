# Domain Library Layout

Load when organizing a domain layer into libraries. This is the Nx `libs/[domain]` layout for a NestJS domain, application, and infrastructure split with a feature edge (Angular or otherwise).

```text
libs/
├── [domain]/
│   ├── domain/                 # Core domain logic
│   │   └── src/lib/
│   │       ├── entities/       # Entities and aggregates
│   │       ├── value-objects/  # Value objects
│   │       ├── events/         # Domain events
│   │       ├── services/       # Domain services
│   │       └── repositories/   # Repository interfaces
│   │
│   ├── application/            # Use cases / application services
│   │   └── src/lib/
│   │       ├── commands/       # Command handlers
│   │       ├── queries/        # Query handlers
│   │       └── services/       # Application services
│   │
│   ├── infrastructure/         # Technical implementations
│   │   └── src/lib/
│   │       ├── persistence/    # Repository implementations
│   │       ├── messaging/      # Event publishing
│   │       └── external/       # External service adapters
│   │
│   └── feature/                # Controllers / presenters
│       └── src/lib/
│           └── controllers/
```
