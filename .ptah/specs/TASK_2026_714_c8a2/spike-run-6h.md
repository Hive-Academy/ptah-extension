| Case                  | Status                                       | Charged turns |
| --------------------- | -------------------------------------------- | ------------: |
| schema-handshake      | schema only                                  |             0 |
| modified-input-schema | schema only                                  |             0 |
| file-change-accept    | observed                                     |             1 |
| plan-read-only        | observed                                     |             1 |
| auto-edit-boundary    | observed                                     |             1 |
| yolo-interrupt        | observed                                     |             1 |
| mcp-approval          | failed: protocol, isolation or approval gate |             1 |
| ask-command-edit      | not run: prior gate or usage bound           |             0 |
| ask-read-rule         | not run: prior gate or usage bound           |             0 |

Total: 5/8. Observed usage: 73584. Usage bounds: 15000 per turn, 100000 cumulative. Cleanup: home/auth deleted; experiment deleted.
