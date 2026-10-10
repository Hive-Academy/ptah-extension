// Click through sessions in the sidebar list only (matched on the row's first line), then back.
module.exports = async (page) => {
  for (const n of ['claude', 'Task', 'test', 'claude', '2 Tasks']) {
    const ok = await page.evaluate((name) => {
      const b = [
        ...document.querySelectorAll('li.group.relative > button'),
      ].find(
        (x) => x.offsetParent && x.innerText.split('\n')[0].trim() === name,
      );
      if (b) b.click();
      return !!b;
    }, n);
    if (!ok) throw new Error(`row not found: ${n}`);
    await page.waitForTimeout(2500);
  }
};
