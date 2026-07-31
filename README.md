# THE RAIL

**Live: <https://ofekb7777.github.io/the-rail/>** — open it on a phone and
choose *Add to Home Screen* for a fullscreen app that works offline.

A wardrobe app that photographs your clothes, learns what goes together, and
tells you what to wear. One HTML file, plus two typefaces beside it. No
accounts, no server, no API keys, and not a single request to anyone.

Everything — the styling engine, the colour science, the background isolation —
runs in your browser. Nothing about your wardrobe ever leaves your device, and
the photos you take are stored exactly as you took them.

---

## Running it

**Just open `the-rail.html`.** Double-click it. That works — including the
typefaces, which sit in `fonts/` next to it and load straight off the disk.
Keep that folder alongside the HTML if you move the file somewhere.

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

**Nothing.** No external host, no API key, no account.

The only request the app makes at all is to `version.json` on its own origin,
which is how it tells you whether it is the current copy. There are no outbound
links to anywhere; nothing is fetched to make a suggestion. How cold it is out
is a choice you make on the Today tab — Cold, Mild or Warm — rather than
something the app asks a weather service about behind your back.

This used to be one line short of true. Fraunces and Work Sans came from
`fonts.googleapis.com`, and while no wardrobe data went with the request, every
load still told Google that someone had opened the page from this address. The
two typefaces now live in `fonts/` beside the app — three woff2 files, 110 KB,
latin subset, under the SIL Open Font License that ships with them.

That also fixed a real bug rather than only a principle. The service worker
deliberately leaves cross-origin requests alone, so the stylesheet was never
cached: with no signal it never arrived and the app quietly fell back to system
fonts — the one thing a home-screen install is not supposed to do, done
invisibly. The smoke test now measures the rendered width of a line of text
online and offline and fails if they differ.

Two things that look like they would catch that and do not, recorded because
both were tried: `document.fonts.check('300 16px Fraunces')` answers **true**
on a page where the stylesheet failed and nothing is in Fraunces, because
fallback counts as being able to paint the text. Reading `font-family` off the
element is worse — that is the CSS as written, not what the browser found.

## Photographing a piece

The colour reader and the lay-out's background isolation both work off the same
thing: the outer edge of the photo. Every rule below is one the code actually
applies. Note that your photo is never altered — these rules decide how well the
app can *read* it, not what gets stored.

None of it is compulsory. If a photo comes out badly you can draw a box round
the piece afterwards and the app will read it from inside that — see
**Drawing a box round a piece** below.

1. **Put the piece down on one plain surface.** The app samples the frame's
   border to find the backdrop, and gives up on separating the piece when that
   border is too varied — above a variance of 46. A plain wall measures near 0; a shoe held
   up in a room, with a desk, a floor and a monitor all touching the edges,
   measures about 150. Paper, a door or a bedsheet is enough.
2. **Leave a clear margin.** Nothing but that surface should touch the frame
   edge — no hands, no table edge, no skirting board.
3. **Don't hold it.** A hand becomes part of the subject and skin skews the
   colour.
4. **Contrast with the surface.** Dark on pale, pale on dark. Black on a
   near-black rug reads as charcoal; a white shirt on white paper cannot be told
   from the paper, so the lay-out shows the photograph rather than a hole.
5. **Fill roughly half the frame.** Under about 1% of the frame is treated as
   clutter. A small piece is fine — a shoe covering a few percent isolates
   correctly — but the further away you stand, the more of the room ends up
   touching the frame edge, and that is what actually breaks it.
6. **Even, indirect light.** Pixels brighter than 250 or darker than 26 carry
   no usable hue and are discarded, so no flash and no hard sun.
7. **Warm bulbs are corrected up to a point.** The illuminant estimate is only
   trusted within a band; beyond it the correction is refused rather than
   half-applied, and colours read warm. A window beats a lamp — though see
   below, because in practice your phone has already done most of this.
8. **One piece per photo**, straight on, whole thing in frame.

The same list is in the app, under *Add piece*.

### How much the warm-bulb limit actually costs

Refusing a correction rather than clamping it is deliberate, and the cost looked
alarming when simulated. Applying an increasingly orange cast to a rendered
scene, the estimate is trusted up to about a 12% shift and refused past it, and
accuracy falls off a cliff:

