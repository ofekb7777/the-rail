/* Service worker — lets THE RAIL open from a home screen with no signal.
 *
 * Only ever registered from http(s) on the page's own origin, so opening the
 * file straight from disk simply skips it.
 *
 * Network first, cache second. A cache-first worker would be simpler, but this
 * app is one file that gets edited: cache-first would keep serving yesterday's
 * copy until the worker happened to update, and "my change didn't show up" is
 * a worse failure than a few hundred milliseconds on a good connection.
 */
/* The cache is named for the version it holds, so publishing a new one
   retires the old cache instead of layering on top of it. Keep in step with
   APP_VERSION in the-rail.html and version.json -- CI checks that they agree. */
const VERSION = '2026.09.02';
const CACHE = 'the-rail-' + VERSION;
/* The fonts belong in here now that they are served from beside the app. They
   used to come from Google, and the fetch handler below deliberately leaves
   cross-origin requests alone -- so offline the stylesheet never arrived and
   the app silently changed typeface, which is the one thing a home-screen
   install is not allowed to do. Being same-origin, they are cached by the
   handler anyway once fetched; pre-caching them means the very first offline
   launch is right too, rather than only the second. */
const SHELL = [
  './', './index.html', './the-rail.html',
  './fonts/fraunces-latin.woff2',
  './fonts/fraunces-italic-latin.woff2',
  './fonts/work-sans-latin.woff2'
];

/* The smart cut-out model lives in its own cache, and that is the whole point
   of the name. Every release retires the version cache above and builds a new
   one; the model is 18 MB, and putting it there would mean re-downloading 18 MB
   on every update -- over mobile data, for a file that has not changed.

   So it is kept out of the version cache entirely: the fetch handler below
   refuses to write anything under ai/ into it, and the activate handler above
   is careful to keep this one. It is written once, by the button in Settings,
   and removed by the button in Settings. */
const MODEL_CACHE = 'the-rail-model-v1';

self.addEventListener('install', function(e){
  /* Pre-caching must not fail the install just because one URL 404s on a
     given host -- the app still works, it simply is not offline yet. */
  e.waitUntil(
    caches.open(CACHE)
      .then(function(c){ return Promise.allSettled(SHELL.map(function(u){ return c.add(u); })); })
      .then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys()
      .then(function(keys){
        return Promise.all(keys.map(function(k){
          if(k === CACHE || k === MODEL_CACHE) return null;
          return caches.delete(k);
        }));
      })
      .then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e){
  const req = e.request;
  if(req.method !== 'GET') return;

  const url = new URL(req.url);
  if(url.origin !== self.location.origin) return;   /* fonts and outbound links: leave alone */

  /* The version check must reach the network or fail honestly. Answering it
     from the cache would let a stale copy of the app reassure itself that it
     is current, which is the one thing this file must never do. Not cached
     either, or every check would leave another entry behind. */
  if(url.pathname.endsWith('/version.json')){
    e.respondWith(fetch(req));
    return;
  }

  /* The model, and the runtime that runs it. Cache first, and never written
     into the version cache -- see MODEL_CACHE above. Cache first rather than
     network first because these files never change: the app's own file is
     edited constantly and must not be served stale, but a 13 MB WebAssembly
     build of ONNX Runtime is the same bytes forever, and going to the network
     for it on every launch would be 18 MB of nothing. */
  if(url.pathname.indexOf('/ai/') > -1){
    e.respondWith(
      caches.match(req).then(function(hit){
        return hit || fetch(req);
      })
    );
    return;
  }

  e.respondWith(
    fetch(req)
      .then(function(res){
        if(res && res.ok){
          const copy = res.clone();
          caches.open(CACHE).then(function(c){ c.put(req, copy); });
        }
        return res;
      })
      .catch(function(){
        return caches.match(req).then(function(hit){
          if(hit) return hit;
          /* A navigation with nothing cached for that exact URL should still
             land on the app rather than the browser's offline page. */
          if(req.mode === 'navigate') return caches.match('./the-rail.html');
          return Response.error();
        });
      })
  );
});
