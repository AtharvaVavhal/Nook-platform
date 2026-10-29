const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const svg = fs.readFileSync(__dirname + '/readme-banner.svg', 'utf8');
  const html = `<!doctype html><meta charset=utf-8>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>html,body{margin:0;padding:0;background:#171338}svg{display:block}</style>${svg}`;
  const b = await chromium.launch();
  for (const s of [1, 2]) {
    const pg = await b.newPage({
      viewport: { width: 1200, height: 380 },
      deviceScaleFactor: s,
    });
    await pg.setContent(html, { waitUntil: 'networkidle' });
    await pg.evaluate(() => document.fonts.ready);
    await pg.waitForTimeout(500);
    await pg.screenshot({
      path: __dirname + (s === 1 ? '/readme-banner.png' : '/readme-banner@2x.png'),
    });
    await pg.close();
  }
  await b.close();
  console.log('rendered 1x and 2x');
})();
