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
