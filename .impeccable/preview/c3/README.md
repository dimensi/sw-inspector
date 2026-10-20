# C3 disposable browser harness

Run `rtk proxy node .impeccable/preview/c3/server.mjs`, then open <http://127.0.0.1:5197> in one disposable browser session. It mounts the real App, action controller, transport and serialized page expressions. Only the native eval adapter is replaced: expressions execute in a fresh `/page.html` iframe with real CacheStorage.

`window.c3seedEntries(long)` resets only `c3-qa-*` namespaces, seeds selected/unrelated caches, tries same-URL Accept-Language en/ru responses with Vary: Accept-Language, and adds distinct `?v=1` / `?v=2` requests. Inspect actual keys before claiming both Vary variants exist: Chrome 151.0.7922.138 retained only the last same-URL variant in this run. `c3retainedCache` keeps the original Cache handle for namespace replacement proof. `c3entryDeletes` records actual Cache.delete Request URL/language/options. `c3calls` records production expression invocations.

`c3mode='entry-absent'` removes the selected entry before returning false; `entry-reject` throws before deletion; `unknown` loses commit acknowledgement after the real job starts. These are synthetic fault injections. `c3holdContext=true` holds a page-context read; `c3releaseContext()` releases it for focus timing checks. `c3holdPrepare=true` holds a serialized prepare before evaluation; `c3releasePrepare()` releases it for direct-entry selection/navigation/reset races. The inherited namespace modes remain available.

After a Safari build, <http://127.0.0.1:5197/compiled.html?session=c3-compiled> mounts the unchanged production Safari panel bytes under `/production/*`, with only a runtime message adapter. `c3compiledAsset` identifies the loaded artifact. This checks minified serialization in a fresh realm; it does not prove native Safari IPC, permissions, or dual-Vary support.

Native acceptance uses the separate explicit Seed/Inspect/Cleanup fixture at <http://localhost:4174>. Chrome evidence does not close native checks.