| simulated cast | 0% | 12% | 18% | 24% | 30% | 40% |
|---|---|---|---|---|---|---|
| colours read right | 8/8 | 8/8 | 6/8 | 5/8 | 2/8 | 0/8 |

That simulation is not a photograph, though, and the difference matters. **A
phone applies its own auto white balance before it writes the JPEG**, so what
reaches the app is a residual, not a raw cast. Measured on real indoor photos
taken for this project under room lighting:

| photo | implied correction |
|---|---|
| trainers held up in a lit room | 3% |
| shirt on a bed | 2% — below the "leave it alone" floor |
| a whole room, lamps and daylight mixed | 5% |

None of them is within reach of the band's edge. The scenario the limit worries
about does not arise in phone photos; what does hit the limit is a strongly
coloured *surface* — wood, a blue wall, a rug — which is exactly what the
refusal is there to protect.

One idea that does not work, recorded so it is not tried again. The obvious
second reference is the brightest pixels in the frame: under a coloured light
even the highlights carry the cast, whereas under neutral light they should be
near-white. Measured, they are not. A brown piece on pale wood under perfectly
neutral light gives `[0.70, 0.97, 1.87]` — a *larger* implied correction than
any warm lamp produces — because when nothing white is in shot, the brightest
pixels are just the surface. It cannot tell a coloured light from a coloured
floor either, and is worse than what is there now.

### What the photo decides, and what it asks you

Two things are read off the picture, and they are read with very different
confidence.

**The colour** is measured, and it is reliable. Across 154 renders — all
twenty-two palette colours over seven surfaces from near-black to white, wood
and green — one reads wrong, and it offers the right answer second. Every hue
is correct; what is left is neutrals against neutrals.

Where it gets harder is a photograph rather than a diagram. Adding surface
texture, light falling off across the frame, and a shadow cast under the piece
— separately and all at once — gives 180 harder cases, of which 12 read wrong.
All twelve are a **pale** garment on a **pale** surface. Black, charcoal, navy,
brown and grey are right in every single one.

Six of those twelve used to be a specific and quite bad failure: a cast shadow
was kept as part of the subject, and on a white shirt photographed on a white
sheet the flood ate the *garment* and left only the shadow — so the colour was
read off the shadow and the shirt came back **grey**. The shadow is now
recognised as the surface dimmed rather than a thing lying on it. Silver, beige
and white on pale surfaces all read correctly now.

The remainder is honest ambiguity: a white shirt on a white sheet under uneven
light is genuinely hard to separate, and a person looking at the same pixels
would hesitate too. Photograph pale clothes on something darker — see the list
above — or draw a box round the piece, which re-reads the colour from inside it.

One thing worth knowing about how it fails. When the app *can* separate the
piece, it gets the colour right; when it cannot, it used to judge the colour off
the whole frame, which on a pale piece against a pale surface largely means
judging it off the surface. It now falls back to the middle of the photo
instead — the one thing still known about where a piece is, and the same
assumption the centre reading starts from. Measured across 180 renders including
pieces pushed well off centre, 166 read correctly before and 171 after, with
nothing correct becoming wrong.

That fallback matters more than its size suggests, because it is what a phone
photo actually hits. Every colour test used to be a *square PNG*; a phone
produces a tall JPEG, and the same piece at the same distance is a smaller share
of a taller frame. Beige on pale linen read "silver" in portrait, in landscape,
and at every JPEG quality while being correct in the square render beside it.
Those framings are now in the test suite.

If the reading is not what you see, the four next-best candidates are offered as
dots beside it.

Note that colour survives a background the app cannot separate. The two are
independent: it can decline to isolate a piece for the lay-out and still name
its colour correctly, down to about a third of a percent of the frame.

There are four categories — **Top, Bottom, Shoes, Accessory** — and nothing
else. A jacket is a warm top; a hat, a bag and a belt are accessories. The list
used to have nine, which meant nine things to read before every save. A wardrobe
or a backup made before the change migrates on open, so nothing is stranded on a
category the picker can no longer show.

The trade is layering: with no separate outerwear slot the app suggests one top
rather than a shirt with a coat over it, and a cold day is answered by how warm
that top is instead.

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

