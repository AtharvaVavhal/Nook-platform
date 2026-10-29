const { chromium } = require('playwright');
const fs = require('fs');
const FORGE = '/home/claude/nook/marketing/brand/forge';
const jobs = [
  ['FORGE-horizontal.svg', 'forge-lockup-light.png', 580, 120, 360], // ink, for light theme
  ['FORGE-horizontal-white-on-ink.svg', 'forge-lockup-dark.png', 580, 120, 360], // white, for dark theme
];
(async () => {
  const b = await chromium.launch();
  for (const [src, out, vw, vh, w] of jobs) {
    let svg = fs.readFileSync(`${FORGE}/${src}`, 'utf8');
    svg = svg.replace(/<rect width="580" height="120" fill="#17140F"\/>/, ''); // drop the plate
    const h = Math.round((w * vh) / vw);
    const pg = await b.newPage({
      viewport: { width: w, height: h },
      deviceScaleFactor: 2,
    });
    await pg.setContent(
      `<!doctype html><meta charset=utf-8>
<style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${w}px;height:${h}px}</style>${svg}`,
      { waitUntil: 'load' },
    );
    await pg.screenshot({ path: `${__dirname}/${out}`, omitBackground: true });
    await pg.close();
    console.log(out, `${w * 2}x${h * 2}`);
  }
  await b.close();
})();
