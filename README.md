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

None of it is compulsory. If a photo comes out badly, open the piece and rub the
background away with your finger — see [Cutting by hand](#cutting-by-hand) below.

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

The remainder is honest ambiguity *for a method that works on colours alone*: a
white shirt on a white sheet under uneven light cannot be separated by measuring
its edges, and a person looking only at those pixels would hesitate too.
Photograph pale clothes on something darker — see the list above — or
[cut it by hand](#cutting-by-hand): rub the background away with your finger, and
the colour is re-read off whatever you kept.

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

### What goes with what — on trial

Four blocks at the bottom of **Stats**, each marked `TEST` on screen, all of
them provisional. They answer a question the rest of the app does not: not what
you have *worn*, but what actually *works*.

The distinction matters and the app had been quietly conflating the two. A piece
gathers dust either because you do not feel like it or because it goes with
nothing you own — only the second is a wardrobe problem, and nothing here could
tell them apart. On the demo wardrobe the difference is immediate: a white
oxford shirt sits in *Most worn* at six wears **and** in *Barely connects* at
six looks out of 156. Worn constantly, works with almost nothing.

| Block | What it says |
|---|---|
| **What goes with what** | the pieces appearing in the most workable looks — your anchors |
| **Barely connects** | the pieces appearing in the fewest, and the one thing that would rescue each |
| **Never worn together** | complete looks your wardrobe can already make and you have never put on — nothing to buy |
| **Worth reconsidering** | in no working look *and* never worn, with what would fix it before you write it off |

All four come from a single pass over the same cached list of workable
combinations, so the whole section costs one traversal. Measured at 500 pieces:
6 ms for the analysis, 147 ms for the entire Stats tab.

**One honest limit.** The counter only ever looks at the first 22 pieces in each
category, so that counting stays instant. Past that the totals are a sample
rather than the truth, and the section says so rather than printing a confident
wrong number — on a large wardrobe the real count runs into the thousands.

These are on trial and may be removed. That is what the `TEST` tags are for.

### What else was swept, and found sound

Recorded because a negative result is worth as much as a fix, and because it
says what has actually been looked at.

| Area | Checked | Result |
|---|---|---|
| Swapping a piece | only same-category alternatives, never one already in the look, never itself; the look keeps its length and gains no duplicates | sound |
| The wear log | one entry per wear, reaching the stats immediately, surviving the piece being deleted, capped at 800 keeping the **newest** | sound |
| Plan and calendar | thirteen months either side, plans landing on the day they were made for, a planned piece then deleted | sound |
| Stats | counts agreeing with a wear log written by hand, and a log referring to pieces that no longer exist | sound |
| Speed | 500 pieces with 400 wear entries | stylist 40ms, stats 5ms, all five tabs 125ms; the gap analysis is the slowest at ~460ms, and it is behind a switch |

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

### Cutting by hand

Everything described above is arithmetic on colours: measure the frame's border,
decide what is backdrop, flood inward. It works on a garment put down on
something plain, and it cannot be made to work on a **white trainer held up in a
lit room** — a white shoe and a cream desk are the same colour with no edge
between them.

That case used to be answered by an 18 MB segmentation model, downloadable from
Settings. It has been taken out. What replaced it is your finger.

Open a piece and the panel shows the cut the app worked out, against a
chequerboard so you can see what has gone transparent.

| | |
|---|---|
| **Rub out** | drag over anything that is not the piece: the desk, your hand, a shadow |
| **Bring back** | drag over any part of the piece the cut took away |
| **Reset** | the app's own reading again |

No width picker and no undo. It got there by subtraction — a tapped point, then
a dragged box, then the model, then a box with two brushes *and* a width picker,
each one another thing to learn before you could fix a picture.

Rubbing out on its own was tried and is a step too far: one careless sweep across
a hem costs the whole mask, because reset is the only other way back, and a brush
you are wary of using is worse than one more button. Bringing back is the
correction to a correction, so the brush starts pointing at *rub out* every time
a piece is opened.

**Bring back is literal, not clever.** It returns whatever the photograph holds
under the brush — drag it across a cast shadow and you get the shadow.

A painted mask outranks the automatic reading, because it was only made when the
automatic one was wrong.

**How often this is needed.** Measured over 180 renders — nine neutrals on four
surfaces under five lighting conditions, the light falling on the whole scene:

| the automatic cut, against the garment's true silhouette | |
|---|---|
| refuses outright | 26 / 180 |
| below 0.80 IoU | 65 / 180 |
| at or above 0.95 IoU | 94 / 180 |
| median IoU where it does not refuse | **0.987** |

So it is bimodal rather than mediocre: when it separates the piece it is
essentially exact, and on about a third of hard photographs it either gives up or
mangles it. Those are the ones worth a few strokes. A refusal deliberately seeds
as *all of this is the piece*, so there is a background to rub away — seeding it
empty would hand you a blank frame and ask you to trace a garment onto it, which
is not something anybody finishes on a phone.

**What it is worth to the colour reading — honestly, not much.** Over the same
180 renders, comparing what the app says on its own against what it says off a
mask that is exactly the garment's silhouette:

| | correct |
|---|---|
| the app on its own | 145 / 180 |
| off a perfect mask | 147 / 180 |

Two. The colour reader already falls back to the middle of the frame when the
mask fails, which recovers most of what a better mask would have given it, and
what remains is not a mask problem: it is a white shirt in a scene darkened by a
third genuinely having silver-ish pixels, and the app naming the pixels it has.
Skipping the white-balance correction moves that 147 to 144, so the correction
is not the culprit either.

So the case for cutting by hand is not an accuracy table. It is that on the third
of photographs where the arithmetic fails, there is now an answer that cannot be
wrong, because you are looking at it while you give it — and it costs nothing to
carry. The app is 380 KB with no model in it, and the masks are
6–11 KB per piece (8 KB measured on a shirt), stored as PNGs beside the photo.

**The 18 MB is removed automatically.** The model lived in a cache of its own,
`the-rail-model-v1`, so that app updates would not throw it away. The service
worker no longer keeps that cache, and its `activate` handler deletes any cache
it does not recognise — so the first launch of this version frees the space on
its own. The masks the model had worked out are dropped on load for the same
reason: nothing left in the app can produce or check them.

### The 180/180 that does not reproduce

An earlier version of this file reported the model taking the colour from
168/180 to 180/180. It does not reproduce. A *perfect* mask — the garment's own
silhouette, which no model can beat — reaches **147** on the sweep above, and
**168** on the gentler variant that lights only the backdrop. Neither lands
anywhere near 180.

Two mechanisms were tested for why a real mask might beat a perfect one, because
both would have been worth shipping:

**Could the boundary be the problem?** A perfect silhouette includes its own
antialiased edge, where every pixel is part garment and part surface. Pulling the
mask inward should drop them.

| mask pulled in by | correct |
|---|---|
| 0 px | 147 / 180 |
| 2, 4, 7, 10 px | 147 / 180 |

Identical at every radius. The instrument was checked rather than trusted — the
kept area really does fall, 25 688 → 17 154 pixels across that range — so this is
a real null. The colour reader samples on a grid about five pixels apart, and a
boundary a few pixels wide simply does not contribute enough samples to matter.

**Could the shading be the problem?** u2net produces a saliency map, which tends
to favour the well-lit core of an object — and shade on a pale garment is exactly
what drags a white shirt to "silver". So: read the colour off the brightest
quarter of the garment instead of all of it. On the neutral sweep that gains ten
scenes, 147 → 157, entirely in the pale neutrals and with nothing lost at the
dark end.

Then the same idea against every colour the app knows, on matte fabric and on a
fabric with a highlight — because the brightest part of a *coloured* garment is
its highlight, and highlights are washed out:

| | whole garment | brightest 25% |
|---|---|---|
| matte | 245 / 264 | **252 / 264** |
| with a sheen | **183 / 264** | 163 / 264 |

It helps matte cloth and costs more than that on anything shiny — beige reads
cream, tan reads beige, charcoal reads grey. Net across both, 428 → 415. **So it
is not shipped**, and it is recorded here so the idea does not get had twice.

(The first sheen fixture was too strong to be worth anything: a highlight at 0.72
alpha washed the colour out so completely that reading the *whole* garment scored
19/264, which cannot tell two settings apart. The numbers above use 0.30.)

**So what did happen?** With both mechanical explanations ruled out, the likeliest
answer is that the original number was mis-measured. That is not a guess about
someone's carelessness — this file's own author reproduced exactly such an error
while writing the section above, by handing the colour reader a mask in the wrong
convention: a black-and-white PNG whose *alpha* is 255 throughout says "none of
this is background", the reader takes the colour off the whole frame, and the
score swings from 147/180 to 21/180 with nothing raising an error. A silent
convention mismatch of that kind moves this number further than any real change
to the code does, in either direction.

The original script is gone, so this cannot be settled. What can be said is that
the claim is unsupported, the two ways it might have been true have been tested
and were not, and the way it might have been false is demonstrable.

### Evening the shading out

A piece photographed with a window on one side comes out half lit and half in
shade, and the lay-out then shows you half a garment. Nothing is wrong with the
cut — the photograph really is like that — but the point of that view is to see
the thing.

So the light is estimated across the garment on a coarse grid and divided out,
the flat-field correction a scanner does. Luminance only, applied to all three
channels together, so a colour is dimmed or lifted and never shifted. **Display
only**: the stored photograph is not touched, here as everywhere else.

**The difficulty is that shading and a two-tone garment are the same signal.** A
shirt that is genuinely navy on one side and white on the other looks exactly
like a white shirt with a shadow across it, and nothing measurable tells them
apart — you need to know what a shirt is. So the correction is capped, and the
cap was chosen by measuring both. Spread of brightness across the garment, tenth
to ninetieth percentile:

| | as taken | cap 1.25 | cap 1.4 | cap 1.55 |
|---|---|---|---|---|
| a shadow | 61 | 9 | **9** | 9 |
| a harsher one | 80 | 15 | **11** | 11 |
| two-tone, no shadow at all | 199 | 172 | **166** | 159 |

1.55 buys a shadow nothing that 1.4 did not already give it and costs the
two-tone garment another seven, so it is wrong. 1.25 leaves a harsh shadow
visibly uneven. **1.4** reaches the best a shadow gets while doing the least
damage to a garment that was never shaded.

At that setting a shadow is essentially gone and a navy-and-white shirt is still
plainly navy and white. It is a trade rather than a solution, and the switch
under the lay-out — *Shading evened out* / *Shading left as photographed* — is
there because on some pieces you will disagree with it.

It declines rather than guesses when there is too little of the garment to
measure a field from, or when the piece is so dark there is nothing to even out.

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

The transparent copy is cached for the session and never written to storage: it
is a way of *showing* the photo, not an edit to it.

Blending with `mix-blend-mode: multiply` was tried first and is not enough:
photos are JPEG, JPEG keeps no pure white, and the near-white that comes back
multiplies into a faint rectangle around every piece.

So the lay-out looks best on pieces photographed against one plain surface —
see **Photographing a piece** above. That is the same advice the colour reader
wants, for the same reason: both work off the outer edge of the frame.

## Cutting every piece out

The app tries three readings in turn to separate a piece from what it is lying
on. When all three come up empty it used to show the photograph as taken, on the
grounds that a mangled garment looks worse than an honest picture.

**Settings → Cutting pieces out** changes that, and is on. When the readings have
nothing to say it takes the last one with its refusals turned off: a worse
answer, and an answer. Measured over 180 renders:

| | left with its background | overlap ≥ 0.80 |
|---|---|---|
| show the photo when unsure | 26 / 180 | 115 |
| **cut anyway** | **19 / 180** | 115 |

Seven photographs gained, and **nothing made worse** — every scene that changed
went from nothing at all to something. The something is often rough: those seven
land between 0.19 and 0.67 overlap with the true silhouette, which is a cut with
a bite out of it or a rim of desk still attached. That is the trade the setting
names, and it is off in one tap.

### One thing that did not survive being measured

The obvious way to fix the hard cases is to stop the background fill at edges: a
grey jumper on a grey table is the same colour as the table, but there is still a
join — a shadow line, a change of weave. It was built, and swept, and it looked
like a win in aggregate.

Per scene it was not:

| | without | with |
|---|---|---|
| grey on a cream desk | 0.59 | **0.97** |
| silver on a white sheet | **0.82** | 0.06 |
| beige on a white sheet | **0.99** | 0.07 |

It won big on five scenes and destroyed five, and the totals cancelled the damage
out of sight. Moved to run *second*, only on photographs the colour fill had
already given up on, it could no longer take anything away — and then measured
inside the real pipeline it turned out to add nothing either, because the centre-
out reading was already rescuing those cases and doing it better. Net across 180
renders: three fewer good cuts, five scenes materially worse, none better.

So it was deleted. It is written up here because the aggregate said ship it twice
and only the per-scene numbers said otherwise.

### Why the demo pieces look perfect and yours may not

The twenty demo garments have no background because they were never
photographed. They are drawn on a transparent canvas at the moment you ask for
them, so there is nothing to remove. Nothing a cut-out does can match that, and
comparing against them is comparing against a picture that skipped the problem.

## Choosing what the stylist leads with

The app describes every pair of colours by the relationship between them — nine
of them, from *Monochrome* through *Complementary* to *Contrasting* — and each
carries a score for how hard that pairing is to get wrong. Those scores are what
rank one look above another.

**Settings → Colour matching** lets you put your thumb on that. *Automatic*, the
default, is what the app has always done: whichever relationship suits each
piece. Choose a rule instead and looks that achieve it are offered first.

Two things about how it is wired, both deliberate:

**It lifts, and never marks anything down.** The chosen rule goes to the top of
the table; every other rule keeps the score it had. The obvious alternative —
scale the rest down — is wrong, because that same number becomes the percentage a
look is shown with. Demoting the others would drop every score on screen and read
as the app having got worse at its job, when all that happened is that you said
what you like.

**It does not touch what counts as a workable outfit.** Whether a look works at
all is decided separately, and the counts in *Stats* are built on that. "156
complete looks" must not change because a dropdown did — taste is not the same
question as whether an outfit holds together. The test asserts it across all nine
rules; with the boundary open, preferring *Contrasting* turned 16 workable looks
into 20.

If your wardrobe cannot make the rule you asked for, the setting says so rather
than quietly doing nothing: *"Nothing you own pairs that way yet."*

## How a gesture ends

Two things in the app are dragged rather than tapped: the sheets, which you can
pull down to dismiss, and the deck of looks on Today, which you swipe sideways.
Both used to decide what you meant by dividing the total distance by the total
duration — the gesture's **average** speed.

That gets the one case that matters backwards. Flick a sheet downward and then
hold still for half a second because you have changed your mind: the average is
still high, so the sheet leaves anyway. **You told it to stop and it went.** The
reverse is as bad — drag slowly for a while and then flick, and the average is
low, so a decisive flick is ignored.

So the last few positions are kept and the speed is read off the end of them,
over a 90 ms window. Nothing fires while a finger rests, so a history whose
newest sample is older than that window means the gesture ended at rest, and it
reports zero. That single line is what makes changing your mind work.

One thing that had to be got right rather than assumed: the window takes the
oldest sample still *inside* it, not the first one outside. Taking the one
outside reaches a step too far back and averages the flick together with the
dawdling before it — measured at **0.46** where the flick alone is **0.8**, on
either side of a threshold of 0.5. The gesture was silently missed, and the test
is what found it.

**A sheet leaves at the speed it was thrown.** The distance still to go divided
by how fast it is going, clamped at both ends so a gentle push does not crawl and
a hard flick does not vanish before the eye can follow it.

**A sheet can be caught on its way back.** Released short of the bar it springs
home, and grabbing it mid-flight picks it up from where it *looks* rather than
snapping it to the top first. That needs the current position written down before
the easing is removed — take the easing away first and the element jumps to the
value it was heading for, which is the exact jump the feature exists to prevent.
Both halves are tested by re-introducing them.

The deck already resists at its ends rather than stopping dead, so the boundary
behaviour that principle asks for was there; the sheets have a hard top edge on
purpose, since lifting one off the bottom of the screen shows a gap rather than
resistance.

Left alone deliberately: these are touch handlers rather than pointer ones. The
scroll-versus-drag decision inside them is tuned against real phones, and this is
a phone-first app — rewriting that for mouse support is a change with more risk
in it than value.

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

Names are yours: emoji, Hebrew, punctuation, markup, four hundred characters,
or nothing at all. Naming a pair of trainers **👟 sneakers** used to take down
the Wardrobe tab and the Stats tab with "URI malformed" — `charAt(0)` returns
half a surrogate pair and the placeholder image refuses to encode it. Every
colour test in the suite had been ASCII, so nothing saw it.

A record with a hole in it — no colour, no name — cannot be typed in, but a
hand-edited or truncated backup can carry one, and so can a wardrobe restored by
an older version of the app. Those are repaired on the way in rather than
guarded against at each of the nine places that read a name.

One deliberate exception. Warmth, formality and tags are **re-inferred from the
name on import** for anything still on the app's own guess, so a backup taken
before a keyword was added benefits from it. Anything you corrected by hand is
kept exactly as you set it — that is what the *auto* flag on each attribute is
for, and the test checks it specifically, because a silent partial loss is the
failure that matters here. Everything would look fine; only weeks later would it
emerge that every warmth you fixed had been quietly re-guessed.
