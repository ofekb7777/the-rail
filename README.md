# THE RAIL

A wardrobe app that photographs your clothes, learns what goes together, and
tells you what to wear. One HTML file. No accounts, no server, no API keys.

Everything — the styling engine, the colour science, the background removal —
runs in your browser. Nothing about your wardrobe ever leaves your device.

---

## Running it

**Just open `the-rail.html`.** Double-click it. That works.

There is one reason to prefer a local server: browsers only grant geolocation
and service workers to *secure* origins, and `file://` is not one. So if you
want the weather lookup to work, serve it over `http://localhost` instead.

If you have Git for Windows, you already have everything needed — it bundles
Perl:

```bash
perl serve.pl
```

Then visit <http://localhost:8000/>. Pass a port to use a different one
(`perl serve.pl 3000`).

Any other static server does the job equally well:

```bash
python -m http.server 8000
```

```bash
npx serve
```

## On your phone

The layout is built for a phone first; the desktop view is the afterthought.

To try it over your local network, run the server above, find this machine's
LAN address with `ipconfig`, and open `http://<that-address>:8000/` on a phone
connected to the same Wi-Fi.

In Safari or Chrome, **Add to Home Screen** gives you a genuine fullscreen app
with no browser chrome. The camera button opens the rear camera directly.

> **Your wardrobe lives on the device that created it.** Storage is IndexedDB,
> which is per-browser and per-device — so your phone and your laptop keep
> entirely separate wardrobes, and photos do not sync between them. To move
> between devices, use **Export backup** in settings and import the JSON on the
> other side. This is the trade for having no server and no account.

## Deploying

It is a static file, so any host will take it. For GitHub Pages: push the repo,
then Settings → Pages → Source: `main` / root.

Note that Pages requires a **public** repository on a free account, which makes
the source world-readable. Only the code is exposed — your clothes, photos, and
wear history stay in your browser's storage and are never uploaded anywhere.

## What talks to the network

Four external references, and no API key for any of them:

| What | Why | If it fails |
|---|---|---|
| `fonts.googleapis.com` | Fraunces + Work Sans | Falls back to system fonts |
| `api.open-meteo.com` | Weather for the daily suggestion | Suggestions ignore weather |
| `pinterest.com`, `google.com` | Outbound "find similar" links | — |

Open-Meteo is free and keyless. Offline, the app works fully except that it
stops factoring temperature into what it recommends.

## How the suggestions work

There is no language model here. Outfits are scored on five axes:

- **Colour harmony** — pairwise distance in CIE-Lab, matched against
  complementary / analogous / triadic / neutral-anchor / monochrome rules
- **Formality** — inferred per garment, then penalised for spread within a look
- **Warmth** — garment-by-garment insulation against the forecast, with
  footwear weighted separately from body layers
- **Rotation** — favours things you have not worn lately
- **Affinity** — learns which pieces you actually wear together

Attributes are inferred from item names with a keyword table, so "black wool
overcoat" is understood as formal, warm, and outerwear without you tagging it.

**What am I missing?** counts how many workable outfits your wardrobe can
already produce, then works out which single unowned piece would add the most.

## Storage

IndexedDB, with a localStorage fallback if it is unavailable. Photos are
downscaled and stored as JPEG data URLs. Use **Export backup** for a portable
JSON snapshot — that file is the only copy that outlives the browser.
