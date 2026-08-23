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
//
// A note for anyone running this by hand: `npx playwright install chromium` on
// the build machine fetches chrome-headless-shell, which is not the same binary
// as a local full Chromium and is not as fast. An assertion about an
// intermediate animation frame passed here and failed there for that reason
// alone. Nothing below should be timing-sensitive; if something has to be, stage
// the timing rather than race it.

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

  // Only the app's own failures count. The weather lookup is third-party and
  // the app is built to degrade without it, so a runner with no route to that
  // host must not turn the build red.
  //
  // The fonts used to be in that sentence too. They are served from beside the
  // app now, which means a missing one is a 404 in the repo and does turn the
  // build red -- correctly.
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

  // Pale clothes on a pale surface with a shadow under them. The four bold
  // hues above never caught this: a white shirt photographed on a white sheet
  // came back *grey*, and so did silver and beige, because the flood ate the
  // garment and left the shadow standing -- so the colour was read off the
  // shadow. Neutrals are most of a wardrobe, and "your white shirt is grey" is
  // the kind of wrong answer that discredits everything built on it.
  const shadowMisses = await page.evaluate(async () => {
    const shot = (hex, backdrop) => {
      const W = 560, c = document.createElement('canvas');
      c.width = c.height = W;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.fillStyle = backdrop; x.fillRect(0, 0, W, W);
      // a soft shadow cast onto the surface, clear of where the piece sits
      x.save();
      x.globalAlpha = 0.35; x.filter = 'blur(18px)'; x.fillStyle = '#000';
      x.beginPath(); x.ellipse(W * 0.5, W * 0.76, W * 0.34, W * 0.09, 0, 0, 7); x.fill();
      x.restore();
      const S = 400, l = document.createElement('canvas');
      l.width = l.height = S;
      DEMO_SHAPES.top(l.getContext('2d'), hex, S, S, {});
      const side = Math.round(W * 0.6);
      x.drawImage(l, Math.round((W - side) / 2), Math.round((W - side) / 2), side, side);
      return new Promise((r) => c.toBlob((b) => r(new File([b], 's.png', { type: 'image/png' })), 'image/png'));
    };
    const missed = [];
    for (const [want, backdrop, where] of [
      ['white', '#f4f4f2', 'a white sheet'],
      ['white', '#d8d3c7', 'pale linen'],
      ['silver', '#d8d3c7', 'pale linen'],
      ['beige', '#d8d3c7', 'pale linen'],
      ['silver', '#f4f4f2', 'a white sheet'],
      // Cream on white is what pins the shadow rule's tolerance down. Cream
      // really is white slightly dimmed, so a loose rule eats it as shadow and
      // the shirt comes back white -- which is how a fix for one neutral turns
      // into a failure on the next one along. Measured: it fails at 18 and
      // passes at 11.
      ['cream', '#f4f4f2', 'a white sheet'],
      // and the other end, which must not regress while fixing the pale one
      ['black', '#d8d3c7', 'pale linen'],
      ['navy', '#f4f4f2', 'a white sheet'],
    ]) {
      const r = await processPhoto(await shot(colorByName(want).hex, backdrop));
      const got = r.colors.length ? r.colors[0].name : '(nothing)';
      if (got !== want) missed.push(`${want} on ${where} with a shadow read as "${got}"`);
    }
    return missed;
  });
  for (const m of shadowMisses) failures.push(`colour: ${m}`);

  // Every colour test above uses a square PNG. A phone produces neither: it
  // produces a tall JPEG, and the piece is a smaller share of a tall frame at
  // the same distance. Beige on pale linen read "silver" in portrait, in
  // landscape, and at every JPEG quality, while being correct in the square
  // renders next to it -- so the shape of the frame was the whole difference,
  // and nothing in the suite was looking at it.
  const frameMisses = await page.evaluate(async () => {
    const shot = (hex, backdrop, W, H, q) => {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.fillStyle = backdrop; x.fillRect(0, 0, W, H);
      x.save();
      x.globalAlpha = 0.35; x.filter = 'blur(18px)'; x.fillStyle = '#000';
      x.beginPath(); x.ellipse(W * 0.5, H * 0.76, W * 0.30, H * 0.07, 0, 0, 7); x.fill();
      x.restore();
      const S = 400, l = document.createElement('canvas');
      l.width = l.height = S;
      DEMO_SHAPES.top(l.getContext('2d'), hex, S, S, {});
      const side = Math.round(Math.min(W, H) * 0.62);
      x.drawImage(l, Math.round((W - side) / 2), Math.round((H - side) / 2), side, side);
      const type = q ? 'image/jpeg' : 'image/png';
      return new Promise((r) => c.toBlob((b) => r(new File([b], 's', { type })), type, q || undefined));
    };
    const missed = [];
    for (const [label, W, H, q] of [
      ['portrait 3:4', 480, 640, null],
      ['landscape 4:3', 640, 480, null],
      ['tall 9:16', 420, 746, null],
      ['portrait JPEG q0.76', 480, 640, 0.76],
      ['portrait JPEG q0.6', 480, 640, 0.6],
    ]) {
      for (const want of ['beige', 'navy', 'white', 'red']) {
        const r = await processPhoto(await shot(colorByName(want).hex, '#d8d3c7', W, H, q));
        const got = r.colors.length ? r.colors[0].name : '(nothing)';
        if (got !== want) missed.push(`${want} in a ${label} frame read as "${got}"`);
      }
    }
    return missed;
  });
  for (const m of frameMisses) failures.push(`colour: ${m}`);

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
    // These are drawing names, not categories -- there are only four of those
    // now. What is under test is unchanged: the guess claims trousers and
    // shoes, and abstains on anything worn on the torso.
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
    // Rows used to hold outerwear beside a top. With four categories there is
    // one garment per row, so what matters is that each row has something and
    // the order runs head to foot.
    if (!rows.length) missed.push('the lay-out produced no rows');
    if (!fl.querySelector('.fl-item[data-swap]')) missed.push('no piece was swappable from the lay-out');

    // Pieces sit at a slight angle so the lay-out reads as cloth on a bed
    // rather than a grid. The angle comes from the piece's own id: a look that
    // tilted differently every time it was drawn would be worse than one that
    // never tilted, so stability matters more here than the angle itself.
    const poses = () => [...fl.querySelectorAll('.fl-item')].map((e) => e.style.transform);
    const before2 = poses();
    if (!before2.length || before2.some((t) => !/rotate\(-?\d/.test(t))) {
      missed.push('pieces are not being angled');
    }
    if (new Set(before2).size < 2) missed.push('every piece was given the same pose');
    render();
    await new Promise((r) => setTimeout(r, 150));
    const after2 = [...document.querySelectorAll('.flatlay .fl-item')].map((e) => e.style.transform);
    if (JSON.stringify(before2) !== JSON.stringify(after2)) {
      missed.push('the angles changed on a re-render - they must be stable per piece');
    }

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

    // Footwear is small in its frame by nature. An earlier guard refused any
    // fill that took more than 93% of the frame on the grounds that it must
    // have eaten the garment -- which is also true of a shoe, so shoes were
    // refused outright while coats sailed through.
    const smallPiece = mk((x) => {
      x.fillStyle = '#d5cfc2'; x.fillRect(0, 0, 200, 200);
      x.fillStyle = '#5c1f2e'; x.fillRect(78, 92, 46, 22);   // ~2.5% of the frame
    });
    if (!isolateForLayout(smallPiece)) {
      missed.push('a small piece was refused - the shoe case');
    } else if (smallPiece.getContext('2d').getImageData(0, 0, 200, 200).data[(100 * 200 + 100) * 4 + 3] === 0) {
      missed.push('a small piece was isolated away to nothing');
    }

    // A photograph taken the way people actually take them: a garment put down
    // on a patterned bed, with the frame edge showing bedding, a pillow and a
    // cable. The border-based cut refuses this outright -- measured at 76
    // against a limit of 46 on a real photo -- and everything downstream used
    // to fail with it: the colour was read off the bedspread, no silhouette
    // meant no category, and the lay-out showed a rectangle of duvet.
    const onABed = mk((x) => {
      x.fillStyle = '#cfc9bd'; x.fillRect(0, 0, 200, 200);          // bedding
      x.fillStyle = '#7fa8bf'; x.fillRect(0, 0, 200, 18);           // a pillow at the top
      x.strokeStyle = 'rgba(0,0,0,0.10)'; x.lineWidth = 5;          // quilting
      for (let i = 0; i < 9; i++) { x.beginPath(); x.moveTo(i*26, 0); x.lineTo(i*26+30, 200); x.stroke(); }
      x.fillStyle = '#ffffff'; x.fillRect(0, 176, 60, 5);           // a cable
      x.fillStyle = '#232323'; x.fillRect(52, 40, 96, 118);         // the garment
    });
    const centre = subjectFromCentre(onABed);
    if (!centre) missed.push('a garment on a patterned bed was not found from the centre');
    else {
      // the mask marks background, so the middle of the garment must NOT be masked
      const w = onABed.width;
      if (centre.mask[100 * w + 100]) missed.push('the centre detector masked the garment itself');
      if (!centre.mask[4 * w + 4]) missed.push('the centre detector kept the bedding');
    }

    // The case that cost a fifth of a real shirt. The garment is lit from one
    // side, so its far edge is mid-grey rather than black -- and the frame's
    // corner holds a second dark garment, which makes "dark" a legitimate
    // backdrop colour. The shaded half of the piece then matches the backdrop
    // better than it matches its own middle, and is cut away.
    const shadedWithClutter = mk((x) => {
      x.fillStyle = '#cfc9bd'; x.fillRect(0, 0, 200, 200);        // the bed
      x.fillStyle = '#4a4a52'; x.fillRect(150, 0, 50, 42);        // another dark piece, in shot
      const g = x.createLinearGradient(46, 0, 154, 0);            // the garment, lit from the left
      g.addColorStop(0, '#1c1c20'); g.addColorStop(1, '#57575f');
      x.fillStyle = g; x.fillRect(46, 58, 108, 104);
    });
    const shaded = subjectFromCentre(shadedWithClutter);
    if (!shaded) missed.push('a side-lit garment with clutter in the corner was not found at all');
    else {
      const w2 = shadedWithClutter.width;
      // its shaded edge must survive, not just its black middle
      if (shaded.mask[110 * w2 + 148]) missed.push('the shaded side of the garment was cut away');
      if (shaded.mask[110 * w2 + 60]) missed.push('the lit side of the garment was cut away');
      if (!shaded.mask[110 * w2 + 8]) missed.push('the bedding was kept');
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

  // Cutting by hand. This replaced an 18 MB segmentation model, so the bar is
  // not "the brushes draw something" -- it is that a person with a finger can
  // reach the same two outcomes the model was carried for: a clean silhouette
  // on a photograph the arithmetic cannot read, and the right colour off it.
  //
  // The fixture is a garment of known extent on a plain surface, so every
  // assertion below is about a pixel whose correct answer is known in advance
  // rather than about the picture looking plausible.
  const handMisses = await page.evaluate(async () => {
    const missed = [];
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    const cv = document.createElement('canvas');
    cv.width = cv.height = 200;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#d8d3c7'; cx.fillRect(0, 0, 200, 200);
    cx.fillStyle = '#2f3d66'; cx.fillRect(55, 45, 90, 110);   // 0.275-0.725 x, 0.225-0.775 y
    const kept = state.items.slice();
    const it = {
      id: 'handcut-test', name: 'Navy test top', category: 'top', color: 'navy',
      warmth: 3, formality: 3, createdAt: Date.now(), image: cv.toDataURL('image/png'),
    };
    state.items = [it];

    const done = () => {
      state.items = kept;
      _cut = null; _cutMode = 'erase';
      document.getElementById('detailOverlay').classList.remove('open');
      return [...new Set(missed)];
    };

    openDetail(it.id);
    const stage0 = document.getElementById('markStage');
    if (!stage0) return done(['the sheet offered no stage to paint on']);
    for (let i = 0; i < 100 && stage0.getBoundingClientRect().height < 1; i++) await wait(50);
    if (stage0.getBoundingClientRect().height < 1) return done(['the photo never appeared to paint on']);

    // The stage must already be showing the cut when the sheet opens. A panel
    // that needs a button pressed before it does anything is the thing this
    // replaced.
    await wait(500);
    if (!document.getElementById('markStage').classList.contains('cutting')) {
      missed.push('the sheet opened without showing the cut, so there is nothing to correct');
    }
    if (!_cut || _cut.id !== it.id) return done(['opening the sheet opened no painting session']);

    // Two directions for the brush and nothing else. The width picker and the
    // undo are staying gone, and that is the kind of thing that quietly grows
    // back, so it is asserted rather than trusted.
    const modes = document.querySelectorAll('.mark-panel [data-cut-mode]');
    if (modes.length !== 2) missed.push(`the panel offers ${modes.length} brush directions, not 2`);
    const strays = document.querySelectorAll('.mark-panel [data-cut-tool], .mark-panel [data-cut-size], .mark-panel #cutUndoBtn');
    if (strays.length) missed.push(`the width picker or undo grew back (${strays.length} button(s))`);

    const at = (fx, fy) => {
      const r = document.getElementById('markStage').getBoundingClientRect();
      return {
        clientX: r.left + r.width * fx, clientY: r.top + r.height * fy,
        pointerId: 1, bubbles: true,
      };
    };
    const paint = async (x0, y0, x1, y1) => {
      const el = document.getElementById('markStage');
      el.dispatchEvent(new PointerEvent('pointerdown', at(x0, y0)));
      for (let i = 1; i <= 6; i++) {
        const t = i / 6;
        el.dispatchEvent(new PointerEvent('pointermove', at(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)));
      }
      el.dispatchEvent(new PointerEvent('pointerup', at(x1, y1)));
      await wait(650);   // longer than the settle timer
    };
    // The mask is the thing under test, so it is read directly rather than
    // inferred from the preview -- the preview could be right while the stored
    // answer is wrong, which is the failure that would actually ship.
    const alphaAt = (fx, fy) => {
      const S = _cut.mask.width;
      const px = Math.min(S - 1, Math.floor(fx * S));
      const py = Math.min(S - 1, Math.floor(fy * S));
      return _cut.mask.getContext('2d', { willReadFrequently: true })
        .getImageData(px, py, 1, 1).data[3];
    };

    // The seed is the app's own answer, which on this photograph is a clean cut.
    // If that is not true the rest of the test is measuring the wrong thing.
    if (alphaAt(0.5, 0.5) < 128) missed.push('painting started from a mask with the garment already gone');
    if (alphaAt(0.04, 0.04) > 128) missed.push('painting started from a mask that had kept the backdrop');

    // One drag across the middle of the garment takes it out.
    await paint(0.40, 0.5, 0.60, 0.5);
    if (alphaAt(0.5, 0.5) > 128) missed.push('dragging over the garment left it in the mask');
    if (!it.handMask) missed.push('a stroke stored no mask on the piece');
    else {
      if (it.handMask.slice(0, 15) !== 'data:image/png;') missed.push('the stored mask is not a PNG');
      if (it.handMask.length > 60000) {
        missed.push(`a stored mask is ${Math.round(it.handMask.length / 1024)}KB, too much per piece`);
      }
      // Through storage and back. A mask that paints correctly and cannot be
      // restored is worth nothing -- this is the round trip the lay-out uses.
      const back = document.createElement('canvas');
      back.width = back.height = 200;
      const bx = back.getContext('2d');
      bx.fillStyle = '#2f3d66'; bx.fillRect(0, 0, 200, 200);
      if (!(await applyMaskPng(back, it.handMask))) missed.push('the stored mask could not be put back');
      else {
        const d = bx.getImageData(0, 0, 200, 200).data;
        const aa = (fx, fy) => d[((Math.floor(fy * 200) * 200) + Math.floor(fx * 200)) * 4 + 3];
        if (aa(0.5, 0.5) > 128) missed.push('restored from storage, the rubbed-out stroke came back');
        if (aa(0.5, 0.30) < 128) missed.push('restored from storage, the untouched garment was gone');
      }
    }

    // Bringing back, over the very pixels just rubbed out. This is the whole
    // reason the second button exists: without it one careless sweep across a
    // hem costs the entire mask, because reset is the only other way back.
    const bringBack = document.querySelector('[data-cut-mode="restore"]');
    if (!bringBack) missed.push('there is no way to bring anything back');
    else {
      bringBack.click();
      await wait(500);
      await paint(0.40, 0.5, 0.60, 0.5);
      if (alphaAt(0.5, 0.5) < 128) missed.push('bringing back over what was rubbed out did not return it');
      // and it must not be a reset in disguise -- the backdrop stays gone
      if (alphaAt(0.04, 0.04) > 128) missed.push('bringing back returned the backdrop as well');
      // back to rubbing out for the checks below
      document.querySelector('[data-cut-mode="erase"]').click();
      await wait(400);
      await paint(0.40, 0.5, 0.60, 0.5);
      if (alphaAt(0.5, 0.5) > 128) missed.push('switching back to rub out left the brush bringing back');
    }

    // The panel has to admit what it now holds. The sheet is not rebuilt after a
    // stroke, so without this you can paint, look for the way back, and not find
    // one until you have closed the sheet and opened it again.
    const title = document.querySelector('.mark-panel .mark-title');
    if (!title || title.textContent !== 'Cut by hand') {
      missed.push(`after a stroke the panel still called itself "${title ? title.textContent : '(gone)'}"`);
    }
    if (!document.getElementById('clearMarkBtn')) {
      missed.push('after a stroke there was no way to reset without reopening the sheet');
    }

    // A second session picks up where the first left off rather than starting
    // from the app's guess -- otherwise reopening a piece silently discards the
    // work, which with no undo would be unrecoverable.
    _cut = null;
    openDetail(it.id);
    await wait(700);
    if (!_cut || _cut.id !== it.id) missed.push('reopening the sheet opened no session');
    else if (alphaAt(0.5, 0.5) > 128) missed.push('reopening the piece threw away what had been rubbed out');

    // Reset, which is the only way back and therefore has to work exactly.
    const over = document.getElementById('clearMarkBtn');
    if (!over) missed.push('a hand-cut piece offered no reset');
    else {
      over.click();
      await wait(600);
      if (it.handMask) missed.push('reset left the painted mask in place');
      if (document.getElementById('clearMarkBtn')) missed.push('reset left a reset button with nothing to reset');
      const t2 = document.querySelector('.mark-panel .mark-title');
      if (t2 && t2.textContent === 'Cut by hand') missed.push('reset left the panel still claiming a hand cut');
    }

    return done();
  });
  for (const m of handMisses) failures.push(`cutting by hand: ${m}`);

  // Choosing which colour relationship the stylist leads with. Three things
  // matter, and the middle one is the whole design.
  const harmonyMisses = await page.evaluate(async () => {
    const missed = [];
    const kept = state.items.slice();
    const wasPref = state.harmony;

    // a wardrobe with a genuinely complementary pair in it and a tonal one
    const mk = (name, cat, color) => ({
      id: name.replace(/\W/g, ''), name, category: cat, color,
      warmth: 3, formality: 3, tags: [], image: null, createdAt: Date.now(),
    });
    state.items = [
      mk('Blue shirt', 'top', 'blue'), mk('Orange tee', 'top', 'orange'),
      mk('Grey knit', 'top', 'grey'), mk('Green shirt', 'top', 'green'),
      mk('Charcoal trousers', 'bottom', 'charcoal'), mk('Blue jeans', 'bottom', 'blue'),
      mk('Purple cords', 'bottom', 'purple'),
      mk('Black boots', 'footwear', 'black'), mk('White trainers', 'footwear', 'white'),
    ];

    const scoreOf = (a, b) => {
      state.harmony = 'auto';
      const auto = colourScore([a, b]).score;
      state.harmony = harmonyBetween(a.color, b.color).rule;
      const lifted = colourScore([a, b]).score;
      return { auto, lifted };
    };

    // 1. preferring a relationship lifts the looks that achieve it
    const dull = state.items.find((i) => i.color === 'grey');
    const dark = state.items.find((i) => i.color === 'charcoal');
    const pairRule = harmonyBetween(dull.color, dark.color).rule;
    const s1 = scoreOf(dull, dark);
    if (!(s1.lifted > s1.auto)) {
      missed.push(`preferring "${pairRule}" did not lift a pair that achieves it (${s1.auto} -> ${s1.lifted})`);
    }

    // 2. and nothing else is marked down. The same number becomes the percentage
    //    a look is shown with, so demoting the rest would drop every score on
    //    screen and read as the app having got worse.
    const blue = state.items.find((i) => i.color === 'blue' && i.category === 'top');
    const orange = state.items.find((i) => i.color === 'orange');
    state.harmony = 'auto';
    const otherAuto = colourScore([blue, orange]).score;
    state.harmony = 'Tonal';                       // something that pair is not
    const otherPref = colourScore([blue, orange]).score;
    if (otherPref < otherAuto - 0.001) {
      missed.push(`preferring another rule marked an unrelated pair down, ${otherAuto} -> ${otherPref}`);
    }

    // 3. taste must not change what counts as a workable outfit, because the
    //    counts in Stats are built on that and "156 looks" cannot depend on a
    //    dropdown
    // Every rule, not three chosen by hand. An earlier version of this named
    // three that none of the fixture's pairs happened to use, so lifting them
    // changed nothing and the check passed with the boundary wide open.
    const trio = [blue, state.items.find((i) => i.category === 'bottom' && i.color === 'charcoal'),
      state.items.find((i) => i.color === 'black')];
    state.harmony = 'auto';
    const worksAuto = comboWorks(trio);
    const countAuto = countGoodLooks(null);
    // the fixture has to contain weak pairings, or lifting a rule cannot push
    // anything over the bar and there is nothing here to detect
    const rulesPresent = {};
    for (let i = 0; i < state.items.length; i++) {
      for (let j = i + 1; j < state.items.length; j++) {
        rulesPresent[harmonyBetween(state.items[i].color, state.items[j].color).rule] = true;
      }
    }
    const weak = Object.keys(rulesPresent).filter((r) => (HARMONY_SCORE[r] || 1) < 3.2);
    if (!weak.length) {
      missed.push('the fixture wardrobe has no weak pairings, so a leak into the counts could not show');
    }
    for (const r of HARMONY_RULES) {
      state.harmony = r.v;
      if (comboWorks(trio) !== worksAuto) {
        missed.push(`preferring "${r.v}" changed whether a look works at all`);
      }
      const now = countGoodLooks(null);
      if (now !== countAuto) {
        missed.push(`preferring "${r.v}" changed the number of workable looks, ${countAuto} -> ${now}`);
      }
    }

    // 4. a preference that the wardrobe cannot deliver says so rather than
    //    silently doing nothing
    state.harmony = 'Triadic';
    const reach = harmonyReach();
    if (!reach) missed.push('a chosen rule reported nothing about whether the wardrobe can make it');

    // 5. and a junk value out of a hand-edited backup must not be trusted
    state.harmony = 'auto';
    state.items = kept;
    state.harmony = wasPref;
    return [...new Set(missed)];
  });
  for (const m of harmonyMisses) failures.push(`colour matching: ${m}`);

  // The picker itself, and that a nonsense stored value is refused on load.
  const harmonyUi = await page.evaluate(async () => {
    const missed = [];
    const wasPref = state.harmony;
    state.tab = 'settings';
    if (typeof renderSettingsBody === 'function') renderSettingsBody();
    await new Promise((r) => setTimeout(r, 200));
    const sel = document.getElementById('harmonySelect');
    if (!sel) return ['Settings offers no colour-matching picker'];
    // automatic, plus one option per rule
    if (sel.options.length !== HARMONY_RULES.length + 1) {
      missed.push(`the picker lists ${sel.options.length} options for ${HARMONY_RULES.length} rules plus automatic`);
    }
    if (sel.options[0].value !== 'auto') missed.push('automatic is not the first option');

    sel.value = 'Complementary';
    sel.onchange();
    await new Promise((r) => setTimeout(r, 300));
    if (state.harmony !== 'Complementary') missed.push('choosing a rule did not take');

    // Put the state back but do *not* render. Rendering Today here starts
    // building a cut-out for every piece in the wardrobe, and that work carries
    // on in the background into whatever runs next -- which is exactly how this
    // block starved the cut-switch test of its 2500ms. The next test sets the
    // tab and renders for itself.
    state.harmony = wasPref;
    state.tab = 'today';
    return [...new Set(missed)];
  });
  for (const m of harmonyUi) failures.push(`colour matching: ${m}`);

  // How a gesture ends. Both the sheet and the deck used to judge a swipe by
  // its average speed -- total distance over total duration -- which gets the
  // one case that matters backwards: flick a sheet down, then hold still
  // because you have changed your mind, and the average is still high, so it
  // leaves anyway. You told it to stop and it went.
  //
  // Real timing rather than faked timestamps, because the whole fix is about
  // when events actually happened.
  const gestureMisses = await page.evaluate(async () => {
    const missed = [];
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const overlay = document.getElementById('detailOverlay');
    const sheet = overlay.querySelector('.sheet');
    if (!sheet) return ['no sheet to drag'];

    const touch = (el, y) => new Touch({ identifier: 1, target: el, clientX: 40, clientY: y });
    const fire = (type, y) => {
      const t = touch(sheet, y);
      sheet.dispatchEvent(new TouchEvent(type, {
        touches: type === 'touchend' ? [] : [t],
        changedTouches: [t], targetTouches: type === 'touchend' ? [] : [t],
        bubbles: true, cancelable: true,
      }));
    };
    const liveY = () => {
      const t = getComputedStyle(sheet).transform;
      if (!t || t === 'none') return 0;
      return new DOMMatrixReadOnly(t).m42;
    };
    // Wait for it to finish arriving. Starting a drag while the sheet is still
    // flying in begins it a couple of hundred pixels down, where it dismisses on
    // distance alone and the test says nothing about speed at all.
    const open = async () => {
      overlay.classList.add('open');
      sheet.style.transition = ''; sheet.style.transform = '';
      for (let i = 0; i < 40 && liveY() > 1; i++) await wait(25);
      if (liveY() > 1) missed.push('the sheet never settled, so these gestures start from the wrong place');
    };

    // --- flick, then change your mind and hold still ---
    await open();
    fire('touchstart', 100);
    for (let i = 1; i <= 5; i++) { fire('touchmove', 100 + i * 12); await wait(16); }
    await wait(260);                       // the pause: no move events fire
    fire('touchend', 160);
    await wait(60);
    const heldOn = overlay.classList.contains('open');
    if (!heldOn) {
      missed.push('a flick followed by a deliberate pause still dismissed the sheet');
    }
    overlay.classList.remove('open');

    // --- a slow drag that ends in a decisive flick ---
    await open();
    fire('touchstart', 100);
    for (let i = 1; i <= 4; i++) { fire('touchmove', 100 + i * 4); await wait(90); }  // dawdling
    for (let i = 1; i <= 4; i++) { fire('touchmove', 116 + i * 16); await wait(16); } // then gone
    fire('touchend', 180);
    await wait(80);
    if (overlay.classList.contains('open')) {
      missed.push('a slow drag ending in a flick did not dismiss the sheet');
    }
    overlay.classList.remove('open');
    sheet.style.transition = ''; sheet.style.transform = '';

    // --- catching one on its way back ---
    // Released short of the bar, the sheet springs home. Grabbing it mid-flight
    // has to pick it up where it looks, not snap it to the top first.
    //
    // The flight is staged rather than produced by a real release. Doing it the
    // other way means racing the app's own 340ms ease and reading it at the
    // right instant, which passed here and failed on the build machine -- an
    // assertion about an intermediate frame is decided by how loaded the box is,
    // not by whether the code is right. A three-second linear return has a
    // window nothing can lose, and it exercises the same three lines: read where
    // it is, pin it there, take the easing off.
    await open();
    sheet.style.transition = 'none';
    sheet.style.transform = 'translateY(80px)';
    void sheet.offsetHeight;                       // commit the start
    // Six seconds rather than three. This suite shares one page, and work done
    // by earlier blocks can starve a timer badly -- a 150ms wait was once
    // measured taking 1.6s, which walked a three-second ramp most of the way
    // home before the assertion ran. The ramp only has to outlast the worst
    // stall; nothing here is measuring how long anything takes.
    sheet.style.transition = 'transform 6000ms linear';
    sheet.style.transform = 'translateY(0px)';     // now heading home, slowly
    await wait(150);
    const midY = liveY();
    if (!(midY > 25 && midY < 80)) {
      missed.push(`staging a slow return did not work: the sheet sat at ${Math.round(midY)} rather than partway`);
    } else {
      fire('touchstart', 300);
      const caught = liveY();
      if (caught < midY - 12) {
        missed.push(`grabbing the returning sheet jumped it from ${Math.round(midY)} to ${Math.round(caught)}`);
      }
      // and it must have stopped travelling, not carried on under the finger
      await wait(120);
      const held = liveY();
      if (Math.abs(held - caught) > 6) {
        missed.push(`the caught sheet kept moving on its own, ${Math.round(caught)} to ${Math.round(held)}`);
      }
      fire('touchend', 300);
    }
    overlay.classList.remove('open');
    sheet.style.transition = ''; sheet.style.transform = '';

    // --- the reader itself, on the two shapes that matter ---
    const now = 1000;
    const still = [{ v: 0, t: 600 }, { v: 60, t: 700 }];
    if (velRead(still, now) !== 0) {
      missed.push('a history that stopped being updated did not read as still');
    }
    const moving = [{ v: 0, t: now - 60 }, { v: 60, t: now }];
    if (!(velRead(moving, now) > 0.5)) {
      missed.push(`a finger moving 60px in 60ms read as ${velRead(moving, now)}`);
    }

    return [...new Set(missed)];
  });
  for (const m of gestureMisses) failures.push(`gestures: ${m}`);

  // Evening the shading out. A piece shot with a window on one side comes out
  // half lit and half dark, and the lay-out then shows half a garment.
  //
  // The whole difficulty is that shading and a two-tone garment are the same
  // signal at low frequency, so a correction strong enough to flatten a shadow
  // is strong enough to merge a navy-and-white shirt into one grey. Both are
  // asserted here; the second is the one worth having.
  const evenMisses = await page.evaluate(() => {
    const missed = [];
    const W = 460;
    const build = (twoTone, shade) => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = W;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.fillStyle = '#6f6a60'; g.fillRect(0, 0, W, W);
      const im = g.getImageData(0, 0, W, W), dd = im.data;
      let s = 9;
      const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
      for (let i = 0; i < dd.length; i += 4) {
        const n = (rnd() - 0.5) * 16; dd[i] += n; dd[i + 1] += n; dd[i + 2] += n;
      }
      g.putImageData(im, 0, 0);
      const S = 380, l = document.createElement('canvas');
      l.width = l.height = S;
      const lx = l.getContext('2d');
      DEMO_SHAPES.top(lx, colorByName('white').hex, S, S, {});
      if (twoTone) {
        lx.save();
        lx.globalCompositeOperation = 'source-atop';
        lx.fillStyle = colorByName('navy').hex;
        lx.fillRect(0, 0, S / 2, S);
        lx.restore();
      }
      const side = Math.round(W * 0.72), off = Math.round((W - side) / 2);
      g.drawImage(l, off, off, side, side);
      if (shade) {
        const grad = g.createLinearGradient(0, 0, W, 0);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(0.45, 'rgba(0,0,0,0.06)');
        grad.addColorStop(1, 'rgba(0,0,0,0.42)');
        g.fillStyle = grad; g.fillRect(0, 0, W, W);
      }
      return cv;
    };
    // spread of brightness across the kept pixels, which is what "half dark"
    // actually means as a number
    const spread = (cv) => {
      const d = cv.getContext('2d', { willReadFrequently: true })
        .getImageData(0, 0, cv.width, cv.height).data;
      const v = [];
      for (let i = 0; i < cv.width * cv.height; i++) {
        const p = i * 4;
        if (d[p + 3] < 128) continue;
        v.push(0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]);
      }
      if (!v.length) return null;
      v.sort((a, b) => a - b);
      const q = (f) => v[Math.min(v.length - 1, Math.floor(v.length * f))];
      return q(0.90) - q(0.10);
    };
    const run = (twoTone, shade) => {
      const raw = build(twoTone, shade);
      const c = document.createElement('canvas');
      c.width = c.height = raw.width;
      c.getContext('2d').drawImage(raw, 0, 0);
      if (!liftForLayout(c)) return null;
      const before = spread(c);
      const applied = evenLighting(c);
      return { applied, before, after: spread(c) };
    };

    const shaded = run(false, true);
    if (!shaded) missed.push('the shaded fixture was refused by the cut, so this tests nothing');
    else {
      if (!shaded.applied) missed.push('evening it out declined a plainly shaded piece');
      // it was uneven to begin with, or the fixture has stopped biting
      if (shaded.before < 40) {
        missed.push(`the shaded fixture is only ${Math.round(shaded.before)} apart to begin with — it no longer tests anything`);
      } else if (shaded.after > shaded.before * 0.4) {
        missed.push(`shading survived: ${Math.round(shaded.before)} apart became ${Math.round(shaded.after)}`);
      }
    }

    const two = run(true, false);
    if (!two) missed.push('the two-tone fixture was refused by the cut, so this tests nothing');
    else if (two.after < two.before * 0.6) {
      // the failure this cap exists to prevent: a garment that really is two
      // colours coming out as one
      missed.push(`a two-tone garment was flattened: ${Math.round(two.before)} apart became ${Math.round(two.after)}`);
    }

    // and it must decline rather than guess when there is nothing to work from
    const empty = document.createElement('canvas');
    empty.width = empty.height = 80;
    if (evenLighting(empty)) missed.push('evening it out claimed to work on an empty canvas');

    return [...new Set(missed)];
  });
  for (const m of evenMisses) failures.push(`evening the light: ${m}`);

  // The photograph the arithmetic refuses. Measured over 180 renders -- nine
  // neutrals on four surfaces under five lighting conditions -- the automatic cut
  // refuses outright on 26 and lands below an IoU of 0.80 against the true
  // silhouette on 65. So this is not a corner: it is roughly a third of the hard
  // cases, and it is the whole reason the brushes exist.
  //
  // What matters is where they *start* from. A refusal must seed as "all of this
  // is the piece", so there is a background to rub away; seeding it empty would
  // hand someone a blank frame and ask them to trace a garment onto it, which is
  // not a thing anybody finishes on a phone.
  const refusedSeed = await page.evaluate(async () => {
    const missed = [];
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    // grey garment on a grey table: one colour, no edge, and a border too varied
    // to model -- this is one of the 26 the automatic cut gives up on.
    const cv = document.createElement('canvas');
    cv.width = cv.height = 240;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.fillStyle = '#9a9a96'; cx.fillRect(0, 0, 240, 240);
    const im = cx.getImageData(0, 0, 240, 240);
    let s = 5;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < im.data.length; i += 4) {
      const n = (rnd() - 0.5) * 24;
      im.data[i] += n; im.data[i + 1] += n; im.data[i + 2] += n;
    }
    cx.putImageData(im, 0, 0);
    cx.fillStyle = '#8a8a86'; cx.fillRect(60, 55, 120, 130);

    const kept = state.items.slice();
    const it = {
      id: 'refused-test', name: 'Grey on grey', category: 'top', color: 'grey',
      warmth: 3, formality: 3, createdAt: Date.now(), image: cv.toDataURL('image/png'),
    };
    state.items = [it];
    const done = () => {
      state.items = kept;
      _cut = null; _cutMode = 'erase';
      document.getElementById('detailOverlay').classList.remove('open');
      return [...new Set(missed)];
    };

    // First, that this fixture really does defeat the arithmetic -- otherwise the
    // assertion below is about the wrong branch and would pass for free.
    const probe = drawToCanvas(await loadImageFromDataUrl(it.image), 420);
    if (liftForLayout(probe)) {
      missed.push('the grey-on-grey fixture no longer defeats the automatic cut, so the refusal branch is untested');
    }

    openDetail(it.id);
    const st = document.getElementById('markStage');
    if (!st) return done(['the sheet offered no stage']);
    for (let i = 0; i < 100 && st.getBoundingClientRect().height < 1; i++) await wait(50);
    await wait(700);
    if (!_cut || _cut.id !== it.id) return done(['a refused photograph opened no session to paint on']);

    const S = _cut.mask.width;
    const mx = _cut.mask.getContext('2d', { willReadFrequently: true });
    const d = mx.getImageData(0, 0, S, S).data;
    let opaque = 0;
    for (let i = 0; i < S * S; i++) if (d[i * 4 + 3] >= 128) opaque++;
    const frac = opaque / (S * S);
    if (frac < 0.99) {
      missed.push(`a refused photograph seeded with only ${Math.round(frac * 100)}% of the frame kept, so there is nothing to rub away`);
    }
    return done();
  });
  for (const m of refusedSeed) failures.push(`cutting by hand: ${m}`);

  // And the lay-out has to actually use it. Everything above tests the mask and
  // the storage round trip; this tests the two lines that decide a painted mask
  // outranks the arithmetic. Without them every stroke would be stored correctly
  // and change nothing you can see, which is the failure that would ship
  // quietest.
  const layUsesHand = await page.evaluate(async () => {
    const missed = [];
    const cv = document.createElement('canvas');
    cv.width = cv.height = 200;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#d8d3c7'; cx.fillRect(0, 0, 200, 200);
    cx.fillStyle = '#2f3d66'; cx.fillRect(45, 40, 110, 120);

    // a mask that keeps only a small square in the middle -- nothing the
    // arithmetic would ever produce, so if the lay-out honours it the picture
    // must come back nearly empty
    const mk = document.createElement('canvas');
    mk.width = mk.height = 320;
    const mx = mk.getContext('2d');
    mx.fillStyle = '#000'; mx.fillRect(0, 0, 320, 320);
    mx.fillStyle = '#fff'; mx.fillRect(140, 140, 40, 40);

    const kept = state.items.slice();
    const it = {
      id: 'lay-hand-test', name: 'Navy test top', category: 'top', color: 'navy',
      warmth: 3, formality: 3, createdAt: Date.now(), image: cv.toDataURL('image/png'),
      handMask: mk.toDataURL('image/png'),
    };
    state.items = [it];

    const host = document.createElement('div');
    host.innerHTML = '<img data-lay-img="lay-hand-test" alt="">';
    document.body.appendChild(host);
    const img = host.querySelector('img');

    const run = async () => {
      _layCache.delete(it.id);
      img.removeAttribute('src');
      img.className = '';
      await enhanceLayImages();
      for (let i = 0; i < 60 && !img.getAttribute('src'); i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      return img.getAttribute('src');
    };

    const painted = await run();
    if (!painted) {
      missed.push('a piece with a painted mask produced no lay-out picture at all');
    } else {
      const decoded = await loadImageFromDataUrl(painted);
      const t = document.createElement('canvas');
      t.width = decoded.naturalWidth; t.height = decoded.naturalHeight;
      const tx = t.getContext('2d', { willReadFrequently: true });
      tx.drawImage(decoded, 0, 0);
      const d = tx.getImageData(0, 0, t.width, t.height).data;
      let opaque = 0;
      for (let i = 0; i < t.width * t.height; i++) if (d[i * 4 + 3] >= 128) opaque++;
      const frac = opaque / (t.width * t.height);
      // the square is 40/320 on a side, about 1.6% of the frame; the outline the
      // lay-out draws round a piece widens it, so the bar is generous
      if (frac > 0.25) {
        missed.push(`the lay-out ignored the painted mask: ${Math.round(frac * 100)}% of the picture survived where about 2% was kept`);
      }
    }

    delete it.handMask;
    const auto = await run();
    if (auto && painted && auto === painted) {
      missed.push('the lay-out gave the same picture with and without a painted mask');
    }

    host.remove();
    state.items = kept;
    return [...new Set(missed)];
  });
  for (const m of layUsesHand) failures.push(`cutting by hand: ${m}`);

  // The colour, read off a mask you painted. This is the reason the model was
  // wired into the colour reader at all, and the reason removing it had to leave
  // something in its place: every colour this app gets wrong is a *mask*
  // problem, not a colour problem. A white garment on a white sheet -- under
  // noise, falloff and a cast shadow at once -- reads grey off the automatic
  // mask, because the flood eats the garment and the reading comes off what is
  // left standing.
  //
  // So the claim under test is that a hand-painted mask fixes it, on the same
  // fixture the model was measured against.
  const handColour = await page.evaluate(async () => {
    const missed = [];
    const W = 560, cv = document.createElement('canvas');
    cv.width = cv.height = W;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#f4f4f2'; g.fillRect(0, 0, W, W);
    const im = g.getImageData(0, 0, W, W), dd = im.data;
    let s = 7;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < dd.length; i += 4) { const n = (rnd() - 0.5) * 26; dd[i] += n; dd[i + 1] += n; dd[i + 2] += n; }
    g.putImageData(im, 0, 0);
    const grad = g.createLinearGradient(0, 0, W, W);
    grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.34)');
    g.fillStyle = grad; g.fillRect(0, 0, W, W);
    g.save();
    g.globalAlpha = 0.35; g.filter = 'blur(18px)'; g.fillStyle = '#000';
    g.beginPath(); g.ellipse(W * 0.5, W * 0.76, W * 0.34, W * 0.09, 0, 0, 7); g.fill();
    g.restore();
    const S = 400, l = document.createElement('canvas');
    l.width = l.height = S;
    DEMO_SHAPES.top(l.getContext('2d'), colorByName('white').hex, S, S, {});
    const side = Math.round(W * 0.6);
    const off = Math.round((W - side) / 2);
    g.drawImage(l, off, off, side, side);

    // What the app says on its own. Asserted to be *wrong*, because if this
    // fixture ever stops defeating the automatic reading then everything below
    // it is passing for free and needs replacing with something harder.
    const file = await new Promise((r) => cv.toBlob((b) => r(new File([b], 'h.png', { type: 'image/png' })), 'image/png'));
    const auto = await processPhoto(file);
    const autoName = auto.colors.length ? auto.colors[0].name : '(nothing)';
    if (autoName === 'white') {
      missed.push('the hard fixture no longer defeats the automatic reading, so this test proves nothing — find a harder one');
    }

    // The mask a careful hand would have painted: exactly the garment, taken
    // from the shape that was drawn into the scene. Taken from its alpha rather
    // than its colour, so this stays a test of the colour reader rather than of
    // whether a white shirt can be told from a white sheet by brightness.
    const mk = document.createElement('canvas');
    mk.width = mk.height = 320;
    const mx = mk.getContext('2d', { willReadFrequently: true });
    mx.drawImage(l, off / W * 320, off / W * 320, side / W * 320, side / W * 320);
    const md = mx.getImageData(0, 0, 320, 320);
    for (let i = 0; i < 320 * 320; i++) {
      const v = md.data[i * 4 + 3] >= 128 ? 255 : 0;
      md.data[i * 4] = md.data[i * 4 + 1] = md.data[i * 4 + 2] = v;
      md.data[i * 4 + 3] = 255;
    }
    mx.putImageData(md, 0, 0);

    const got = await recolourFromHandMask({
      id: 'x', image: cv.toDataURL('image/png'), handMask: mk.toDataURL('image/png'),
    });
    const name = got && got.length ? got[0].name : '(nothing)';
    if (name !== 'white') {
      missed.push(`off a hand-painted mask a white garment on a white sheet still read as "${name}" (the app on its own said "${autoName}")`);
    }
    return missed;
  });
  for (const m of handColour) failures.push(`cutting by hand: ${m}`);

  // The cut can be switched off from the lay-out itself. The cut is a guess,
  // and when it guesses wrong there has to be a way to see the photograph
  // instead of arguing with it -- so what is under test is that the switch
  // actually reaches the pictures, both ways, and survives a reload.
  const cutMisses = await page.evaluate(async () => {
    const missed = [];
    await loadDemoWardrobe();
    const pick = (c) => state.items.find((i) => i.category === c);
    const ids = ['top', 'bottom', 'footwear'].map(pick).filter(Boolean).map((i) => i.id);
    // Two looks, so the deck builds more than one card -- see below.
    state.lastResult = { outfits: [
      { itemIds: ids, title: 'A', percent: 80, pills: [] },
      { itemIds: ids.slice().reverse(), title: 'B', percent: 70, pills: [] },
    ] };
    state.activeOption = 0;
    state.tab = 'today';
    state.layCut = true;
    render();
    await new Promise((r) => setTimeout(r, 2500));

    const switches = () => [...document.querySelectorAll('[data-lay-cut]')];
    const imgs = () => [...document.querySelectorAll('img[data-lay-img]')];
    const cutCount = () => imgs().filter((i) => i.src.startsWith('data:')).length;

    if (!switches().length) return ['the lay-out offered no way to turn the cut off'];
    const wasCut = cutCount();
    if (!wasCut) missed.push('nothing was cut out to begin with - the test proves nothing');

    // The deck builds every look, not only the visible one, so this markup
    // appears several times over. An id here would be duplicated and only the
    // first switch would work; the rest would look live and do nothing.
    if (switches().length < 2) missed.push('the deck rendered only one card - the duplicate-switch case is untested');
    switches()[switches().length - 1].click();
    await new Promise((r) => setTimeout(r, 1500));
    if (state.layCut) missed.push('the last switch on the page did nothing');
    if (cutCount() !== 0) missed.push(`${cutCount()} pieces were still cut out after switching it off`);
    if (imgs().some((i) => !i.classList.contains('fl-photo'))) {
      missed.push('a piece was left as a bare square rather than framed as a photograph');
    }
    if (!/photos as taken/i.test(document.querySelector('.cut-txt')?.textContent || '')) {
      missed.push('the switch label did not follow the setting');
    }

    // and back on again -- the lifted copies are cached, so this is where a
    // stale cache would show as "off" refusing to turn back on
    switches()[0].click();
    await new Promise((r) => setTimeout(r, 2500));
    if (!state.layCut) missed.push('the switch would not turn back on');
    if (cutCount() !== wasCut) {
      missed.push(`${cutCount()} pieces cut after switching back on, ${wasCut} before`);
    }

    // it is a setting, not a mood: it has to be written down
    state.layCut = false;
    await savePrefs();
    const raw = await storageGet('wardrobe:prefs');
    const stored = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
    if (stored.layCut !== false) missed.push(`the setting was not saved: ${JSON.stringify(stored)}`);
    return missed;
  });
  for (const m of cutMisses) failures.push(`cut switch: ${m}`);

  // One piece can opt out on its own. The switch on Today answers "I do not
  // want cut-outs"; this answers "that one came out wrong", which is a
  // judgement about a single photograph and must not cost the cut-outs that
  // worked. So the test is specifically that the *other* pieces are untouched
  // -- an opt-out that quietly turned everything into photographs would look
  // like it was working.
  const perPiece = await page.evaluate(async () => {
    const missed = [];
    state.layCut = true;
    const pick = (c) => state.items.find((i) => i.category === c);
    const ids = ['top', 'bottom', 'footwear'].map(pick).filter(Boolean).map((i) => i.id);
    state.lastResult = { outfits: [{ itemIds: ids, title: 'A', percent: 80, pills: [] }] };
    state.activeOption = 0; state.tab = 'today';
    state.items.forEach((i) => { delete i.showAsPhoto; });
    render();
    await new Promise((r) => setTimeout(r, 2500));

    const cutIds = () => [...document.querySelectorAll('img[data-lay-img]')]
      .filter((i) => i.src.startsWith('data:')).map((i) => i.getAttribute('data-lay-img'));
    const before = cutIds();
    // Not every demo piece can be lifted, so pick one that actually was --
    // opting out a piece that was already a photograph proves nothing.
    if (before.length < 2) return ['fewer than two pieces were cut out to begin with'];
    const target = before[0];

    openDetail(target);
    await new Promise((r) => setTimeout(r, 400));
    const btn = document.getElementById('showAsPhotoBtn');
    if (!btn) return ['the detail sheet offered no way to show a piece as a photo'];
    btn.click();
    await new Promise((r) => setTimeout(r, 2500));

    const after = cutIds();
    if (!state.items.find((i) => i.id === target).showAsPhoto) missed.push('the opt-out was not recorded');
    if (after.includes(target)) missed.push('the piece that opted out is still cut out');
    for (const id of before.slice(1)) {
      if (!after.includes(id)) missed.push('opting one piece out stopped another being cut out');
    }

    // and back again
    document.getElementById('detailOverlay').classList.remove('open');
    openDetail(target);
    await new Promise((r) => setTimeout(r, 400));
    document.getElementById('showAsPhotoBtn').click();
    await new Promise((r) => setTimeout(r, 2500));
    if (cutIds().length !== before.length) {
      missed.push(`turning it back on gave ${cutIds().length} cut pieces, ${before.length} before`);
    }

    // the switch on Today still wins over everything
    document.getElementById('detailOverlay').classList.remove('open');
    state.layCut = false;
    render();
    await new Promise((r) => setTimeout(r, 1500));
    if (cutIds().length) missed.push('the Today switch no longer turns every cut-out off');
    state.layCut = true;
    return missed;
  });
  for (const m of perPiece) failures.push(`per-piece: ${m}`);

  // A look is head to foot. When the wardrobe holds none of a category the
  // stylist builds without it rather than refusing, which is right -- a shirt
  // and jeans is still useful before you have photographed your shoes. What
  // was wrong was saying nothing: you got a card with a title and a percentage
  // fit and no shoes on it, which reads as a finished answer rather than the
  // best available one.
  //
  // Also under test here: that the stylist keeps its own promises when the
  // wardrobe is awkward. Every look it returns must be made of pieces that
  // exist, must not wear two tops at once, and must not use one piece twice --
  // whatever it has been given to work with.
  const looksMisses = await page.evaluate(async () => {
    const mk = (name, cat, color, warm, form) => ({
      id: name.replace(/\W/g, '') + Math.random().toString(36).slice(2, 7),
      name, category: cat, color, warmth: warm, formality: form,
      tags: [], image: null, createdAt: Date.now(), wearCount: 0,
    });
    const missed = [];
    const beds = {
      'no shoes': [mk('Tee', 'top', 'white', 2, 2), mk('Jeans', 'bottom', 'blue', 3, 2),
        mk('Jumper', 'top', 'grey', 4, 2)],
      'no bottoms': [mk('Tee', 'top', 'white', 2, 2), mk('Boots', 'footwear', 'black', 4, 3),
        mk('Jumper', 'top', 'grey', 4, 2)],
      complete: [mk('Tee', 'top', 'white', 2, 2), mk('Jeans', 'bottom', 'blue', 3, 2),
        mk('Trainers', 'footwear', 'white', 2, 2)],
    };
    for (const [label, items] of Object.entries(beds)) {
      state.items = items; state.wearLog = []; state.outfits = []; state.anchorId = null;
      const res = generateLooks({ occasion: 'Everyday', temp: 'mild', count: 1 });
      if (!res.length) { missed.push(`${label}: the stylist produced nothing`); continue; }
      state.lastResult = { outfits: res };
      state.activeOption = 0; state.tab = 'today';
      render();
      await new Promise((r) => setTimeout(r, 300));
      const note = document.querySelector('.incomplete-note');
      const text = note ? note.textContent : '';
      if (label === 'complete') {
        if (note) missed.push(`a complete look was flagged as incomplete: "${text.trim()}"`);
      } else {
        const want = label === 'no shoes' ? 'shoes' : 'bottoms';
        if (!note) missed.push(`${label}: the look was shown with no mention that it is incomplete`);
        else if (!text.includes(want)) missed.push(`${label}: the note does not mention ${want}: "${text.trim()}"`);
        // and it has to offer the way out, since the fix is adding pieces
        else if (!note.querySelector('[data-do="add"]')) {
          missed.push(`${label}: the note says a category is empty but offers no way to add one`);
        }
      }
    }
    // the stylist's own rules, on wardrobes shaped awkwardly
    const awkward = {
      'all formal': [mk('Dress shirt', 'top', 'white', 2, 5), mk('Suit trousers', 'bottom', 'charcoal', 3, 5),
        mk('Oxfords', 'footwear', 'black', 3, 5)],
      'all one colour': [mk('Black tee', 'top', 'black', 2, 2), mk('Black jeans', 'bottom', 'black', 3, 2),
        mk('Black boots', 'footwear', 'black', 4, 3)],
      'lopsided': [...Array.from({ length: 12 }, (_, i) => mk('Top ' + i, 'top', ['white', 'navy', 'grey'][i % 3], 2, 2)),
        mk('Jeans', 'bottom', 'blue', 3, 2), mk('Trainers', 'footwear', 'white', 2, 2)],
    };
    for (const [label, items] of Object.entries(awkward)) {
      state.items = items; state.wearLog = []; state.outfits = []; state.anchorId = null;
      for (const occ of OCCASIONS) {
        for (const b of TEMP_BANDS) {
          let res;
          try { res = generateLooks({ occasion: occ, temp: b.v, count: 3 }); }
          catch (e) { missed.push(`${label} ${occ}/${b.v}: threw "${e.message}"`); continue; }
          for (const o of res) {
            const its = o.itemIds.map((id) => state.items.find((i) => i.id === id));
            if (its.some((i) => !i)) { missed.push(`${label} ${occ}/${b.v}: references a piece not in the wardrobe`); continue; }
            if (new Set(o.itemIds).size !== o.itemIds.length) missed.push(`${label} ${occ}/${b.v}: uses the same piece twice`);
            const cats = its.map((i) => i.category).filter((c) => c !== 'accessory');
            const dupe = cats.find((c, i) => cats.indexOf(c) !== i);
            if (dupe) missed.push(`${label} ${occ}/${b.v}: wears two ${dupe}s at once`);
            if (o.percent != null && (o.percent < 0 || o.percent > 100)) {
              missed.push(`${label} ${occ}/${b.v}: scored ${o.percent}`);
            }
          }
        }
      }
    }
    return [...new Set(missed)];
  });
  for (const m of looksMisses) failures.push(`stylist: ${m}`);

  // The backup file is the only copy of a wardrobe that is not in this
  // browser's storage. It is the answer to "what if the data is cleared", to
  // "I got a new phone", and to the README's own advice -- and nothing was
  // testing that a file written by export can be read back by import.
  //
  // A silent partial loss is the failure that matters. Everything would appear
  // to work: the wardrobe comes back, the photos are there, and only weeks
  // later does it emerge that every warmth you corrected by hand has been
  // quietly re-guessed, or that the boxes you drew round pieces are gone.
  const backupMisses = await page.evaluate(async () => {
    const missed = [];
    const mk = (name, cat, color) => ({
      id: name.replace(/\W/g, '') + Math.random().toString(36).slice(2, 7),
      name, category: cat, color, warmth: 3, formality: 3,
      tags: [], image: null, createdAt: Date.now(), wearCount: 0,
    });
    const tee = mk('Tee', 'top', 'white');
    const jeans = mk('Jeans', 'bottom', 'blue');
    const shoes = mk('Trainers', 'footwear', 'white');
    // one piece carrying every per-item field that has been added over time,
    // since those are exactly what a round trip is most likely to drop
    tee.favourite = true;
    tee.showAsPhoto = true;
    tee.colorAuto = false;
    tee.brand = 'Vans';
    tee.image = 'data:image/png;base64,iVBORw0KGgo=';
    // a cut corrected by hand: losing this on a restore would silently undo
    // work that cannot be redone from anything else in the file
    tee.handMask = 'data:image/png;base64,iVBORw0KGgo=';
    // and attributes corrected by hand, which import must not re-guess
    tee.warmth = 5; tee.warmthAuto = false;
    tee.formality = 5; tee.formalityAuto = false;
    jeans.warmth = 1; jeans.warmthAuto = false;

    const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return dateKey(d); };
    state.items = [tee, jeans, shoes];
    state.outfits = [{ itemIds: [tee.id, jeans.id, shoes.id], title: 'Saved look', percent: 80, pills: [] }];
    state.wearLog = [{ date: day(1), itemIds: [tee.id, jeans.id, shoes.id], title: 'L' }];
    state.plans = { [day(-2)]: { itemIds: [jeans.id, shoes.id], title: 'Planned' } };
    const before = JSON.parse(JSON.stringify({
      items: state.items, outfits: state.outfits, wearLog: state.wearLog, plans: state.plans,
    }));

    // exportBackup hands the file to the browser via a blob URL. Capture the
    // blob on the way past but hand back a real URL: returning a made-up one
    // makes the download anchor fail and logs "Not allowed to load local
    // resource", which this suite counts -- correctly -- as an error.
    let blob = null;
    const realCreate = URL.createObjectURL;
    URL.createObjectURL = function (b) { blob = b; return realCreate.call(URL, b); };
    try { exportBackup(); } catch (e) { missed.push(`export threw "${e.message}"`); }
    URL.createObjectURL = realCreate;
    if (!blob) return ['export produced no file at all'];
    const text = await blob.text();

    state.items = []; state.outfits = []; state.wearLog = []; state.plans = {};
    try {
      await importBackup(new File([text], 'rail-backup.json', { type: 'application/json' }));
    } catch (e) {
      return [`import could not read the file export just wrote: "${e.message}"`];
    }

    if (state.items.length !== before.items.length) {
      missed.push(`${before.items.length} pieces went in, ${state.items.length} came back`);
    }
    if (JSON.stringify(state.outfits) !== JSON.stringify(before.outfits)) missed.push('saved looks were lost');
    if (JSON.stringify(state.wearLog) !== JSON.stringify(before.wearLog)) missed.push('the wear log was lost');
    if (JSON.stringify(state.plans) !== JSON.stringify(before.plans)) missed.push('plans were lost');

    const back = state.items.find((i) => i.id === tee.id);
    if (!back) missed.push('the piece carrying every field did not come back');
    else {
      // Only the fields that must survive verbatim. warmth, formality and tags
      // are deliberately re-inferred on import for anything still automatic --
      // that is why the hand-corrected ones below are the interesting case.
      for (const f of ['favourite', 'handMask', 'showAsPhoto', 'colorAuto', 'brand', 'image', 'name', 'category', 'color']) {
        if (JSON.stringify(back[f]) !== JSON.stringify(tee[f])) {
          missed.push(`item.${f} did not survive the backup (${JSON.stringify(back[f])})`);
        }
      }
      if (back.warmth !== 5 || back.formality !== 5) {
        missed.push(`a hand-corrected warmth/formality was re-guessed on import (${back.warmth}/${back.formality})`);
      }
    }
    const j = state.items.find((i) => i.id === jeans.id);
    if (j && j.warmth !== 1) missed.push(`a hand-corrected warmth was re-guessed on import (${j.warmth})`);
    return missed;
  });
  for (const m of backupMisses) failures.push(`backup: ${m}`);

  // Names people actually type, and records a backup file can actually carry.
  // The emoji case is the one that matters: "👟 sneakers" is an ordinary thing
  // to call a pair of trainers, and it took down the Wardrobe tab and the Stats
  // tab with "URI malformed" -- charAt(0) returns half a surrogate pair and
  // encodeURIComponent refuses it. Nothing in the suite typed anything but
  // ASCII, so nothing saw it.
  //
  // The malformed records below cannot be typed in. They arrive through a
  // hand-edited or truncated backup file, which is a door this app deliberately
  // leaves open, so they should not take a tab down either.
  const nastyMisses = await page.evaluate(async () => {
    const missed = [];
    window.__ranScript = false;
    const mk = (name, cat, color, extra) => Object.assign({
      id: 'x' + Math.random().toString(36).slice(2, 9),
      name, category: cat, color, warmth: 3, formality: 3,
      tags: [], image: null, createdAt: Date.now(), wearCount: 0,
    }, extra || {});
    // "typed" marks the ones a person can actually put in through the add
    // sheet. Those have to work exactly as they arrive, because nothing is
    // going to repair them -- the name is whatever you wrote. The rest can only
    // come from a hand-edited or truncated backup, and are expected to work
    // once the app's normalisation has been over them.
    const cases = {
      'an emoji in the name': { item: mk('👟 sneakers 🔥', 'footwear', 'red'), typed: true },
      'a Hebrew name': { item: mk('חולצה לבנה', 'top', 'white'), typed: true },
      'markup in the name': { item: mk('<img src=x onerror="window.__ranScript=true">', 'top', 'white'), typed: true },
      'a script tag in the name': { item: mk('"><script>window.__ranScript=true<\/script>', 'bottom', 'blue'), typed: true },
      'a very long name': { item: mk('A'.repeat(400), 'top', 'green'), typed: true },
      'an empty name': { item: mk('', 'bottom', 'grey'), typed: true },
      'a lone surrogate': { item: mk('bad \ud800 name', 'top', 'white'), typed: true },
      'no name at all': { item: mk(undefined, 'top', 'white'), typed: false },
      'no category': { item: mk('No category', undefined, 'white'), typed: false },
      'no colour': { item: mk('No colour', 'top', undefined), typed: false },
      'null warmth': { item: mk('Null warmth', 'top', 'white', { warmth: null, formality: null }), typed: false },
    };
    // A typed name is run twice: once through the normalisation the app does on
    // load and on import, and once raw, because nothing repairs what you typed
    // and it has to work as it stands. A malformed record is only run repaired,
    // since every door into the wardrobe -- the add sheet, the load migration,
    // import -- normalises, so an unrepaired one is a state the app cannot be
    // in. Asserting against it would be inventing a requirement.
    for (const [rawLabel, spec] of Object.entries(cases)) {
     for (const normalise of (spec.typed ? [true, false] : [true])) {
      const label = rawLabel + (normalise ? '' : ', exactly as typed');
      state.items = [JSON.parse(JSON.stringify(spec.item))];
      Object.keys(spec.item).forEach(function (k) {
        if (spec.item[k] === undefined) state.items[0][k] = undefined;
      });
      state.outfits = []; state.wearLog = []; state.plans = {};
      if (normalise) state.items.forEach(enrichItem);
      for (const tab of ['today', 'wardrobe', 'plan', 'stats', 'saved']) {
        state.tab = tab;
        try { render(); } catch (e) { missed.push(`${label}: the ${tab} tab threw "${e.message}"`); continue; }
        await new Promise((r) => setTimeout(r, 90));
        const el = document.getElementById('main');
        if (!el.children.length) missed.push(`${label}: the ${tab} tab rendered nothing`);
        if (/NaN|undefined|Infinity/.test(el.textContent)) {
          missed.push(`${label}: the ${tab} tab shows "${el.textContent.match(/.{0,24}(NaN|undefined|Infinity).{0,16}/)[0]}"`);
        }
        // a name must never become markup, repaired or not
        if (el.querySelector('script')) missed.push(`${label}: the name became a <script> element`);
        if (el.querySelector('img[onerror]')) missed.push(`${label}: the name became an <img onerror>`);
      }
      for (const [what, call] of Object.entries({
        'the stylist': () => generateLooks({ occasion: 'Everyday', temp: 'mild', count: 2 }),
        'the gap analysis': () => analyseGaps(),
        'stats': () => wardrobeStats(),
        'the photo placeholder': () => imgSrc(state.items[0]),
      })) {
        try { call(); } catch (e) { missed.push(`${label}: ${what} threw "${e.message}"`); }
      }
     }
    }
    if (window.__ranScript) missed.push('an item name executed script');
    return [...new Set(missed)];
  });
  for (const m of nastyMisses) failures.push(`odd input: ${m}`);

  // The block above calls the repair directly. This one goes through the door:
  // a malformed record is written into storage and the app is reloaded, which
  // is how one would really arrive -- restored by an older version of the app,
  // then opened by this one.
  //
  // Worth testing separately because the load path does not repair everything
  // it reads. It repairs an item that is missing something it knows how to
  // fill, and the list of what counts as missing is easy to leave a hole in:
  // before this, an item with a warmth but no colour was never visited, and
  // showed up in the stats as the word "undefined".
  await page.evaluate(async () => {
    await saveKey('wardrobe:items', [
      // has a warmth, so the old condition skipped it entirely
      { id: 'broken1', name: 'No colour', category: 'top', warmth: 3, formality: 3, createdAt: Date.now() },
      { id: 'broken2', category: 'bottom', color: 'blue', warmth: 3, formality: 3, createdAt: Date.now() },
    ]);
    await saveOutfits(); await saveWearLog(); await savePlans();
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => typeof render === 'function' && state.items.length > 0,
    { timeout: 15000 });
  const repaired = await page.evaluate(async () => {
    const missed = [];
    const a = state.items.find((i) => i.id === 'broken1');
    const b = state.items.find((i) => i.id === 'broken2');
    if (!a || !b) return ['a malformed record did not survive being loaded at all'];
    if (typeof a.color !== 'string' || !a.color) missed.push('a piece with no colour was loaded without one being filled in');
    if (typeof b.name !== 'string') missed.push('a piece with no name was loaded without one being filled in');
    for (const tab of ['today', 'wardrobe', 'plan', 'stats', 'saved']) {
      state.tab = tab;
      try { render(); } catch (e) { missed.push(`the ${tab} tab threw "${e.message}" on a loaded malformed record`); continue; }
      await new Promise((r) => setTimeout(r, 90));
      const el = document.getElementById('main');
      if (/NaN|undefined|Infinity/.test(el.textContent)) {
        missed.push(`the ${tab} tab shows "${el.textContent.match(/.{0,24}(NaN|undefined|Infinity).{0,16}/)[0]}"`);
      }
    }
    state.items = [];
    await saveItems();
    return missed;
  });
  for (const m of repaired) failures.push(`on load: ${m}`);

  // Swapping a piece out of a look, and writing down what you wore. Both are
  // fine today; both fail silently if they break. A swap that offers a piece
  // already in the look, or leaves two tops behind, produces an outfit that
  // looks like an outfit. A wear log that drops the newest entry instead of the
  // oldest loses exactly the history you would notice last.
  const swapWearMisses = await page.evaluate(async () => {
    const missed = [];
    await loadDemoWardrobe();
    const pick = (c) => state.items.find((i) => i.category === c);
    const ids = ['top', 'bottom', 'footwear'].map(pick).filter(Boolean).map((i) => i.id);
    state.lastResult = { outfits: [{ itemIds: ids.slice(), title: 'T', percent: 80, pills: [] }] };
    state.activeOption = 0; state.tab = 'today';
    state.wearLog = []; state.outfits = []; state.plans = {};
    render();
    await new Promise((r) => setTimeout(r, 1000));

    const target = ids[0];
    const targetCat = state.items.find((i) => i.id === target).category;
    openSwapSheet(target);
    await new Promise((r) => setTimeout(r, 400));
    const cards = [...document.querySelectorAll('[data-swap-to]')];
    if (!cards.length) missed.push('swapping a piece offered no alternatives at all');
    for (const c of cards) {
      const alt = state.items.find((i) => i.id === c.getAttribute('data-swap-to'));
      if (!alt) { missed.push('an offered alternative is not in the wardrobe'); continue; }
      if (alt.category !== targetCat) missed.push(`swapping a ${targetCat} offered a ${alt.category}`);
      if (alt.id === target) missed.push('the piece being swapped was offered as its own replacement');
      if (ids.includes(alt.id)) missed.push('a piece already in the look was offered as a replacement');
    }
    if (cards.length) {
      const chosen = cards[0].getAttribute('data-swap-to');
      cards[0].click();
      await new Promise((r) => setTimeout(r, 700));
      const now = normalizeResult(state.lastResult).outfits[0].itemIds;
      if (now.includes(target)) missed.push('the old piece is still in the look after a swap');
      if (!now.includes(chosen)) missed.push('the chosen piece did not go into the look');
      if (now.length !== ids.length) missed.push(`a swap changed the look's length: ${ids.length} to ${now.length}`);
      if (new Set(now).size !== now.length) missed.push('a swap left the same piece in the look twice');
      const cats = now.map((id) => state.items.find((x) => x.id === id)).filter(Boolean)
        .map((i) => i.category).filter((c) => c !== 'accessory');
      const dupe = cats.find((c, i) => cats.indexOf(c) !== i);
      if (dupe) missed.push(`a swap left two ${dupe}s in the look`);
    }
    document.getElementById('swapOverlay')?.classList.remove('open');

    // what you wore
    state.wearLog = [];
    logWear(ids, 'Test look');
    const todays = state.wearLog.filter((w) => w.date === todayKey());
    if (todays.length !== 1) missed.push(`logging one wear produced ${todays.length} entries for today`);
    else if (JSON.stringify(todays[0].itemIds) !== JSON.stringify(ids)) {
      missed.push('the logged pieces are not the ones worn');
    }
    if (!(wardrobeStats().totalWears >= 1)) missed.push('a wear did not reach the stats');

    // deleting a piece must not rewrite what you actually wore
    const gone = ids[0];
    state.items = state.items.filter((i) => i.id !== gone);
    try { wardrobeStats(); } catch (e) { missed.push(`stats threw once a worn piece was deleted: "${e.message}"`); }
    if (!state.wearLog.some((w) => w.itemIds.includes(gone))) {
      missed.push('deleting a piece rewrote the history of having worn it');
    }

    // the log is capped; the cap must drop the oldest, not the newest
    state.wearLog = [];
    for (let i = 0; i < 900; i++) state.wearLog.push({ date: todayKey(), itemIds: [ids[1]], title: 'w' + i });
    logWear([ids[1]], 'newest');
    if (state.wearLog.length > 800) missed.push(`the wear log grew to ${state.wearLog.length}`);
    if (state.wearLog[state.wearLog.length - 1].title !== 'newest') {
      missed.push('the cap threw away the newest entry instead of the oldest');
    }
    if (state.wearLog.some((w) => w.title === 'w0')) missed.push('the cap kept the oldest entries');
    state.wearLog = [];
    return [...new Set(missed)];
  });
  for (const m of swapWearMisses) failures.push(`swap and wear: ${m}`);


  // "What am I missing?" counts what the wardrobe can make, then works out
  // which single piece would add the most. It is the largest untested thing in
  // the file, and its failure mode is silence: an empty list of suggestions
  // renders as an empty panel and looks like a considered answer rather than a
  // broken one. So the test is that it produces advice at every size, not that
  // the advice is any particular thing.
  const gapMisses = await page.evaluate(async () => {
    const missed = [];
    const mk = (name, cat, color, warm, form) => ({
      id: name.replace(/\s/g, '') + Math.random().toString(36).slice(2, 8),
      name, category: cat, color, warmth: warm, formality: form,
      tags: [], image: null, createdAt: Date.now(), wearCount: 0,
    });
    // Three is the smallest wardrobe the button will open on -- below that it
    // refuses with a toast rather than analysing, so that is where to start.
    const beds = {
      'three pieces': [
        mk('White tee', 'top', 'white', 2, 2),
        mk('Blue jeans', 'bottom', 'blue', 3, 2),
        mk('White trainers', 'footwear', 'white', 2, 2),
      ],
      'seven pieces': [
        mk('White tee', 'top', 'white', 2, 2), mk('Blue jeans', 'bottom', 'blue', 3, 2),
        mk('White trainers', 'footwear', 'white', 2, 2), mk('Black tee', 'top', 'black', 2, 2),
        mk('Grey jumper', 'top', 'grey', 4, 2), mk('Black chinos', 'bottom', 'black', 3, 3),
        mk('Brown boots', 'footwear', 'brown', 4, 3),
      ],
      // everything one colour, and nothing to put on your feet: the two shapes
      // most likely to leave the scorer with nothing positive to say.
      // Named the way a person would name them. That matters here: the
      // "do not recommend what they already own" rule works on the words in
      // the name, so a fixture of six things called "Black thing 3" defeats it
      // and fails this test for a reason no real wardrobe would produce.
      'all one colour': [
        mk('Black tee', 'top', 'black', 2, 2), mk('Black jeans', 'bottom', 'black', 3, 2),
        mk('Black boots', 'footwear', 'black', 4, 3), mk('Black hoodie', 'top', 'black', 3, 1),
        mk('Black trousers', 'bottom', 'black', 3, 3), mk('Black trainers', 'footwear', 'black', 2, 1),
      ],
      'no shoes': [
        mk('White tee', 'top', 'white', 2, 2), mk('Blue jeans', 'bottom', 'blue', 3, 2),
        mk('Grey jumper', 'top', 'grey', 4, 2),
      ],
    };
    for (const [label, items] of Object.entries(beds)) {
      state.items = items;
      let g;
      try { g = analyseGaps(); }
      catch (e) { missed.push(`${label}: analysis threw "${e.message}"`); continue; }
      if (!g.gaps || !g.gaps.length) missed.push(`${label}: no suggestions at all`);
      if (!g.summary) missed.push(`${label}: no summary line`);
      // A suggestion with no reason is worse than none: the panel exists to
      // explain itself, and "buy a grey jumper" unexplained is a horoscope.
      (g.gaps || []).forEach((x) => {
        if (!x.item) missed.push(`${label}: a suggestion with no name`);
        if (!x.why) missed.push(`${label}: "${x.item}" was suggested with no reason`);
        if (typeof x.unlocks !== 'number') missed.push(`${label}: "${x.item}" unlocks nothing countable`);
      });
      // Recommending what you already own is the fastest way to lose trust.
      const owned = new Set(items.map((i) => i.category + '|' + i.color));
      const dupe = (g.gaps || []).find((x) => owned.has(x.category + '|' + x.color)
        && items.some((i) => i.category === x.category && i.color === x.color
          && x.item.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
            .some((w) => i.name.toLowerCase().includes(w))));
      if (dupe) missed.push(`${label}: suggested "${dupe.item}" which is already owned`);
    }
    // "no shoes" must be named as a blocker, not left to the suggestions --
    // you cannot dress at all, and that is a different statement from advice.
    state.items = beds['no shoes'];
    const shoeless = analyseGaps();
    if (!shoeless.blockers.length) missed.push('a wardrobe with no shoes reported nothing you cannot dress for');

    // and on a real wardrobe it must still say something useful
    await loadDemoWardrobe();
    const demo = analyseGaps();
    if (!demo.gaps.length) missed.push('the demo wardrobe produced no suggestions');
    if (!(demo.baseCount > 0)) missed.push('the demo wardrobe counted no workable combinations');
    return missed;
  });
  for (const m of gapMisses) failures.push(`gaps: ${m}`);

  // "What goes with what" -- four readings of how well the wardrobe connects to
  // itself, all on trial and all marked TEST on screen. The numbers are the
  // point of them, so the numbers are what is checked: a piece's count is how
  // many workable looks it is actually in, and "never worn together" means the
  // wear log really has no day holding all three.
  const compatMisses = await page.evaluate(async () => {
    const missed = [];
    if (typeof compatibilityReport !== 'function') return ['it is not wired in at all'];
    const mk = (name, cat, color, warm, form) => ({
      id: name.replace(/\W/g, '') + Math.random().toString(36).slice(2, 7),
      name, category: cat, color, warmth: warm, formality: form,
      tags: [], image: null, createdAt: Date.now(), wearCount: 0,
    });
    // small enough to count by hand
    const tee = mk('White tee', 'top', 'white', 2, 2);
    const jumper = mk('Grey jumper', 'top', 'grey', 4, 2);
    const jeans = mk('Blue jeans', 'bottom', 'blue', 3, 2);
    const shoes = mk('White trainers', 'footwear', 'white', 2, 2);
    state.items = [tee, jumper, jeans, shoes];
    state.wearLog = []; state.outfits = []; state.plans = {};
    _baseCache = null;

    const r = compatibilityReport();
    // every count must equal the number of looks that piece is really in
    for (const e of r.ranked) {
      const truth = r.unworn.concat([]).length >= 0
        ? goodBases().filter((b) => b.some((i) => i.id === e.item.id)).length : -1;
      if (e.n !== truth) missed.push(`${e.item.name} is reported in ${e.n} looks but is in ${truth}`);
    }
    if (r.ranked.some((e) => e.item.category === 'accessory')) {
      missed.push('an accessory was ranked, though no look is built from one');
    }
    // with nothing worn, every workable look is a look never worn
    if (r.unworn.length !== r.total) {
      missed.push(`nothing has been worn, but only ${r.unworn.length} of ${r.total} count as never worn`);
    }
    // wear one of them and it must drop out
    if (r.total) {
      const first = r.unworn[0];
      state.wearLog = [{ date: todayKey(), itemIds: first.map((i) => i.id), title: 'worn' }];
      const r2 = compatibilityReport();
      if (r2.unworn.length !== r.unworn.length - 1) {
        missed.push(`wearing one look changed "never worn" from ${r.unworn.length} to ${r2.unworn.length}`);
      }
      if (r2.unworn.some((b) => b.map((i) => i.id).sort().join('|') === first.map((i) => i.id).sort().join('|'))) {
        missed.push('a look that was worn is still listed as never worn');
      }
      // and it must still count when the day held more than those three
      state.wearLog = [{ date: todayKey(), itemIds: first.map((i) => i.id).concat(['someBelt']), title: 'worn' }];
      if (compatibilityReport().unworn.length !== r.unworn.length - 1) {
        missed.push('a look worn with something extra on top was not recognised as worn');
      }
    }

    // a piece that goes with nothing must say so, and be findable
    const orphan = mk('Neon vest', 'top', 'teal', 1, 1);
    state.items = [tee, jeans, shoes, orphan];
    state.wearLog = [];
    _baseCache = null;
    const r3 = compatibilityReport();
    const o = r3.ranked.find((e) => e.item.id === orphan.id);
    if (!o) missed.push('a piece that connects to nothing was left out of the ranking entirely');

    // the screen itself: every one of these is on trial and must say so
    state.items = [tee, jumper, jeans, shoes];
    _baseCache = null;
    state.tab = 'stats';
    render();
    await new Promise((res) => setTimeout(res, 300));
    const main = document.getElementById('main');
    const tags = main.querySelectorAll('.test-tag').length;
    if (!tags) missed.push('none of the trial sections is marked TEST on screen');
    if (!main.querySelector('[data-try]')) missed.push('a look you have never worn offers no way to try it');
    if (/NaN|undefined|Infinity/.test(main.textContent)) {
      missed.push(`the section shows "${main.textContent.match(/.{0,26}(NaN|undefined|Infinity).{0,16}/)[0]}"`);
    }
    return missed;
  });
  for (const m of compatMisses) failures.push(`what goes with what: ${m}`);

  // Written down is only half of it -- it has to be read back. Saving a setting
  // that never returns looks identical to saving it correctly until the next
  // launch.
  //
  // Turned off and saved right here rather than relying on an earlier block
  // having left it that way. It did, once; then another test called something
  // that writes prefs as a side effect, and this failed pointing at the cut
  // switch, which was not what was wrong. A test that depends on the state
  // another test happened to leave behind reports the wrong culprit.
  // Read it back before reloading rather than trusting the write. This failed
  // once, exactly once, and reported "the setting did not survive a reload" --
  // which would have sent someone looking at the loading code when the write
  // was what had not finished. Confirming it landed means a failure after this
  // point really is about reading it back.
  const wrote = await page.evaluate(async () => {
    state.layCut = false;
    await savePrefs();
    const raw = await storageGet('wardrobe:prefs');
    const p = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
    return p.layCut;
  });
  if (wrote !== false) failures.push(`cut switch: the setting never reached storage (${wrote})`);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => typeof render === 'function' && state.items.length > 0,
    { timeout: 15000 });
  const restored = await page.evaluate(async () => {
    const was = state.layCut;
    // and leave the setting as it was found, so later runs start clean
    state.layCut = true;
    await savePrefs();
    return was;
  });
  if (restored !== false) failures.push(`cut switch: the setting did not survive a reload (came back ${restored})`);

  // A screen that asks you to add a piece has to let you add one. The
  // floating button is display:none on every tab but Wardrobe, so Today --
  // the tab the app opens on -- used to tell a brand new user to add pieces
  // and give them nothing to press.
  const deadEnds = await page.evaluate(async () => {
    state.items = []; state.outfits = []; state.wearLog = []; state.plans = {};
    const missed = [];
    for (const t of ['today', 'plan', 'stats']) {
      state.tab = t; render();
      await new Promise((r) => setTimeout(r, 120));
      const main = document.getElementById('main');
      const fabShown = document.getElementById('fabWrap').style.display !== 'none';
      if (/add/i.test(main.textContent) && !main.querySelector('[data-do]') && !fabShown) {
        missed.push(`"${t}" asks for a piece with no way to add one`);
      }
    }
    // and the button has to actually open the sheet
    state.tab = 'today'; render();
    await new Promise((r) => setTimeout(r, 120));
    const btn = document.querySelector('#main [data-do="add"]');
    if (!btn) missed.push('no add button on an empty Today');
    else {
      btn.click();
      await new Promise((r) => setTimeout(r, 200));
      if (!document.getElementById('addOverlay').classList.contains('open')) {
        missed.push('the empty-state add button did not open the add sheet');
      }
      document.getElementById('addOverlay').classList.remove('open');
    }
    return missed;
  });
  for (const m of deadEnds) failures.push(`empty state: ${m}`);

  // The category list went from nine to four. A wardrobe or a backup made
  // before that still holds the old values, and an item left on one the
  // picker cannot show is invisible to the outfit engine.
  const strays = await page.evaluate(async () => {
    const missed = [];
    if (CATEGORIES.length !== 4) missed.push(`expected four categories, found ${CATEGORIES.length}`);
    for (const [old, want] of Object.entries({
      outerwear: 'top', dress: 'top', headwear: 'accessory', jewellery: 'accessory', bag: 'accessory',
    })) {
      if (normaliseCategory(old) !== want) missed.push(`"${old}" did not migrate to "${want}"`);
    }
    await loadDemoWardrobe();
    const bad = state.items.filter((i) => !CATEGORY_VALUES.includes(i.category));
    if (bad.length) missed.push(`${bad.length} demo pieces sit outside the four categories`);
    if (!generateLooks({ count: 1 }).length) missed.push('the stylist built nothing after the merge');
    return missed;
  });
  for (const m of strays) failures.push(`categories: ${m}`);

  // The typefaces are served from beside the app so that it looks the same
  // with no signal. They used to come from Google, which the service worker
  // leaves alone, so offline the app silently changed typeface -- the one
  // thing a home-screen install must not do.
  //
  // Two traps are worth naming, because both make a broken state look fine:
  //
  // 1. document.fonts.check() is useless here. It answered true for
  //    "300 16px Fraunces" on a page where the stylesheet had failed to load
  //    and nothing was rendering in Fraunces at all -- it reports whether the
  //    text can be painted, and fallback counts.
  // 2. So does asking whether the element's font-family says "Fraunces". That
  //    is the CSS as written, not what the browser could find.
  //
  // The only honest test is to measure: text set in Fraunces has to come out a
  // different width from the same text in the fallback, and the same width
  // offline as on. Measured on the version before this change, Fraunces and
  // serif were both 481.72px -- identical, because it was serif.
  const fontProbe = () => ({
    faces: [...document.fonts].map((f) => `${f.family} ${f.style} ${f.status}`).sort(),
    width: (() => {
      const w = (fam, wt, style) => {
        const s = document.createElement('span');
        s.textContent = 'Handgloves 12345';
        s.style.cssText = 'position:absolute;visibility:hidden;font-size:64px;white-space:pre'
          + `;font-family:${fam};font-weight:${wt};font-style:${style || 'normal'}`;
        document.body.appendChild(s);
        const r = +s.getBoundingClientRect().width.toFixed(2);
        s.remove();
        return r;
      };
      return {
        fraunces300: w('Fraunces', 300), fraunces600: w('Fraunces', 600),
        frauncesItalic: w('Fraunces', 500, 'italic'),
        work400: w("'Work Sans'", 400), work800: w("'Work Sans'", 800),
        serif: w('serif', 400), sans: w('sans-serif', 400),
      };
    })(),
  });

  // Only requests that actually leave the machine count. The app makes plenty
  // of blob: requests for its own photographs -- those are same-origin objects
  // it created itself, and counting them reported the app as calling out to
  // three of its own pictures.
  const thirdParty = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!/^https?:\/\//.test(u)) return;
    if (!ours(u)) thirdParty.push(u);
  });

  await page.goto(`${BASE}/the-rail.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('#main')?.children.length > 0,
    { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  const online = await page.evaluate(fontProbe);

  if (online.faces.length !== 3) {
    failures.push(`fonts: expected three faces loaded, got ${JSON.stringify(online.faces)}`);
  }
  if (online.faces.some((f) => !f.endsWith('loaded'))) {
    failures.push(`fonts: a face did not load: ${JSON.stringify(online.faces)}`);
  }
  if (online.width.fraunces600 === online.width.serif) {
    failures.push('fonts: Fraunces measured the same as the serif fallback, so it is the fallback');
  }
  if (online.width.work400 === online.width.sans) {
    failures.push('fonts: Work Sans measured the same as the sans fallback, so it is the fallback');
  }
  // One file covers a weight range. If the range were wrong the browser would
  // synthesise, and every weight would come out the same width.
  if (online.width.fraunces300 === online.width.fraunces600) {
    failures.push('fonts: Fraunces 300 and 600 are the same width, so the weight axis is not working');
  }
  if (online.width.work400 === online.width.work800) {
    failures.push('fonts: Work Sans 400 and 800 are the same width, so the weight axis is not working');
  }
  if (online.width.frauncesItalic === online.width.fraunces300) {
    failures.push('fonts: italic Fraunces measured as upright, so the italic face is not being used');
  }

  // The app is meant to reach no one. Not a privacy claim in the README any
  // more -- a thing the build checks.
  if (thirdParty.length) {
    failures.push(`fonts: the app still called out to ${[...new Set(thirdParty)].join(', ')}`);
  }

  // And the point of all of it: with the network gone, the app comes up and
  // looks the same. page.route cannot do this -- it never sees requests the
  // service worker answers -- so the context really goes offline.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.context().setOffline(true);
  try {
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('#main')?.children.length > 0,
      { timeout: 20000 });
    await page.evaluate(() => document.fonts.ready);
    const offline = await page.evaluate(fontProbe);
    if (JSON.stringify(offline.width) !== JSON.stringify(online.width)) {
      failures.push('fonts: the app rendered differently offline'
        + ` (online ${JSON.stringify(online.width)}, offline ${JSON.stringify(offline.width)})`);
    }
    if (offline.faces.some((f) => !f.endsWith('loaded'))) {
      failures.push(`fonts: a face failed to load offline: ${JSON.stringify(offline.faces)}`);
    }
  } catch (e) {
    failures.push(`offline: the app did not come up with no network (${e.message})`);
  }
  await page.context().setOffline(false);

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
