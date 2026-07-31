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

    // ---- the box you draw round a piece ----
    // A pale piece resting on a pale desk edge that runs right across the
    // frame -- the shape of the failure a real photograph showed, where the
    // fill escaped out of a white trainer and along the furniture it was held
    // over. Automatic detection has no way to know where the shoe stops. The
    // box is exactly that missing fact, so what is under test is that drawing
    // one removes the leak and keeps the piece.
    const inARoom = () => mk((x) => {
      x.fillStyle = '#c2b8a2'; x.fillRect(0, 0, 200, 200);        // the room
      x.fillStyle = '#3a3f4d'; x.fillRect(0, 14, 54, 26);         // something dark in shot
      x.fillStyle = '#efedea'; x.fillRect(0, 96, 200, 12);        // a desk edge, right across
      x.fillStyle = '#f2f0ec'; x.fillRect(62, 78, 78, 44);        // the piece, resting on it
    });
    const kept = (r, w3) => {
      let n = 0;
      for (let i = 0; i < r.mask.length; i++) if (!r.mask[i]) n++;
      return n;
    };
    const box = { x0: 0.28, y0: 0.35, x1: 0.72, y1: 0.62 };
    const noBox = subjectFromCentre(inARoom());
    const boxed = subjectFromCentre(inARoom(), box);
    const piece = 78 * 44;
    if (!boxed) missed.push('a box round the piece was refused outright');
    else {
      const w3 = 200;
      if (boxed.mask[97 * w3 + 100]) missed.push('the box cut away the piece inside it');
      if (!boxed.mask[10 * w3 + 10]) missed.push('the box kept the room around it');
      if (!boxed.mask[101 * w3 + 8]) missed.push('the box let the fill escape along the desk');
      // Nothing outside what you drew may survive. This is the promise the
      // relaxed guards are traded against, so it has to hold exactly.
      // The same rounding the app uses. Comparing against box.x0 * 200
      // directly says 56 >= 56.000000000000006 is false and reports the box's
      // own left-hand column as a leak.
      const bx0 = Math.floor(box.x0 * 200), bx1 = Math.ceil(box.x1 * 200);
      const by0 = Math.floor(box.y0 * 200), by1 = Math.ceil(box.y1 * 200);
      let out = 0;
      for (let y = 0; y < 200; y++) for (let x2 = 0; x2 < 200; x2++) {
        const within = x2 >= bx0 && x2 < bx1 && y >= by0 && y < by1;
        if (!within && !boxed.mask[y * w3 + x2]) out++;
      }
      if (out) missed.push(`${out} pixels were kept from outside the box`);
      if (kept(boxed) > piece * 1.2) {
        missed.push(`the box kept ${Math.round(kept(boxed) / piece * 100)}% of the piece's own area`);
      }
      // and it has to be an improvement on guessing, not merely different
      if (noBox && kept(noBox) <= kept(boxed)) {
        missed.push('the box was no tighter than the automatic reading - the test proves nothing');
      }
    }

    // A hint that says nothing must change nothing. A box drawn round the
    // whole frame tells us only what was already assumed, so it has to give
    // the automatic answer back exactly.
    //
    // Worth knowing what this does and does not cover. Two real bugs of this
    // shape have been fixed -- the frame's rim being sampled twice into the
    // backdrop model once a box was present, and the seed being taken from
    // the box's inner half rather than its middle third -- and both made a
    // looser box give a worse answer than a tighter one. Neither is caught
    // here. They were found on photographs and only show on one: these
    // painted scenes have too few colours for the sampling proportions to
    // change which clusters survive, so the models come out identical either
    // way. What this does hold down is the structure -- that a box is a
    // refinement of the automatic path and not a separate one.
    const twin = () => mk((x) => {
      x.fillStyle = '#cfc9bd'; x.fillRect(0, 0, 200, 200);
      x.fillStyle = '#7fa8bf'; x.fillRect(0, 0, 200, 18);
      x.fillStyle = '#232323'; x.fillRect(52, 40, 96, 118);
    });
    const bare = subjectFromCentre(twin());
    const whole = subjectFromCentre(twin(), { x0: 0, y0: 0, x1: 1, y1: 1 });
    if (!bare || !whole) missed.push('a garment on a bed was refused with or without a whole-frame box');
    else {
      let differ = 0;
      for (let i = 0; i < bare.mask.length; i++) if (!!bare.mask[i] !== !!whole.mask[i]) differ++;
      if (differ > bare.mask.length * 0.01) {
        missed.push(`a box round the whole frame changed the answer (${differ} pixels)`);
      }
    }

    return missed;
  });
  for (const m of layMisses) failures.push(`laid out: ${m}`);

  // Drawing the box is the whole feature, and it lives in the detail sheet
  // rather than in any of the functions above. What is checked here is the
  // interaction: that a drag stores what you drew, that the app draws it back,
  // that a stray tap does not silently throw a good mark away, and that clear
  // clears. The first attempt at this was a single tapped point, which stored
  // fine and made the cut worse -- so "it stored something" is not the test,
  // "it stored the box you drew" is.
  const markMisses = await page.evaluate(async () => {
    const missed = [];
    const item = state.items[0];
    if (!item) return ['no item to mark'];
    delete item.cutMark;
    openDetail(item.id);
    const stage = document.getElementById('markStage');
    if (!stage) return ['the detail sheet offered no way to mark the piece'];

    // The stage has no height until the photo is in it. Measuring before that
    // gives a rect of zero height, and every coordinate below comes out NaN.
    for (let i = 0; i < 100 && stage.getBoundingClientRect().height < 1; i++) {
      await new Promise((res) => setTimeout(res, 50));
    }
    if (stage.getBoundingClientRect().height < 1) return ['the photo never appeared to mark'];

    // Coordinates are read fresh each time: the sheet is rebuilt after every
    // drag, so a rect captured once goes stale.
    const at = (fx, fy) => {
      const r = document.getElementById('markStage').getBoundingClientRect();
      return {
        clientX: r.left + r.width * fx, clientY: r.top + r.height * fy,
        pointerId: 1, bubbles: true,
      };
    };
    const drag = async (x0, y0, x1, y1) => {
      const el = document.getElementById('markStage');
      el.dispatchEvent(new PointerEvent('pointerdown', at(x0, y0)));
      el.dispatchEvent(new PointerEvent('pointermove', at((x0 + x1) / 2, (y0 + y1) / 2)));
      el.dispatchEvent(new PointerEvent('pointerup', at(x1, y1)));
      await new Promise((res) => setTimeout(res, 400));
    };

    await drag(0.25, 0.20, 0.75, 0.80);
    const m = state.items[0].cutMark;
    if (!m) missed.push('a drag across the photo stored no mark');
    else {
      const close = (a, b) => Math.abs(a - b) < 0.03;
      if (!(close(m.x0, 0.25) && close(m.y0, 0.20) && close(m.x1, 0.75) && close(m.y1, 0.80))) {
        missed.push(`the stored box is not the one drawn: ${JSON.stringify(m)}`);
      }
      // drawn back, so a second visit shows what the first one chose
      const drawn = document.getElementById('markBox');
      if (!drawn || drawn.style.display === 'none' || parseFloat(drawn.style.width) < 10) {
        missed.push('the stored box was not drawn back onto the photo');
      }
    }
    // Dragged backwards -- up and to the left -- must mean the same box.
    delete state.items[0].cutMark;
    openDetail(item.id);
    await new Promise((res) => setTimeout(res, 100));
    await drag(0.75, 0.80, 0.25, 0.20);
    const back = state.items[0].cutMark;
    if (!back || back.x1 < back.x0 || back.y1 < back.y0) {
      missed.push(`a box drawn bottom-right to top-left came out inside out: ${JSON.stringify(back)}`);
    }

    // A stray tap is not a box, and must not disturb the one you drew. Note
    // "unchanged" rather than "still there": without the minimum-drag guard a
    // tap stores a zero-sized box, which is present, useless, and has quietly
    // replaced a good mark. Checking only that something survived passes.
    const kept0 = JSON.stringify(state.items[0].cutMark);
    await drag(0.5, 0.5, 0.5, 0.5);
    if (JSON.stringify(state.items[0].cutMark) !== kept0) {
      missed.push(`a stray tap changed the mark: ${kept0} became ${JSON.stringify(state.items[0].cutMark)}`);
    }

    const clear = document.getElementById('clearMarkBtn');
    if (!clear) missed.push('a marked piece offered no way to clear it');
    else {
      clear.click();
      await new Promise((res) => setTimeout(res, 300));
      if (state.items[0].cutMark) missed.push('clearing the mark left it in place');
    }
    document.getElementById('detailOverlay').classList.remove('open');
    return missed;
  });
  for (const m of markMisses) failures.push(`marking: ${m}`);

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
    tee.cutMark = { x0: 0.1, y0: 0.12, x1: 0.9, y1: 0.88 };
    tee.showAsPhoto = true;
    tee.colorAuto = false;
    tee.brand = 'Vans';
    tee.image = 'data:image/png;base64,iVBORw0KGgo=';
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
      for (const f of ['favourite', 'cutMark', 'showAsPhoto', 'colorAuto', 'brand', 'image', 'name', 'category', 'color']) {
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

  // Written down is only half of it -- it has to be read back. Saving a setting
  // that never returns looks identical to saving it correctly until the next
  // launch.
  //
  // Turned off and saved right here rather than relying on an earlier block
  // having left it that way. It did, once; then another test called something
  // that writes prefs as a side effect, and this failed pointing at the cut
  // switch, which was not what was wrong. A test that depends on the state
  // another test happened to leave behind reports the wrong culprit.
  await page.evaluate(async () => { state.layCut = false; await savePrefs(); });
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
