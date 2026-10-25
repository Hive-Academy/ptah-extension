| Case                  | Status                                       | Charged turns |
| --------------------- | -------------------------------------------- | ------------: |
| schema-handshake      | schema only                                  |             0 |
| ask-command-deny      | observed                                     |             1 |
| ask-command-edit      | failed: protocol, isolation or approval gate |             1 |
| modified-input-schema | schema only                                  |             0 |
| file-change-accept    | not run: prior gate or usage bound           |             0 |
| plan-read-only        | not run: prior gate or usage bound           |             0 |
| auto-edit-boundary    | not run: prior gate or usage bound           |             0 |
| yolo-interrupt        | not run: prior gate or usage bound           |             0 |
| mcp-approval          | not run: prior gate or usage bound           |             0 |

Total: 2/7. Observed usage: 11687. Usage bounds: 15000 per turn, 100000 cumulative. Cleanup: home/auth deleted; experiment deleted.
