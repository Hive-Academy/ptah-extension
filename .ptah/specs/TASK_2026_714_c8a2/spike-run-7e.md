| Case                  | Status                                       | Charged turns |
| --------------------- | -------------------------------------------- | ------------: |
| schema-handshake      | schema only                                  |             0 |
| modified-input-schema | schema only                                  |             0 |
| subagent-and-rewind   | schema only                                  |             0 |
| resume-history        | failed: protocol, isolation or approval gate |             2 |
| profile-inputs        | not run: prior gate or usage bound           |             0 |

Total: 2/4. Observed usage: 23991. Usage bounds: 30000 per turn, 100000 cumulative. Cleanup: home/auth deleted; experiment deleted.
