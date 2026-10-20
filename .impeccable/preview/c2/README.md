# C2 disposable browser harness

Run `rtk proxy node .impeccable/preview/c2/server.mjs`, then open <http://127.0.0.1:5196> in a separate browser profile. This mounts the real App, controller, production transport and expression builder. The test-only native adapter evaluates expressions in the fresh `/page.html` iframe with real CacheStorage. Reset/seed only touches `c2-qa-*` names. Never use the adapter on a user origin.

`window.c2seed(names)` resets fixture names; `window.c2deletes` records namespace delete calls; `window.c2calls` records evaluated source; `window.c2page.caches.keys()` reads the actual API. Names passed to seed must start with `c2-qa-`. `c2mode='middle-fails'` rejects names containing beta; `navigate-after-first` changes the iframe URL on the first deletion; `unknown` loses commit acknowledgement after starting the real job. These are synthetic failure injections. Existing C1 modes remain available for fixture experiments.

Open <http://127.0.0.1:5196/compiled.html?session=c2-compiled> after `rtk proxy pnpm build:safari` for the exact unchanged production Safari panel bundle. The server sends `/production/*` bytes directly before Vite transformation. The fixture supplies only a runtime message adapter and evaluates production expressions in the same fresh iframe. `window.c2compiledAsset` identifies the loaded asset. This verifies compiled serialization, not native Safari IPC or permissions.

Native acceptance uses the separate explicit Seed/Cleanup fixture at <http://localhost:4174>. Chrome fixture evidence never closes native Safari checks.
