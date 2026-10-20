# Cache Storage Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Коммиты только по отдельному указанию.

**Goal:** Удалять выбранный кеш, фиксированный список всех кешей или выбранную запись с честным результатом и обновлением UI.
**Architecture:** Action foundation → retained target → стандартные Cache APIs. Cache Storage остаётся отдельным от HTTP cache, IndexedDB, cookies и localStorage.
**Tech Stack:** текущие TypeScript/Svelte/WXT/Vitest, CacheStorage/Cache.
**Spec:** [development design](2026-10-19-development-design.md), [00/A1–A4](2026-10-19-00-action-foundation.md).
**Status:** C1 code-complete (2026-10-20), native Cancel/single-namespace deletion passed by user report (2026-10-21; [evidence](../TESTING.md#c1-user-reported-native-safari-acceptance--2026-10-21)); C2 code-complete (2026-10-21), native Cancel/batch-delete passed by user report (2026-10-21; [evidence](../TESTING.md#c2-user-reported-native-safari-acceptance--2026-10-21)); remaining native checks open; C3 code-complete (2026-10-21), native Cancel/query deletion, empty selection and two-same-URL selective preservation passed by user report (2026-10-21; [evidence](../TESTING.md#c3-user-reported-native-safari-acceptance--2026-10-21)); other native checks open; next remaining C4 acceptance. Dependencies: все A1–A4.

## Global Constraints

- Все common guards/limits/UI rules из design обязательны. Ни одного network request ради удаления.
- Namespace удаляется по имени через `caches.delete`; API не даёт atomic compare-and-delete. Не обещать, что сайт не пересоздаст кеш.
- Entry удаляется по retained Cache + Request, с обычными match options; никогда не `ignoreSearch`, `ignoreMethod`, `ignoreVary`.
- Нельзя трактовать видимые 1,500 строк как полный кеш. «Все кеши» означает имена, показанные в confirmation; новые имена после prepare не затрагивать.
- Unregister, HTTP cache и «Clear all site data» вне задачи. Клавиша Delete не запускает удаление. Прямой Delete entry разрешён только по явной кнопке выбранной записи согласно уточнению C3; namespace/batch по-прежнему требуют confirmation.

## Review Focus

| Случай | Поведение | Тест |
| --- | --- | --- |
| Имя удалено/пересоздано сайтом | absent либо фактический API result, без обещания исторической identity | C1/C2 |
| Один batch item падает | Сохранить per-name outcome, продолжить оставшиеся пока document current | C2 |
| Одинаковые URL, разные Vary | Передать исходный Request выбранной строки | C3 |
| Preview snapshot expired/evicted | Refresh required, никакого поиска новой строки по URL | C3 |
| Таймаут после delete | Unknown; не повторять и не заявлять rollback | C4 |

## C1 — Удаление одного namespace

**Files:** create `src/cache/page-actions.ts`, `tests/cache/page-actions.test.ts`; modify `src/bridge/expressions.ts`, `entrypoints/panel/App.svelte`, `entrypoints/panel/Icon.svelte` если нужен текущий SVG vocabulary.
**Interfaces:** `createCacheActions(context:PageContext,snapshotRegistryKey:string):ActionHandlers`; поддержать intent `{kind:'delete-cache',cacheName}`. `prepare` проверяет доступность API и текущее наличие, сохраняет имя. Summary: `Origin: …`, `Cache: …`, `Cached responses will be removed. The site may recreate this cache.`. Execute вызывает `caches.delete(name)` ровно один раз; true → applied, false → absent, rejection → failed.

- [x] Тесты `delete_namespace_never_opens_cache`, `absent_namespace_has_no_success_claim`, `delete_rejection_preserves_inspection`, `expired_ticket_makes_zero_delete_calls`. Счётчики open/fetch/update/unregister остаются 0.
- [x] Запустить `rtk proxy pnpm exec vitest run tests/cache/page-actions.test.ts`, получить ожидаемые FAIL. Реализовать handler и явно включить factory в production expressions. В prepare отсутствующее имя возвращает cache-not-found; execute false после гонки возвращает absent.
- [x] В текущем cache toolbar добавить **Delete cache…**. Disabled без current overview.page/при running/пока кеш не выбран; всегда через общий controller. После known outcome перечитать overview; удалить inventory/details/measurement только затронутого имени, при удалённом кеше выбрать Cache Storage. При unknown показать общий текст и предложить Refresh.
- [x] Повторить targeted tests до PASS. Выполнить policy activation C4 до предоставления кнопки в релизе.

## C2 — Удаление фиксированного списка namespaces

**Files:** modify `src/cache/page-actions.ts`, `tests/cache/page-actions.test.ts`, `entrypoints/panel/App.svelte`; create `tests/cache/batch-deletion.test.ts`.
**Interfaces:** intent `{kind:'delete-all-caches'}`. Prepare читает полный `caches.keys()`, фиксирует список (не overview counters). Лимит **100 names**: >100 → unsupported с инструкцией удалить по одному; не обрезать список. Ноль кешей → кнопка disabled/prepare absent сообщение, без commit. Summary показывает origin, точное число и все имена в scroll area. Target caption **Delete listed caches**.

- [x] Тест `new_cache_after_prepare_is_not_deleted`: prepare ['a','b'], позже ['a','b','c']; execute только a,b. `one_failure_keeps_other_receipts`: a applied,b failed,c applied → partial с тремя outcomes.
- [x] Тест `navigation_between_items_stops_remaining`: после await удаления a сменить identity; b/c skipped, нет их delete calls. `over_100_names_is_rejected_without_truncation` и `empty_batch_has_no_effect`.
- [x] Запустить `rtk proxy pnpm exec vitest run tests/cache/batch-deletion.test.ts`; реализовать последовательное выполнение (не Promise.all), current check перед каждым API call, без повторных attempts.
- [x] Добавить **Delete all caches…** только в Cache Storage toolbar. Confirmation фиксирует список, Cancel safe default. После результата показать числа applied/absent/failed/skipped и имена ошибок; не обещать, что origin останется пустым. Обновить overview отдельно от receipt.
- [x] Повторить targeted tests. UI fixture: 100 длинных имён/частичный результат/narrow dock — evidence recorded separately in TESTING; native acceptance remains pending.

## C3 — Удаление одной записи с сохранением request identity

**Files:** modify `src/diagnostics/page-runner.ts`, `src/cache/page-actions.ts`, `tests/diagnostics/page-runner.test.ts`, `tests/cache/page-actions.test.ts`, `entrypoints/panel/App.svelte`; create `tests/cache/entry-deletion.test.ts`.
**Interfaces:** сохранить текущий snapshot/index requestKey. `SnapshotRecord` расширить `cache:Cache`, сохраняя `cacheName,requests,expiresAt`; определение type-only вынести в `src/cache/snapshot-types.ts` для обоих factories. Intent `{kind:'delete-cache-entry',cacheName,requestKey}`; retained target = Cache + Request + inventory snapshot ID/index. Выдача/проверка snapshot выполняется в inspected document.

- [x] Тесты `request_key_requires_canonical_integer_index`, `wrong_cache_or_expired_snapshot_never_deletes`, `selected_request_and_retained_cache_are_used`: reject пустой index, отрицательный, лишний colon, дробный и вне диапазона. Не принимать malformed key через Number('')=0.
- [x] Тест `expired_preview_snapshot_requires_refresh`: preview сохраняет snapshot до TTL/eviction (текущая политика ADR 0001); Delete entry после expiry/eviction показывает **Refresh this cache before deleting an entry.** и делает 0 API calls. Не продлевать silently TTL/не искать строку по URL.
- [x] Тест `entry_false_means_not_present`, `delete_invalidates_whole_inventory_for_that_cache`: Cache.delete(Request) true/false/rejection различимы; invalidate все snapshots данного cache, details/measurement. Не менять requestKey другой строки по сдвинутому индексу.
- [x] Запустить `rtk proxy pnpm exec vitest run tests/cache/entry-deletion.test.ts tests/diagnostics/page-runner.test.ts`; реализовать точные guards и сохранение Cache при list-cache-keys. Execute не вызывает caches.open и не реконструирует Request по URL. Проверять isCurrent перед Cache.delete.
- [x] Добавить **Delete entry** в response toolbar выбранной записи. По уточнению пользователя 2026-10-21 действие прямое, без confirmation dialog; fresh prepare/commit сохраняет exact ticket/generation, namespace/batch confirmation не меняется. После результата перечитать именно этот cache; не выбирать другую запись автоматически. Отсутствующий cache → Cache Storage.
- [x] Настоящие Cache API на fixture: query variants `/a?v=1` и `/a?v=2` проверены независимой Chrome QA и пользователем в native Safari; два Request одного URL с разными Accept-Language и Response Vary: Accept-Language — удалён один, другой сохранён по явному отчёту пользователя 2026-10-21 ([evidence](../TESTING.md#c3-user-reported-native-safari-acceptance--2026-10-21)). Chromium seed заменяет предыдущий same-URL Vary response; его ограничение остаётся отдельным фактом. Native результат user-reported, без raw fixture output/headers и без уточнённых версии/installation route. Остальные native C4 проверки не закрыты.

## C4 — Выпуск и native acceptance

**Status 2026-10-21:** fixture, policy/copy и release code checks завершены; два stale-document/no-effect случая после reload без Refresh и delayed batch navigation подтверждены пользователем. **C4 partially accepted, не полностью release-accepted**: native UI/access recovery и надёжно воспроизводимый lost-acknowledgement остаются открыты ([current acceptance](../TESTING.md#c4-delayed-navigation-and-access-copy-user-reports--2026-10-21)). Владелец доказательств — [TESTING](../TESTING.md#c4-independent-release-verification--2026-10-21).

**Files:** create `fixtures/controls-demo/index.html`, `fixtures/controls-demo/sw.js` (расширяется W/S планами); modify `PRODUCT.md`, `AGENTS.md`, `README.md`, `DESIGN.md`, `package.json`, `wxt.config.ts`, `docs/adr/0001-read-only-diagnostics.md`, `docs/adr/0004-explicit-development-actions.md`, `docs/TESTING.md`. Маркетинговую read-only copy пересмотреть без ручного редактирования generated assets.

- [x] Fixture создаёт только собственные caches `sw-inspector-fixture-*`; **Seed fixture** — явная кнопка. Cleanup fixture удаляет только этот prefix. Документировать отдельный disposable localhost origin/port в TESTING, не использовать пользовательский сайт. Service worker fixtures не перехватывают другие origin.
- [x] Принять ADR 0004 для реально включённых C1–C3; ADR 0001 пометить partly superseded для cache mutations. Остальные запреты не стирать. Убрать безусловный Read-only label/description только вместе с готовой функцией, сохранить явные body-read/network limits.
- [x] Запустить все code checks из общего design; проверить manifest без новых permissions. Wrapper синхронизировать перед wrapper проверкой. Independent QA 2026-10-21: [code checks, manifest, synced/signed wrapper evidence](../TESTING.md#c4-independent-release-verification--2026-10-21).
- [x] Native Safari basic entry/cache/all deletion и Cancel, плюс prepared namespace/old entry после same-origin reload **без ручного Refresh**: user-reported acceptance ([basic evidence](../TESTING.md#c3-user-reported-native-safari-acceptance--2026-10-21), [stale-document evidence](../TESTING.md#c4-stale-document-user-reported-native-safari-acceptance--2026-10-21)). Пользователь указал wrapper route «Из SW Inspector.app»; исходная temporary-extension Reload/new Inspector процедура и точная loaded bundle identity не установлены этим отчётом.
- [x] Native navigation во время delayed batch deletion: после reload оставшиеся два fixture cache сохранены, user-reported ([evidence](../TESTING.md#c4-delayed-navigation-and-access-copy-user-reports--2026-10-21)).
- [ ] Native light/dark, 1280/540px, keyboard/focus и повторный клик: не проверены пользователем. Тема следует системе, отдельного переключателя панели нет.
- [ ] Native понятное permission-denied сообщение и recovery после grant: новая copy проверена синтетически, native результат открыт ([evidence](../TESTING.md#c4-access-error-presentation-follow-up--2026-10-21)). Не подменять eval/API/relay failure диагнозом permission.
- [ ] Native lost-acknowledgement: если потерю ответа нельзя надёжно воспроизвести, оставить pending; автоматический transport test учитывать отдельно.
- [x] Записать факты в TESTING и незакрытые пункты. [C4 record](../TESTING.md#c4-independent-release-verification--2026-10-21) отделяет автоматические проверки от незакрытого native acceptance; полного «native passed» нет.

C4 fixture adjustment (2026-10-21): cache-only acceptance uses real Cache Storage without registering a Service Worker or intercepting fetch. The no-op `sw.js` is reserved for the later worker-management plans; registering a worker solely to satisfy this file list would add unrelated lifecycle state. Fixture and policy checkboxes above reflect inspected source, not native acceptance. Existing marketing PNGs remain a historical 2026-10-19 kit; source copy is updated and regeneration is required before a new App Store asset upload.

## Источники и семантика

- [Cache.delete](https://developer.mozilla.org/en-US/docs/Web/API/Cache/delete): удаление использует правила request matching, а не только URL.
- [CacheStorage.delete](https://developer.mozilla.org/en-US/docs/Web/API/CacheStorage/delete): true/false для namespace; не API HTTP cache.
- [Service Worker standard: CacheStorage](https://w3c.github.io/ServiceWorker/#cachestorage-interface): отсутствует транзакционное сравнение поколения кеша. Сохранённый Cache handle для entry не превращает namespace deletion в atomic operation.