### When a look cannot be complete

A look is head to foot: something on top, something on the bottom, something on
your feet. If your wardrobe holds none of a category, the stylist builds without
it rather than refusing — a shirt and jeans is genuinely useful before you have
photographed your shoes.

What it used to do was say nothing about it. You pressed *What should I wear?*
with no shoes logged and got a card with a title, a percentage fit and no shoes
on it, which reads as a finished answer rather than the best available one. It
now says so on the card, with a way to add the missing pieces.

Sixty looks were generated across every occasion and temperature to check the
stylist keeps its own promises, and then again on wardrobes shaped awkwardly —
three pieces, no shoes, all formal, all one colour, twelve tops and one pair of
jeans. No look ever referenced a piece that did not exist, wore two tops at
once, used the same piece twice, or scored outside 0–100. Cold-weather looks
came out warmer than warm-weather ones for every occasion, Work dressier than
Everyday, and Sport more casual than both — which are the profiles' own claims,
now checked rather than assumed.

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

**Your photo is never edited.** It is stored exactly as taken, and nothing in
the app writes over it. An earlier version cut the background into the stored
photo at import; that was a one-way change to the only copy in existence, and
on a cluttered photo it mangled the piece rather than freeing it. If your
wardrobe still holds a photo from that version, it is restored to the original
the next time the app opens.

Isolation happens **at display time, in the lay-out only**. Each photo gets a
copy with real transparency, built by measuring the frame's border to find what
the piece was photographed on, then flood-filling inward from the edge. Being
wrong there costs a plain-looking tile and nothing else, which is why the rules
can be strict:

- **A cluttered border is refused outright** — above a variance of 46, the same
  bar the colour reader uses. Your floor with a desk and a rug in shot is left
  as a photograph.
- **A fill that takes almost the whole frame is refused** — it has clearly eaten
  the garment along with the surface. This is what saves a white shirt on a
  white sweep: the app shows the photo rather than a hole where the shirt was.
- **A piece may be small.** The test is not how much of the frame the fill
  took but whether one coherent island survives it — at least 1.2% of the
  frame, the same floor the cut-out uses to decide a subject exists. Judging by
  how much went instead refused footwear at any sensible framing: a shoe
  covering 3.2% of its frame was rejected while a coat at 19.7% went through,
  and eating a garment leaves scattered fragments where a small garment leaves
  one shape.
- **A cast shadow is treated as backdrop.** A piece lying on a sheet shades it,
  and the shadow is not the sheet's colour — so without this the garment comes
  out with a dark blob welded to it, measured at 23% of the frame kept instead
  of 13%. Shading is the surface *dimmed*, so a pixel that is the border colour
  scaled down counts as background. The band is narrow on purpose: a shadow and
  a garment that happens to be a darker shade of the surface are the same
  pixels, and it is safer to keep a shadow than to eat a jumper. A brown piece
  on a tan sheet survives; a tan piece on a tan sheet is refused outright.
- **The tolerance is tighter than the old cut-out's**, because that one could be
  compared against an original and undone. This one has to be right first time,
  on every render, so it errs towards leaving a rim of backdrop rather than
  taking a bite out of the garment.

Pieces sit at a slight angle rather than square, two on a row lean away from
each other and overlap, and each is nudged a little off centre — because nobody
lays clothes out on a grid, and everything dead straight is the tell that a
machine arranged it. The angle comes from the piece's own id, not a random
number: a look that tilted differently every time you opened it would be far
worse than one that never tilted at all, so a given garment sits the same way
every time you see it.

Every isolated piece is then given a **white outline**, the way a sticker is cut
with a border. It is not decoration: it is what buys the isolation room to be
imprecise. A flood fill stops in a slightly different place all the way round a
garment, and against a flat backdrop that raggedness is what the eye catches.
Under a uniform ring, a wobble of a pixel or two stops being visible — the edge
you see is the ring's, and that one is smooth by construction. What it cannot do
is hide a mistake bigger than itself: a corner of floor left attached gets
outlined too, which draws the eye rather than away, so the refusals above stay
exactly as strict.

