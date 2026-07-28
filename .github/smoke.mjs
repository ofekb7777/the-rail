// Opens the app in a real browser and fails if it does not come up clean.
//
// The app is one file that builds every view at runtime, so "does it parse"
// proves nothing -- a wardrobe that throws while drawing the Stats tab still
// serves a perfectly valid HTML file. The only honest check is to load it,
// visit each tab, and insist that nothing was logged as an error and that
// every view actually rendered something.
//
// Served over http://localhost rather than file:// because the app treats
// those differently on purpose: the service worker only registers on a real
// origin, and file:// would skip the code path users actually get.

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 8111;
const BASE = `http://localhost:${PORT}`;
const TABS = ['today', 'wardrobe', 'plan', 'stats', 'saved'];

// python's server rather than the repo's serve.pl: serve.pl handles one
// request per connection by design, and a browser opening the page, the
// service worker and the manifest at once would queue behind each other.
const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
  stdio: 'ignore',
});

const failures = [];
let browser;

try {
  await waitForServer();

  browser = await chromium.launch();
  const page = await browser.newPage();

  // Only the app's own failures count. The weather lookup and the webfont are
  // third-party and the app is built to degrade without them, so a runner
  // without network to those hosts must not turn the build red.
  const ours = (url) => !url || url.startsWith(BASE);

  page.on('pageerror', (err) => failures.push(`uncaught: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (!ours(msg.location()?.url)) return;
    failures.push(`console.error: ${msg.text()}`);
  });
  page.on('requestfailed', (req) => {
    // A failed request we serve ourselves means a 404 in the repo.
    if (ours(req.url())) failures.push(`request failed: ${req.url()}`);
  });

  await page.goto(`${BASE}/the-rail.html`, { waitUntil: 'load' });

  // The app boots asynchronously (IndexedDB), so wait for the first view
  // instead of assuming it is there the moment load fires.
  await page.waitForFunction(
    () => document.querySelector('#main')?.children.length > 0,
    { timeout: 15000 },
  );

  for (const tab of TABS) {
    await page.click(`.tabs button[data-tab="${tab}"]`);
    await page.waitForFunction(
      () => document.querySelector('#main')?.children.length > 0,
      { timeout: 10000 },
    );
    const rendered = await page.$eval('#main', (el) => el.children.length);
    if (rendered === 0) failures.push(`tab "${tab}" rendered nothing`);
  }

  // Naming the colour of a photographed garment is the one thing the app has
  // to get right before anything downstream means anything -- every outfit
  // suggestion is built on it. It broke once in a way no page error could
  // show: a garment small in its frame was reported as the colour of the
  // floor behind it, confidently and with the real colour absent from the
  // alternatives. So drive the real processPhoto over a range of sizes.
  await page.goto(`${BASE}/the-rail.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof processPhoto === 'function', { timeout: 15000 });
  const colourMisses = await page.evaluate(async () => {
    const shot = (hex, fill) => {
      const W = 640, c = document.createElement('canvas');
      c.width = c.height = W;
      const x = c.getContext('2d', { willReadFrequently: true });
      const g = x.createLinearGradient(0, 0, W, W);
      g.addColorStop(0, '#e2e2df'); g.addColorStop(1, '#cbcbc8');
      x.fillStyle = g; x.fillRect(0, 0, W, W);
      const S = 440, layer = document.createElement('canvas');
      layer.width = layer.height = S;
      DEMO_SHAPES.shoe(layer.getContext('2d'), hex, S, S, {});
      const side = Math.round(W * fill);
      x.drawImage(layer, Math.round((W - side) / 2), Math.round((W - side) / 2), side, side);
      return new Promise((res) => c.toBlob(
        (b) => res(new File([b], 's.png', { type: 'image/png' })), 'image/png'));
    };
    const missed = [];
    // 0.24 is a shoe on the floor photographed from standing height -- the
    // size that used to fail. 0.6 is the framing the in-app guidance asks for.
    for (const fill of [0.24, 0.6]) {
      for (const want of ['purple', 'green', 'red', 'blue']) {
        const r = await processPhoto(await shot(colorByName(want).hex, fill), true, false);
        const got = r.colors.length ? r.colors[0].name : '(nothing)';
        if (got !== want) missed.push(`${want} shoe at ${fill} of frame read as "${got}"`);
      }
    }
    return missed;
  });
  for (const m of colourMisses) failures.push(`colour: ${m}`);

  // The category guess reads the silhouette and is deliberately narrow: it
  // claims trousers and shoes and abstains on everything else. What must not
  // drift is the abstention -- a photographed jumper quietly filed as footwear
  // is the failure this feature exists to prevent, so false positives are the
  // thing under test, not coverage.
  const catMisses = await page.evaluate(async () => {
    const shot = (shape) => {
      const W = 640, c = document.createElement('canvas');
      c.width = c.height = W;
      const x = c.getContext('2d', { willReadFrequently: true });
      const g = x.createLinearGradient(0, 0, W, W);
      g.addColorStop(0, '#e2e2df'); g.addColorStop(1, '#cbcbc8');
      x.fillStyle = g; x.fillRect(0, 0, W, W);
      const S = 440, layer = document.createElement('canvas');
      layer.width = layer.height = S;
      DEMO_SHAPES[shape](layer.getContext('2d'), colorByName('navy').hex, S, S, {});
      const side = Math.round(W * 0.6);
      x.drawImage(layer, Math.round((W - side) / 2), Math.round((W - side) / 2), side, side);
      return new Promise((r) => c.toBlob((b) => r(new File([b], 's.png', { type: 'image/png' })), 'image/png'));
    };
    const EXPECT = {
      shoe: 'footwear', bottom: 'bottom',
      top: null, knit: null, outerwear: null, skirt: null, dress: null,
      sneaker: null, boot: null,
    };
    const missed = [];
    for (const shape of Object.keys(EXPECT)) {
      const r = await processPhoto(await shot(shape), true, false);
      if (r.category !== EXPECT[shape]) {
        missed.push(`a ${shape} was filed as "${r.category}" (expected ${EXPECT[shape] || 'no guess'})`);
      }
    }

    // An unanswered category has to actually stop the save. If this gate ever
    // stops holding, pieces go into the wardrobe with no idea what they are
    // and every suggestion built on them is quietly wrong.
    document.getElementById('addBtn').click();
    await handleIncomingFiles([await shot('shoe'), await shot('top')]);
    const btn = document.getElementById('saveBatchBtn');
    if (batchQueue[0].category !== 'footwear') missed.push('a clear shoe was not pre-filled in the queue');
    if (batchQueue[1].category !== '') missed.push('an ambiguous shape was given a category anyway');
    if (!btn.disabled) missed.push('the save was not blocked by an unanswered category');
    // and answering it must release the save
    const sel = document.querySelectorAll('.batch-item')[1].querySelector('.batch-cat');
    sel.value = 'top';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));
    if (btn.disabled) missed.push('answering the category did not release the save');
    resetDraft();
    document.getElementById('addOverlay').classList.remove('open');
    return missed;
  });
  for (const m of catMisses) failures.push(`category: ${m}`);

  // The laid-out view arranges a look head to foot. Order is the whole point
  // of it -- shoes above a coat is not a lay-out -- and it is decided by a
  // table that no other test touches.
  const layMisses = await page.evaluate(async () => {
    await loadDemoWardrobe();
    const pick = (c) => state.items.find((i) => i.category === c);
    const ids = ['outerwear', 'top', 'bottom', 'footwear'].map(pick).filter(Boolean).map((i) => i.id);
    state.flatLay = true;
    state.lastResult = { outfits: [{ itemIds: ids, title: 'T', percent: 80, pills: [] }] };
    state.activeOption = 0;
    state.tab = 'today';
    render();
    await new Promise((r) => setTimeout(r, 200));
    const missed = [];
    const fl = document.querySelector('.flatlay');
    if (!fl) return ['the laid-out view rendered nothing'];
    const rows = [...fl.querySelectorAll('.fl-row')].map((r) =>
      [...r.querySelectorAll('img')].map((img) => {
        const it = state.items.find((i) => i.name === img.alt);
        return it ? it.category : '?';
      }));
    const rank = { headwear: 1, outerwear: 2, dress: 2, top: 2, bottom: 3, footwear: 4 };
    const flat = rows.flat();
    for (let i = 1; i < flat.length; i++) {
      if ((rank[flat[i]] || 9) < (rank[flat[i - 1]] || 9)) {
        missed.push(`out of order: ${flat[i - 1]} above ${flat[i]}`);
      }
    }
    if (!rows.some((r) => r.length === 2)) missed.push('outerwear and top did not share a row');
    // and the toggle has to get back to the grid
    document.querySelector('.lay-btn[data-lay="grid"]').click();
    await new Promise((r) => setTimeout(r, 200));
    if (!document.querySelector('.lookbook')) missed.push('could not switch back to the grid');
    return missed;
  });
  for (const m of layMisses) failures.push(`laid out: ${m}`);

  // index.html is the entry point a static host lands on; if its redirect
  // breaks, the live site is a blank page however healthy the app is.
  const entry = await page.goto(`${BASE}/`, { waitUntil: 'load' });
  if (!entry.ok()) failures.push(`entry point returned ${entry.status()}`);
  await page.waitForURL(/the-rail\.html/, { timeout: 10000 }).catch(() => {
    failures.push('index.html did not redirect to the app');
  });
} catch (err) {
  failures.push(err.message);
} finally {
  await browser?.close();
  server.kill();
}

if (failures.length > 0) {
  console.error('Smoke test failed:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`Smoke test passed: app booted, ${TABS.length} tabs rendered, entry point redirects.`);

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${BASE}/the-rail.html`, { method: 'HEAD' });
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('static server never came up');
}
