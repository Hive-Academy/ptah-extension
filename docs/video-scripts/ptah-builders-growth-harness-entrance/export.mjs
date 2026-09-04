import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function exportDeck() {
  const slidesDir = path.join(__dirname, 'slides');
  if (!fs.existsSync(slidesDir)) {
    fs.mkdirSync(slidesDir, { recursive: true });
  }

  console.log('Launching Chromium...');
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  const htmlPath = path.join(__dirname, 'index.html');
  const fileUrl = pathToFileURL(htmlPath).href;
  console.log(`Loading slide deck from: ${fileUrl}`);

  await page.goto(fileUrl, { waitUntil: 'networkidle' });

  // Ensure fonts are ready and images are loaded
  await page.evaluate(async () => {
    await document.fonts.ready;
    const images = Array.from(document.querySelectorAll('img'));
    await Promise.all(
      images.map(
        (img) =>
          new Promise((resolve) => {
            if (img.complete) return resolve();
            img.onload = resolve;
            img.onerror = resolve;
          })
      )
    );
  });

  await page.waitForTimeout(300);

  // The keyboard hint is for live presentation only; keep it out of the video assets.
  await page.addStyleTag({ content: '.nav-indicator { display: none !important; }' });

  // (a) Export PDF with preferCSSPageSize: true and printBackground: true
  const pdfPath = path.join(__dirname, 'entrance.pdf');
  console.log(`Generating PDF at: ${pdfPath}`);
  await page.pdf({
    path: pdfPath,
    preferCSSPageSize: true,
    printBackground: true,
  });
  console.log('PDF export completed.');

  // (b) Export PNG screenshots of each .slide element to slides/slide-01.png ... slide-NN.png
  const slides = page.locator('.slide');
  const count = await slides.count();
  console.log(`Found ${count} slides. Capturing 1920x1080 PNG screenshots...`);

  for (let i = 0; i < count; i++) {
    const slideNumber = String(i + 1).padStart(2, '0');
    const slideFileName = `slide-${slideNumber}.png`;
    const outputPath = path.join(slidesDir, slideFileName);

    const slideLocator = slides.nth(i);
    await slideLocator.scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);

    await slideLocator.screenshot({
      path: outputPath,
      type: 'png',
    });

    console.log(`Captured: ${slideFileName}`);
  }

  await browser.close();
  console.log('All exports completed successfully.');
}

exportDeck().catch((err) => {
  console.error('Export error:', err);
  process.exit(1);
});
