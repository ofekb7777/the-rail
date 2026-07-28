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
const VERSION = '2026.08.05';
const CACHE = 'the-rail-' + VERSION;
const SHELL = ['./', './index.html', './the-rail.html'];

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
          return k === CACHE ? null : caches.delete(k);
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
