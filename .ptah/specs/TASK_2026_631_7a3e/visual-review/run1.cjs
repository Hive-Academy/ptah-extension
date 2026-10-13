const { connect, gotoAnalytics, inject } = require('./lib.cjs');
(async () => {
  const { b, p } = await connect();
  await gotoAnalytics(p);
  console.log(await inject(p));
  console.log(await p.evaluate(() => ({ theme: document.documentElement.dataset.theme, ls: Object.keys(localStorage).filter((k) => /theme/i.test(k)), w: innerWidth })));
  await b.close();
})();
