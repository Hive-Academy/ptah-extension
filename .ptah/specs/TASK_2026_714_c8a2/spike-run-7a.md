| Case                     | Status                                       | Charged turns |
| ------------------------ | -------------------------------------------- | ------------: |
| schema-handshake         | schema only                                  |             0 |
| modified-input-schema    | schema only                                  |             0 |
| subagent-and-rewind      | schema only                                  |             0 |
| different-home-isolation | failed: protocol, isolation or approval gate |             1 |
| always-allow-scope       | not run: prior gate or usage bound           |             0 |
| same-home-isolation      | not run: prior gate or usage bound           |             0 |

Total: 1/6. Observed usage: 0. Usage bounds: 30000 per turn, 100000 cumulative. Cleanup: home/auth deleted; experiment deleted.
