| Case                  | Status                                       | Charged turns |
| --------------------- | -------------------------------------------- | ------------: |
| schema-handshake      | schema only                                  |             0 |
| modified-input-schema | schema only                                  |             0 |
| ask-command-edit      | failed: protocol, isolation or approval gate |             1 |
| file-change-accept    | not run: prior gate or usage bound           |             0 |
| plan-read-only        | not run: prior gate or usage bound           |             0 |
| auto-edit-boundary    | not run: prior gate or usage bound           |             0 |
| yolo-interrupt        | not run: prior gate or usage bound           |             0 |
| mcp-approval          | not run: prior gate or usage bound           |             0 |
| ask-read-rule         | not run: prior gate or usage bound           |             0 |

Total: 1/8. Observed usage: 0. Usage bounds: 15000 per turn, 100000 cumulative. Cleanup: home/auth deleted; experiment deleted.
