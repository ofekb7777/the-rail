# THE RAIL

**Live: <https://ofekb7777.github.io/the-rail/>** — open it on a phone and
choose *Add to Home Screen* for a fullscreen app that works offline.

A wardrobe app that photographs your clothes, learns what goes together, and
tells you what to wear. One HTML file. No accounts, no server, no API keys.

Everything — the styling engine, the colour science, the background removal —
runs in your browser. Nothing about your wardrobe ever leaves your device.

---

## Running it

**Just open `the-rail.html`.** Double-click it. That works.

There is one reason to prefer a local server: browsers only grant service
workers to *secure* origins, and `file://` is not one. So if you want the app
to keep working offline once it has been opened, serve it over
`http://localhost` instead.

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

## Trying it without photographing anything

Settings → **Demo wardrobe** → *Add demo pieces* fills the rail with twenty
garments and a month of wear history, so suggestions, planning, gap analysis
and your rotation stats all have something to work with immediately.

The pieces are drawn on a canvas when you ask for them rather than shipped as
image files, so they cost nothing until used. They sit alongside anything of
your own and **Remove demo pieces** takes out exactly those, along with the
wear history that came with them, leaving your own things untouched.

## On your phone

The layout is built for a phone first; the desktop view is the afterthought.
The camera button opens the rear camera directly.

To try it over your local network, run the server above, find this machine's
LAN address with `ipconfig`, and open `http://<that-address>:8000/` on a phone
connected to the same Wi-Fi.

### Installing it to the home screen

Open the deployed page and choose **Add to Home Screen** — Share menu in
Safari, the ⋮ menu in Chrome. You get a fullscreen app with its own icon and
no browser chrome.

Two things have to be true for that to be a real install rather than a
bookmark, and both are why a deployed URL matters more than it looks:

- **It must be the top-level page.** A manifest is ignored inside an iframe, so
  installing from a page that embeds this app captures the wrapper instead.
- **It should be served over https** (or localhost). The service worker only
  registers on a real origin, and without it the icon opens to a network error
  the first time you are underground.

With both in place the app opens with no signal at all: `sw.js` caches the
page on first visit and serves it when the network is gone. It is network
first, so edits still appear immediately when you do have a connection.

Opened straight from disk, the worker is skipped — the file is already local.

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

One external reference, no API key, and nothing that is told anything about
your wardrobe:

| What | Why | If it fails |
|---|---|---|
| `fonts.googleapis.com` | Fraunces + Work Sans | Falls back to system fonts |

The only other request is to `version.json` on this same origin, which is how
the app tells you whether it is the current copy. There are no outbound links
to anywhere; nothing is fetched to make a suggestion. How cold it is out is a choice you
make on the Today tab — Cold, Mild or Warm — rather than something the app
asks a weather service about behind your back.

## Photographing a piece

The colour reader and the background cut-out both work off the same thing: the
outer edge of the photo. Every rule below is one the code actually applies.

1. **Put the piece down on one plain surface.** The app samples the frame's
   border to find the backdrop, and refuses to cut when that border is too
   varied — above a variance of 46. A plain wall measures near 0; a shoe held
   up in a room, with a desk, a floor and a monitor all touching the edges,
   measures about 150. Paper, a door or a bedsheet is enough.
2. **Leave a clear margin.** Nothing but that surface should touch the frame
   edge — no hands, no table edge, no skirting board.
3. **Don't hold it.** A hand becomes part of the subject and skin skews the
   colour.
4. **Contrast with the surface.** Dark on pale, pale on dark. Black on a
   near-black rug reads as charcoal; a white shirt on white paper is consumed
   by the fill and the cut is refused.
5. **Fill roughly half the frame.** Under about 1% of the frame is treated as
   clutter; if the fill cannot clear at least 10% of the frame there is no
   background to remove.
6. **Even, indirect light.** Pixels brighter than 250 or darker than 26 carry
   no usable hue and are discarded, so no flash and no hard sun.
7. **Warm bulbs are corrected up to a point.** The illuminant estimate is only
   trusted within a band; beyond it the correction is refused rather than
   half-applied, and colours read warm. A window beats a lamp.
8. **One piece per photo**, straight on, whole thing in frame.

The same list is in the app, under *Add piece*.

### What the photo decides, and what it asks you

Two things are read off the picture, and they are read with very different
confidence.

**The colour** is measured, and it is reliable. Across 78 test photographs —
six colours over warm and cool light, dark, white, wood, green and purple
surfaces, and four framings — every hue read correctly. The misses left are
neutrals: black and white against cluttered edges, and white under a warm bulb,
which is the documented limit of the illuminant estimate. If the reading is not
what you see, the four next-best candidates are offered as dots beside it.

Note that colour survives a *refused* cut-out. The two are independent: the app
can decline to remove a background and still name the garment correctly, down to
about a third of a percent of the frame.

**The category is guessed only when the silhouette is unmistakable**, and
otherwise it asks. Measured off the app's own garment renders, height against
width comes out as:

| shoe | knit | sneaker | top | skirt | outerwear | dress | boot | bottom |
|---|---|---|---|---|---|---|---|---|
| 0.53 | 0.65 | 0.67 | 0.70 | 0.83 | 0.84 | 1.09 | 1.25 | 1.71 |

Which separates trousers cleanly — nothing else comes near 1.5 — and separates
nothing else at all. A shoe at 0.53 and a sneaker at 0.67 sit either side of a
folded knit at 0.65, so no threshold on shape alone can tell footwear from a
jumper without claiming half the tops too. Footwear therefore needs a second,
independent condition: wide *and* small. No garment is both.