A piece that could not be lifted at all is framed as a photograph — rounded,
softly shadowed — rather than left as a bare square, so it reads as a picture of
the thing on a table rather than a cut-out that went wrong.

### Turning the cut off

Under the lay-out on **Today** there is a switch: *Pieces are cut out of their
photos* / *Showing the photos as taken*. It is on by default, because a lay-out
of cut-outs is the point of the view — but the cut is a guess, and when it
guesses wrong on a piece there has to be a way to see the photograph instead of
arguing with it.

Switched off, every piece takes the same path as one that could not be lifted:
framed as a photograph. Nothing is decoded or cut, so it is also the quickest
way to draw the view. The setting is remembered.

It sits beside the lay-out rather than in Settings because it is a thing you
judge by looking — you can see the cut is wrong, and the switch is right there
under it.

There is a second, narrower version of the same thing. Open any piece and there
is *Or just show this one as a photo* under the marking box. The Today switch is
the blunt instrument and answers "I do not want cut-outs"; this answers the far
more common "that one came out wrong", which is a judgement about a single
photograph and should not cost you the cut-outs that worked. Turning it back on
is instant — the lifted copy is kept, not thrown away.

### Drawing a box round a piece

Some photographs cannot be read automatically and no amount of tuning will
change that. A white trainer held over a cream desk is the clearest case: the
shoe and the furniture are the same colour, they touch, and nothing in the frame
says where one stops. Every attempt at guessing it produced the room.

So open the piece and **drag a box round it**. Everything outside the box is
dimmed as you drag. The box is not a hint the reader weighs against other
evidence — it is a hard boundary:

- the piece is described from the box's **middle third**, so a loose box does
  not teach the reader that the bedspread either side is cloth;
- the backdrop is described from the frame's rim **and** everything outside the
  box, which is the part you have just ruled out;
- the fill cannot cross the box, so **nothing outside it can survive** — which
  is what makes it safe to relax the guards that would otherwise refuse the
  photo outright.

The tighter the box, the better the cut, with no reversals: a box drawn round
the whole frame gives back exactly the automatic answer, and every box tighter
than that is at least as good. Measured on two real photographs, a snug box was
the first thing to cut the hem of a black shirt cleanly off a bedspread, and the
first to get a shoe out of a room at all.

Drawing a box also **re-reads the colour** from inside it. A wrong cut and a
wrong colour are usually the same mistake — when the piece could not be told
from the room, the colours were sampled off the room too. A colour you set by
hand is left alone; only the app's own guess is replaced. The category is never
touched, because it is confirmed by hand before an item can be saved, and
quietly changing an answer you gave is worse than leaving a stale one.

A **single tapped point was tried first and was worse than nothing**. It says
which object you mean but nothing about where it ends, so on the trainer the
fill grew out through the desk exactly as before, now with the app's confidence
behind it. A box gives location and extent in the same one gesture. A tap that
is not a drag — under 6% of the photo in either direction — is ignored rather
than stored, so a mis-touch cannot throw away a good mark.

The transparent copy is cached for the session and never written to storage: it
is a way of *showing* the photo, not an edit to it.

Blending with `mix-blend-mode: multiply` was tried first and is not enough:
photos are JPEG, JPEG keeps no pure white, and the near-white that comes back
multiplies into a faint rectangle around every piece.

So the lay-out looks best on pieces photographed against one plain surface —
see **Photographing a piece** above. That is the same advice the colour reader
wants, for the same reason: both work off the outer edge of the frame.

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

Because it is the only copy, the round trip is tested rather than assumed: a
wardrobe is exported, the app is emptied, and the file is read back. The pieces,
saved looks, wear log and plans all have to return, along with every per-item
field — the photo, the brand, the favourite mark, the box you drew round a
piece, and whether you asked for it to be shown as a photograph.

One deliberate exception. Warmth, formality and tags are **re-inferred from the
name on import** for anything still on the app's own guess, so a backup taken
before a keyword was added benefits from it. Anything you corrected by hand is
kept exactly as you set it — that is what the *auto* flag on each attribute is
for, and the test checks it specifically, because a silent partial loss is the
failure that matters here. Everything would look fine; only weeks later would it
emerge that every warmth you fixed had been quietly re-guessed.
