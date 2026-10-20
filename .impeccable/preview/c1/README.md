# C1 disposable browser harness

Run `rtk proxy node .impeccable/preview/c1/server.mjs`, open <http://127.0.0.1:5195> in a separate browser profile. Test-only Vite aliases replace the native eval adapter and WXT browser import. The actual mounted App, action controller, transport, production expression builder, page context, action runner and cache handler are loaded unchanged. Evaluated expressions execute in the hidden `/page.html` iframe, a fresh JavaScript realm with real browser CacheStorage.

The harness seeds only `c1-qa-assets` and `c1-qa-unrelated`; `window.c1reset(true)` seeds a long selected name instead. Reset deletes only names beginning `c1-qa-`. Never point this adapter at a user website. `window.c1deletes` counts calls and `window.c1page.caches.keys()` exposes actual cache names.

Modes in `window.c1mode`: `normal` uses actual CacheStorage.delete; `absent` removes the fixture target then returns false; `reject` throws before removal; `unknown` performs the deletion but loses the commit acknowledgement; `recreate` recreates an empty namespace after deletion; `overview-error` performs deletion then fails the following overview read. These modes are test-only fault injection, not Safari evidence. `window.c1return()` invokes the mounted panel return subscription.

Native Safari must use `fixtures/controls-demo` with the signed extension instead. This harness does not prove Safari native relay behavior.
