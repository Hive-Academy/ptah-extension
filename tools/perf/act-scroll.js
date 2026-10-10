// Scroll the visible transcript up and down with the mouse wheel.
module.exports = async (page) => {
  const box = await page.locator('ptah-chat-transcript').first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 25; i++) {
      await page.mouse.wheel(0, -240);
      await page.waitForTimeout(30);
    }
    for (let i = 0; i < 25; i++) {
      await page.mouse.wheel(0, 240);
      await page.waitForTimeout(30);
    }
  }
};
