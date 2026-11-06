import { runWorkerCommand } from './lib/dispatch';

void runWorkerCommand(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
