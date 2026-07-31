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
