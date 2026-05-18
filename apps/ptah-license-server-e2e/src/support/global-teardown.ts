import { killPort } from '@nx/node/utils';
/* eslint-disable */

module.exports = async function () {
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await killPort(port);
  console.log(globalThis.__TEARDOWN_MESSAGE__);
};
