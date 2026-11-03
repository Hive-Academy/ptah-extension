# Clean Architecture vs Vertical Slices — Full Comparison

Both shapes are legitimate answers to "how do I organize a bounded context's projects." Neither is more "correct" than the other; they trade off differently, and the trade-off is the thing to get the user to actually decide (via `dotnet-solution-initializer` Round 2 / Step a2), not something to default silently.

## What each shape optimizes for

|               | Clean Architecture (layered)                                                                          | Vertical slices (feature-folder)                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Optimizes for | Protecting domain invariants over a long-lived codebase                                               | Shipping a feature fast, end to end                                                                                                                 |
| Cost          | More projects, more ceremony per feature (touch 3-4 projects to add one endpoint)                     | Weaker enforcement of "domain logic never touches infrastructure directly"                                                                          |
| Best when     | The bounded context has real business rules with edge cases worth protecting in tests                 | The bounded context is mostly CRUD, orchestration, or a thin proxy over another service                                                             |
| Team fit      | Teams that already think in layers (controller/service/repository) adapt fastest                      | Teams shipping features weekly who find layer-hopping for a one-line change frustrating                                                             |
| Test story    | Domain and Application layers are testable with zero infrastructure; that is close to the whole point | Each feature slice is testable in isolation, but domain logic close to infrastructure is easier to test incorrectly (against a real DB) by accident |

## Shared kernel and cross-context contracts

Both shapes need an answer to "how does bounded context A reference a stable type owned by bounded context B without referencing B's internals." The answer is the same in both shapes: a **contracts project**, referenced by both A and B, containing only:

- Public value objects/DTOs meant for cross-context consumption (never entities)
- Integration event contracts (if the domain module phase in the roadmap includes cross-context events)
- Interfaces one context exposes for another to implement or call against

```
src/
  Contoso.Shared.Contracts/     # referenced by every bounded context, references nothing
  Contoso.Orders.*/             # Clean Architecture layers, or a single vertical-slices project
  Contoso.Inventory.*/
```

Keep `Contoso.Shared.Contracts` deliberately thin. The moment it grows business logic, it has become an undeclared bounded context of its own and needs the same `ddd-architecture` treatment as any other.

## Worked example: Clean Architecture, "Orders" bounded context

```
src/
  Contoso.Orders.Domain/
    Order.cs                    # entity, invariants enforced in constructor/methods
    OrderLine.cs
    OrderPlaced.cs               # domain event
  Contoso.Orders.Application/
    PlaceOrder/
      PlaceOrderCommand.cs
      PlaceOrderHandler.cs       # depends on IOrderRepository (interface defined here)
  Contoso.Orders.Infrastructure/
    OrderRepository.cs           # implements IOrderRepository using EF Core
    OrdersDbContext.cs
  Contoso.Orders.Api/
    OrdersController.cs          # or a minimal API endpoint group
    Program.cs                   # DI wiring: binds IOrderRepository -> OrderRepository
tests/
  Contoso.Orders.Domain.Tests/       # no infrastructure references
  Contoso.Orders.Application.Tests/  # mocks IOrderRepository
  Contoso.Orders.Infrastructure.Tests/
```

## Worked example: vertical slices, "Inventory" bounded context

```
src/
  Contoso.Inventory/
    Features/
      AdjustStock/
        AdjustStockCommand.cs
        AdjustStockHandler.cs      # talks to EF Core directly -- no separate infrastructure project
        AdjustStockEndpoint.cs
      GetStockLevel/
        GetStockLevelQuery.cs
        GetStockLevelHandler.cs
        GetStockLevelEndpoint.cs
    InventoryDbContext.cs
    Program.cs
tests/
  Contoso.Inventory.Tests/
    Features/
      AdjustStock/AdjustStockHandlerTests.cs
      GetStockLevel/GetStockLevelHandlerTests.cs
```

Notice what vertical slices gives up: `AdjustStockHandler` talks to `InventoryDbContext` directly, so a unit test either mocks EF Core (awkward) or becomes an integration test against a real/in-memory database. That is the trade-off the "shared kernel" row above does not solve -- it is intrinsic to the shape, and it is fine as long as the team chose it knowingly.

## Mixing shapes across contexts

Choosing vertical slices for `Contoso.Inventory` and Clean Architecture for `Contoso.Orders` in the same solution is correct when `Inventory` is genuinely CRUD-shaped and `Orders` genuinely has business rules worth protecting. What is not correct: mixing the two shapes **within** one bounded context's projects -- that produces a layout with no consistent rule for where new code goes, which is the exact problem both shapes exist to prevent.
