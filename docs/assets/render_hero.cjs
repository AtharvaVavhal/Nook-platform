const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  // reduced motion pins the SVG to its authored state, which is the still we want
  const ctx = await b.newContext({
    viewport: { width: 1200, height: 470 },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  });
  const pg = await ctx.newPage();
  await pg.setContent(
    `<!doctype html><meta charset=utf-8>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>html,body{margin:0;background:#171338}img{display:block;width:1200px;height:470px}</style>
<img src="http://127.0.0.1:8731/readme-hero.svg">`,
    { waitUntil: 'networkidle' },
  );
  await pg.waitForTimeout(600);
  await pg.screenshot({ path: __dirname + '/readme-hero.png' });
  await b.close();
  console.log('wrote readme-hero.png (static fallback, 2400x940)');
})();
