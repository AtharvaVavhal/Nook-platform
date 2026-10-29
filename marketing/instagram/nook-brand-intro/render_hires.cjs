const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const scale = Number(process.argv[2] || 2);
  const stem = process.argv[3] || 'nook-instagram-launch-nov-4';
  const svg = fs.readFileSync(`${__dirname}/${stem}.svg`, 'utf8');
  const html = `<!doctype html><meta charset=utf-8>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>html,body{margin:0;padding:0;background:#171338}svg{display:block}</style>${svg}`;
  const b = await chromium.launch();
  const pg = await b.newPage({
    viewport: { width: 1080, height: 1920 },
    deviceScaleFactor: scale,
  });
  await pg.setContent(html, { waitUntil: 'networkidle' });
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForTimeout(800);
  await pg.screenshot({ path: `${__dirname}/${stem}@${scale}x.png` });
  await b.close();
  console.log(`rendered ${stem}@${scale}x.png`);
})();
