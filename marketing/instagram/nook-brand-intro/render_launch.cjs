const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const svg = fs.readFileSync(__dirname + '/nook-instagram-launch-nov-4.svg', 'utf8');
  const html = `<!doctype html><meta charset=utf-8>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>html,body{margin:0;padding:0;background:#171338}svg{display:block}</style>${svg}`;
  const b = await chromium.launch();
  const pg = await b.newPage({
    viewport: { width: 1080, height: 1920 },
    deviceScaleFactor: 1,
  });
  await pg.setContent(html, { waitUntil: 'networkidle' });
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForTimeout(600);
  await pg.screenshot({ path: __dirname + '/nook-instagram-launch-nov-4.png' });
  await b.close();
  console.log('rendered');
})();
