// Samples the animated hero at points around its loop, so the animation can be
// inspected rather than assumed. Serve this directory first:
//   python3 -m http.server 8731
// then:  node sample_hero.cjs [outputDir]
const { chromium } = require('playwright');

const OUT = process.argv[2] || '.';
const SRC = 'http://127.0.0.1:8731/readme-hero.svg';
const TIMES = [0, 1500, 3200, 5200, 7500, 9500];

(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1200, height: 470 } });
  await pg.setContent(
    `<!doctype html><meta charset=utf-8>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>html,body{margin:0;background:#171338}img{display:block;width:1200px;height:470px}</style>
<img src="${SRC}">`,
    { waitUntil: 'networkidle' },
  );

  const loaded = await pg.evaluate(() => {
    const i = document.images[0];
    return { complete: i.complete, w: i.naturalWidth, h: i.naturalHeight };
  });
  if (!loaded.complete || !loaded.w) {
    throw new Error(`hero failed to load: ${JSON.stringify(loaded)}`);
  }
  console.log('image load:', JSON.stringify(loaded));

  let elapsed = 0;
  for (const t of TIMES) {
    await pg.waitForTimeout(Math.max(120, t - elapsed));
    elapsed = t;
    await pg.screenshot({ path: `${OUT}/hero-t${t}.png` });
    console.log(`sampled t=${t}ms`);
  }
  await b.close();
})();