Everything else is left blank and outlined, and the save is held until you
answer it. That is deliberate. The previous behaviour defaulted to *Top*, which
meant photographing your shoes and not typing a name filed them as a shirt,
silently — and you would find out weeks later in your stats rather than at the
moment you could have fixed it. Typing a name still sets the category on its
own, so "purple shoes" or "jordan 1" needs no dropdown.

## How the suggestions work

There is no language model here. Outfits are scored on five axes:

- **Colour harmony** — pairwise distance in CIE-Lab, matched against
  complementary / analogous / triadic / neutral-anchor / monochrome rules
- **Formality** — inferred per garment, then penalised for spread within a look
- **Warmth** — garment-by-garment insulation against the band you picked
  (Cold / Mild / Warm), with footwear weighted separately from body layers
- **Rotation** — favours things you have not worn lately
- **Affinity** — learns which pieces you actually wear together

Attributes are inferred from item names with a keyword table, so "black wool
overcoat" is understood as formal, warm, and outerwear without you tagging it.

**What am I missing?** counts how many workable outfits your wardrobe can
already produce, then works out which single unowned piece would add the most.

Every look shows a swatch strip with the rule that fits it — *Analogous*,
*Neutral anchor*, *Complementary* and so on — and one sentence saying what that
rule is doing in this particular look. The rule is named once, on the strip
beside the colours it describes, rather than repeated as a pill in the row
below.

## Looking at a look

Outfits are shown laid out — the garments arranged the way you would lay them
on a bed. Outer and top share the top row, legs beneath, shoes beneath those,
and the smaller things are set off below a rule, because a bag does not go
under the boots.

This replaced a grid of equal captioned tiles. The grid answered *which things
are in this?*; it could not answer *does this go together?*, which is a
judgement about proportion and about where the colours sit relative to each
other. Sizes are therefore set per category rather than per photo — a shoe
photographed close up and a coat photographed from further back arrive at the
same pixel dimensions, and drawing them the same size is exactly what makes a
collage look wrong. Pieces stay tappable: anything with ⇄ has alternatives.

### Why the backgrounds disappear

A lay-out only reads as one if the garments are separated from whatever they
were photographed on. Two things make that happen.

**The stored photo.** The cut-out at import paints the background white. If you
skipped it, or it declined, *Cut out the background* on the piece's own detail
sheet does it after the fact — and offers to put it back, since the photo it
edits is the only copy you have. When the cut declines because the background
is too cluttered, the button offers to overrule it, exactly as the import does.

**The knockout at display time.** White on paper is still a white rectangle, so
the lay-out builds a copy of each photo with real transparency. The rule is not
*"white pixels go"* — that hollows out a white shirt. It is the same rule the
cut-out uses: flood inward from the border and take only the pale pixels
actually **connected to the edge**. A white shirt's middle is not connected to
the border, because the shirt is in the way, so it survives; a photo that was
never cut has a room at its border rather than white, so nothing is taken and it
is shown exactly as it is. The threshold sits at 246 rather than 228 for that
reason — at 228 it ate the middle out of a white shirt, and losing a garment is
much worse than leaving an edge on a photo you never cut. If the fill ends up
taking almost the whole frame it is refused outright, on the grounds that it has
clearly eaten the garment too.

Blending the photo with `mix-blend-mode: multiply` was tried first and is not
enough: photos are stored as JPEG, JPEG keeps no pure white, and the near-white
that comes back multiplies into a faint rectangle around every piece.

The copy is cached for the session and never written to storage — it is a way of
*showing* the photo, not an edit to it.

A piece photographed against a genuinely busy background cannot be isolated by
any of this, and will still read as a rectangle. The fix for that one is the
camera: see **Photographing a piece** above.

## The back gesture

Swiping back, or pressing Back, closes whatever panel is open instead of
leaving the app. One history entry is pushed when the first sheet opens and
handed back when the last one closes, so the stack does not grow a level deeper
every time you open and dismiss a sheet — and a back press with nothing open
still exits, as it should.

## Versions

The app knows which version it is and can tell you whether it is the current
one. `Settings → Version` shows the copy you are running and one of four
answers: up to date, a newer version is available, could not reach the server,
or opened from a file so there is nothing to check against. When a newer one
exists a bar appears under the tabs with a **Reload** button, since a cached
copy of a web app can otherwise sit a version behind indefinitely without ever
saying so.

The version string lives in three places and they must match:

| Where | What it is |
|---|---|
| `APP_VERSION` in `the-rail.html` | what this copy believes it is |
| `version.json` | what the site says is published |
| `VERSION` in `sw.js` | names the cache, so publishing retires the old one |

**Bump all three in the same commit.** The smoke workflow compares them and
fails the build if they drift — if they did, a current app would report itself
stale forever, or worse, a stale one would report itself current.

`version.json` is deliberately never cached by the service worker: a stale copy
of the app must not be able to reassure itself from its own cache.

## Diagnostics

`Settings → Diagnostics → Run diagnostics` gathers what the app can see about
the device it is on — version and update status, how it was opened, service
worker state, storage backend and usage, viewport and page heights, the
overflow of every element in the layout chain, and the user agent — as text
with a copy button.

It exists because a scrolling fault was reported that could not be reproduced
on any desktop browser, and turned out to be a phone still running a copy of
the app from before the fix. The one measurement worth understanding is the
scroll probe: it moves the page from script and reports how far it got, which
separates *a page that cannot scroll* from *a page that can but will not for a
finger*. Those are entirely different faults.

## Storage

IndexedDB, with a localStorage fallback if it is unavailable. Photos are
downscaled and stored as JPEG data URLs. Use **Export backup** for a portable
JSON snapshot — that file is the only copy that outlives the browser.
