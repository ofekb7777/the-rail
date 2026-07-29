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
    if (!fl.querySelector('.fl-item[data-swap]')) missed.push('no piece was swappable from the lay-out');

    // Cutting a piece already in the wardrobe is what lets the lay-out read
    // as one: a photo still carrying its floor is a rectangle whatever it
    // sits next to. It has to work, and it has to be undoable.
    // The photo you took is the photo that is kept. Nothing in the app may
    // write over it -- that was a one-way change to the only copy in
    // existence, and on a busy background it mangled the piece. Checked by
    // reading a corner of what processPhoto hands back: the backdrop it was
    // shot on has a distinctive colour, and anything that cut the background
    // would have painted that corner white.
    const BACKDROP = [213, 207, 194];   // #d5cfc2
    const shot = await (async () => {
      const W = 400, c = document.createElement('canvas');
      c.width = c.height = W;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.fillStyle = '#d5cfc2'; x.fillRect(0, 0, W, W);
      const S = 440, layer = document.createElement('canvas');
      layer.width = layer.height = S;
      DEMO_SHAPES.top(layer.getContext('2d'), colorByName('navy').hex, S, S, {});
      x.drawImage(layer, W * 0.2, W * 0.2, W * 0.6, W * 0.6);
      return new Promise((r) => c.toBlob((b) => r(new File([b], 'p.png', { type: 'image/png' })), 'image/png'));
    })();
    const out = await processPhoto(shot);
    if (out.originalUrl !== undefined || out.cutApplied !== undefined) {
      missed.push('processPhoto still reports having edited the photo');
    }
    const back = await loadImageFromDataUrl(out.dataUrl);
    const bc = document.createElement('canvas');
    bc.width = back.naturalWidth; bc.height = back.naturalHeight;
    bc.getContext('2d').drawImage(back, 0, 0);
    const corner = bc.getContext('2d').getImageData(4, 4, 1, 1).data;
    const drift = Math.max(
      Math.abs(corner[0] - BACKDROP[0]),
      Math.abs(corner[1] - BACKDROP[1]),
      Math.abs(corner[2] - BACKDROP[2]));
    if (drift > 12) {
      missed.push(`the stored photo was altered - corner is rgb(${corner[0]},${corner[1]},${corner[2]}), shot on rgb(${BACKDROP})`);
    }

    // Isolation happens at display time only. It has to lift a garment off a
    // plain surface, and it has to refuse a cluttered one rather than guess.
    const mk = (paint) => {
      const c = document.createElement('canvas');
      c.width = c.height = 200;
      const x = c.getContext('2d', { willReadFrequently: true });
      paint(x);
      return c;
    };
    const plain = mk((x) => {
      x.fillStyle = '#d8d3c7'; x.fillRect(0, 0, 200, 200);      // a bedsheet
      x.fillStyle = '#2f3d66'; x.fillRect(55, 45, 90, 110);     // the garment
    });
    if (!isolateForLayout(plain)) missed.push('isolation refused a plain backdrop');
    else {
      const px = plain.getContext('2d').getImageData(0, 0, 200, 200).data;
      const at = (x, y) => px[(y * 200 + x) * 4 + 3];
      if (at(5, 5) !== 0) missed.push('the backdrop was not made transparent');
      if (at(100, 100) === 0) missed.push('isolation ate the garment');
    }
    const pale = mk((x) => {
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, 200, 200);      // a white sweep
      x.fillStyle = '#ececea'; x.fillRect(55, 45, 90, 110);     // a white shirt
    });
    if (isolateForLayout(pale)) {
      const px = pale.getContext('2d').getImageData(0, 0, 200, 200).data;
      if (px[(100 * 200 + 100) * 4 + 3] === 0) missed.push('isolation ate a white garment');
    }
    // A piece lying on a sheet casts a shadow onto it. The shadow is not the
    // sheet's colour, so without special handling the garment comes out with a
    // dark blob welded to it -- measured at 23% of the frame kept instead of
    // 13%. What must not happen while fixing that is eating a garment that is
    // simply a darker shade of the surface.
    const area = (c) => {
      const px = c.getContext('2d').getImageData(0, 0, 200, 200).data;
      let n = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] > 128) n++;
      return n;
    };
    const sheet = (withShadow, garment) => mk((x) => {
      x.fillStyle = '#d5cfc2'; x.fillRect(0, 0, 200, 200);
      if (withShadow) {
        x.save();
        x.globalAlpha = 0.3; x.filter = 'blur(9px)'; x.fillStyle = '#000';
        // clear of the garment, or removing it changes no area at all
        x.beginPath(); x.ellipse(100, 172, 78, 24, 0, 0, 7); x.fill();
        x.restore();
      }
      x.fillStyle = garment; x.fillRect(55, 45, 90, 110);
    });
    const clean = sheet(false, '#2f3d66');
    const shadowed = sheet(true, '#2f3d66');
    if (isolateForLayout(clean) && isolateForLayout(shadowed)) {
      const grew = area(shadowed) / Math.max(1, area(clean));
      if (grew > 1.25) missed.push(`a cast shadow was kept with the garment (${Math.round(grew * 100)}% of the clean area)`);
    } else {
      missed.push('isolation refused a garment on a plain sheet');
    }
    // brown on tan: the surface dimmed and a real garment look identical, so
    // the shadow rule must stay narrow enough to leave this one alone.
    const brownOnTan = mk((x) => {
      x.fillStyle = '#c9a97e'; x.fillRect(0, 0, 200, 200);
      x.fillStyle = '#6b4a30'; x.fillRect(55, 45, 90, 110);
    });
    if (isolateForLayout(brownOnTan)) {
      const px = brownOnTan.getContext('2d').getImageData(0, 0, 200, 200).data;
      if (px[(100 * 200 + 100) * 4 + 3] === 0) missed.push('a dark garment on a similar surface was eaten as shadow');
    } else {
      missed.push('isolation refused a brown piece on a tan sheet');
    }

    const busy = mk((x) => {
      x.fillStyle = '#b9b2a6'; x.fillRect(0, 0, 200, 90);
      x.fillStyle = '#7d6a52'; x.fillRect(0, 90, 200, 110);
      x.fillStyle = '#2a2a30'; x.fillRect(0, 0, 40, 200);
      x.fillStyle = '#8f5f4a'; x.fillRect(150, 140, 50, 60);
    });
    if (isolateForLayout(busy)) missed.push('isolation touched a cluttered photo instead of leaving it alone');
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
