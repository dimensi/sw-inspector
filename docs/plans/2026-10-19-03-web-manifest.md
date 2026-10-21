# Web App Manifest Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** M1–M3 code-complete (2026-10-21); M4–M6 planned. DOM runner пока не подключён; manifest fetch/UI недоступны. Создание этого файла не разрешает реализацию, сетевые запросы или изменение действующих ADR.

**Goal:** Добавить инспекцию объявленного Web App Manifest: обнаружение ссылки, явную ограниченную загрузку, поля, разрешённые URL, исходный JSON и локальные замечания.

**Architecture:** Панель вызывает отдельный self-contained `createManifestRunner(context)` через существующий DevTools relay и синхронные JSON start/poll expressions. Runner читает DOM и явно загружает текст; чистый parser выполняется на стороне панели. `ManifestPane.svelte` владеет состоянием manifest, а `App.svelte` только подключает destination и компонент.

**Tech Stack:** Имеющиеся TypeScript, Svelte 5, WXT, Vitest; DOM, Fetch, URL, AbortController. Новые зависимости, host permissions, background workers и content scripts не нужны.

**Spec:** [Общий дизайн](2026-10-19-development-design.md); prerequisite: завершённый [00-action-foundation](2026-10-19-00-action-foundation.md). Действующие владельцы фактов: [PRODUCT](../../PRODUCT.md), [DESIGN](../../DESIGN.md), [ADR 0001](../adr/0001-read-only-diagnostics.md), [ADR 0002](../adr/0002-devtools-page-bridge.md), [TESTING](../TESTING.md).

## Global Constraints

- До активации плана ничего из перечисленного ниже не реализуется; текущее ограничение ADR 0001 «Do not call `fetch`» продолжает действовать.
- Foundation остаётся пассивным. Если Manifest выпускается первым, M6 активирует [ADR 0004](../adr/0004-explicit-development-actions.md) только для явного **Load manifest**; cache/worker/message действия и остальные сетевые probes остаются запрещены до своих отдельных выпусков.
- Все shell-команды начинаются с `rtk`; commits/push выполняются только при отдельной авторизации. Не затрагивать чужие изменения.
- Нативный eval остаётся в `devtools_page`; существующие relay, session/sender проверки и `devtools` + `activeTab` не меняются.
- Начальное открытие панели, выбор destination, Refresh и discovery не загружают manifest или иконки автоматически.
- Лимиты v1: manifest text ≤262144 decoded response bytes, общий page-side deadline 8000 ms, snapshots ≤8, TTL 60000 ms, icon rows ≤128.
- Manifest v1 не загружает pixels иконок/screenshots, не проверяет URL доступность, не устанавливает приложение, не проверяет browser installability.
- Значения помечаются `Declared` / `Resolved by SW Inspector`; это реконструкция по документу и загруженному ответу, не processed manifest Safari.
- Raw source показывается только по **Show source** из уже загруженного текста; повторного fetch нет. Текст никогда не вставляется как HTML и не попадает в export.
- Native Safari acceptance обязательна; **Refresh after navigation** сохраняется до отдельного доказательства исправления текущего ограничения.

## Review Focus

- Первый manifest link неправильный, второй правильный: не выбирать второй молча; тесты M1–M2.
- URL страницы прежний после reload либо меняется SPA route: stale snapshot не должен запустить запрос или заменить данные; M2–M4.
- CSP/CORS или Service Worker различают fetch и manifest requests: показывать ограничение чтения, не заключение об установке; M2 и M6.
- Бесконечный/слишком большой response stream: deadline охватывает body, память ограничена, результат не считается частично валидным; M2.
- Hostile/длинный JSON, повторные icon URLs и out-of-order UI replies: текст безопасен, identity/focus остаются корректными; M3 и M5.

---

## Карта файлов и зафиксированные контракты

| Путь | Ответственность |
| --- | --- |
| `src/manifest/types.ts` | Commands и сериализуемые результаты manifest |
| `src/manifest/page-runner.ts` | Самодостаточная factory, DOM snapshots, ограниченная загрузка |
| `src/manifest/parse.ts` | Чистый panel-side parser и проверяемые URL derivations |
| `src/domain/commands.ts` | Расширение `InspectorCommand` новой веткой |
| `src/bridge/expressions.ts` | Явная сериализация новой factory и передача PageContext |
| `entrypoints/panel/ManifestPane.svelte` | Manifest state, действия, таблица, source, локальные ошибки |
| `entrypoints/panel/App.svelte` | Sidebar/compact destination и mount; никакого manifest state |
| `tests/manifest/*.test.ts` | Discovery/fetch/parser/expression contracts |
| `.impeccable/preview/fixture.js` | Синтетические UI-сценарии; не native Safari evidence |
| `fixtures/manifest-demo/index.html`, `fixtures/manifest-demo/server.py` | Управляемый локальный native fixture, два origin, JSON/redirect/CORS/stream варианты |

Foundation предоставляет `PageIdentity = { documentId: string; origin: string; url: string }` и `PageContext` из `src/bridge/page-context.ts`.
Использовать `context.identity(): PageIdentity`, `context.isCurrent(expected): boolean`, `context.onDispose(cleanup): void`, `context.manifests: Map<string, unknown>`.
`isCurrent` сравнивает все три поля. Не заменять эту проверку только origin или URL.

```ts
type ManifestCommand =
  | { type: 'manifest:discover'; expectedPage: PageIdentity }
  | { type: 'manifest:fetch'; expectedPage: PageIdentity; snapshotId: string };
type ManifestLink = {
  href: string | null; url: string | null; crossOrigin: string | null;
  referrerPolicy: string; issue: 'missing-href' | 'empty-href' | 'invalid-url' | 'unsupported-url' | null;
};
type ManifestDiscovery = { page: PageIdentity; snapshotId: string | null; linkCount: number; link: ManifestLink | null };
type ManifestFetch = {
  page: PageIdentity; snapshotId: string; requestedURL: string; finalURL: string | null;
  status: number | null; contentType: string | null; redirected: boolean | null; readBytes: number | null;
} & ({ state: 'loaded'; finalURL: string; text: string } | {
  state: 'failed'; reason: 'http-error' | 'network-error' | 'unreadable' | 'timeout' | 'too-large'; message: string;
});
type ManifestDiagnostic = { code: string; path: string; severity: 'error' | 'warning' | 'info'; message: string };
type ManifestField = { key: string; declared: unknown; resolved: string | null; source: 'declared' | 'fallback' | 'unavailable' };
type ManifestIcon = { index: number; src: string | null; resolvedURL: string | null; sizes: string | null; type: string | null; purpose: string | null };
type ManifestAnalysis = { state: 'parsed' | 'invalid-json' | 'invalid-root'; fields: ManifestField[]; icons: ManifestIcon[]; diagnostics: ManifestDiagnostic[] };
type ManifestParseInput = { documentURL: string; manifestURL: string; contentType: string | null; text: string };
```

Все типы выше экспортируются из `src/manifest/types.ts`; `Result<T>` остаётся общим из `src/domain/types.ts`.
Несуществующий/просроченный snapshot → внешний `Result` с `stale-snapshot`; чужая страница/изменённая ссылка → `stale-result`.
Неподдерживаемая ссылка получает discovery `issue`; попытка fetch такого snapshot возвращает общий foundation error `unsupported` с просьбой исправить ссылку и повторить discovery.
Ошибки конкретного HTTP-чтения — `ok: true` с `ManifestFetch.state === 'failed'`; ошибки relay остаются внешним `Result`.

### M1: DOM discovery без сетевых запросов

**Files:** создать `src/manifest/types.ts`, `src/manifest/page-runner.ts`, `tests/manifest/discovery.test.ts`; расширить `src/domain/commands.ts`.
**Interfaces:** `createManifestRunner(context: PageContext): (command: ManifestCommand) => Promise<Result<ManifestDiscovery | ManifestFetch>>`.

- [x] Добавить failing tests `absent`, `first-link-only`, `base-url`, `stale-page`: соответственно `snapshotId === null`, выбран первый элемент, URL учитывает `<base>`, `error.code === 'stale-result'`; во всех случаях `fetch.mock.calls.length === 0`.
- [x] Запустить `rtk proxy pnpm exec vitest run tests/manifest/discovery.test.ts`; ожидается FAIL из-за отсутствующей factory/ветки команд.
- [x] Реализовать discovery первого `link[rel~="manifest" i]` основного документа, считать `linkCount`; iframe не обходить. Сохранять raw `getAttribute('href')` и разрешённый DOM `href`; missing/empty не превращать в URL документа.
- [x] Тест `rel-token-case` использует `rel="alternate MANIFEST"`: link выбирается, а `rel="notmanifest"` не выбирается. Ключевые слова rel сравниваются ASCII case-insensitively; CSS `~=` сохраняет границы токена.
- [x] HTTP(S) без username/password разрешены для чтения. `data:`, `blob:`, `file:`, другие схемы и URL credentials → `unsupported-url`, без утверждения «manifest invalid».
- [x] Внутри factory определить `RetainedManifestSnapshot = { page: PageIdentity; element: HTMLLinkElement; link: ManifestLink; expiresAt: number }`.
- [x] Под ключом `manifest:runtime:v1` в `context.manifests` хранить `ManifestRuntime = { snapshots: Map<string, RetainedManifestSnapshot>; controllers: Set<AbortController> }`. Создавать один раз; один `onDispose` abort-ит controllers и очищает snapshots.
- [x] Перед каждым действием удалить просроченные snapshots; новый random UUID вытесняет самый старый при размере 8. Проверить fake timers: 60000 ms истекли → `stale-snapshot`; девятый snapshot вытесняет первый.
- [x] Запустить тот же тест; ожидается PASS. Review gate: discovery не имеет обходного fetch, URL input отсутствует, Map принадлежит только manifest runner.

### M2: Явный ограниченный fetch

**Files:** изменить `src/manifest/page-runner.ts`; создать `tests/manifest/fetch.test.ts`.
**Interfaces:** ветка `manifest:fetch` использует только сохранённый `snapshotId`, возвращает `Result<ManifestFetch>`.

- [x] Добавить failing tests `bounded-body`, `stream-timeout`, `credentials`, `redirect`, `stale-before-fetch`, `stale-after-await`; запуск: `rtk proxy pnpm exec vitest run tests/manifest/fetch.test.ts` → FAIL.
- [x] До fetch проверить `context.isCurrent(expectedPage)`, snapshot.page, TTL, что retained element всё ещё первый и его href/resolved URL/crossOrigin/referrerPolicy совпадают. При несовпадении `fetch` не вызывается.
- [x] Выполнить один `fetch(url, { mode: 'cors', credentials, redirect: 'follow', cache: 'default', referrerPolicy, signal })`; `credentials = 'include'` только для нормализованного `use-credentials`, иначе `'same-origin'`. Дополнительных headers/retries нет.
- [x] Общий timer 8000 ms запускается до fetch и охватывает headers + stream. Controller включён в runtime.controllers, удаляется в finally; timer очищается; reader отменяется при лимите/ошибке.
- [x] Считать фактические bytes chunks; 262144 принимаются, 262145 → `too-large`, `text` отсутствует. Не доверять Content-Length и не вызывать неограниченный `response.text()`/`json()`/`blob()`.
- [x] После fetch и каждого awaited body read повторить page/link проверки; stale result не возвращает source. Dispose вызывает abort. Проверить no publication после navigation даже при завершившемся Promise.
- [x] Сохранить requested/final URL, status, contentType, redirected; не-2xx → `http-error` без чтения body; fetch rejection → `network-error`, без догадки «CORS blocked». Opaque/null body → `unreadable`.
- [x] Для loaded требовать непустой валидный HTTP(S) response.url; иначе failed/unreadable. Это гарантирует строковый finalURL без догадок о redirect base на входе parser.
- [x] Abort классифицировать по причине: page disposal/смена identity → внешний stale-result; собственный deadline → failed/timeout; остальные fetch failures → failed/network-error. Не превращать отмену в HTTP status 0.
- [x] Decode UTF-8 после полного bounded read; неправильный MIME не мешает показать source, но parser добавит замечание. Текст хранится только в результате/UI, не в persistent storage или export.
- [x] Проверки: задержанный stream завершается на 8000 ms; `reader.cancel`/abort вызываются; redirect base берётся из response.url; anonymous/absent crossorigin дают same-origin, use-credentials даёт include.
- [x] Запустить `rtk proxy pnpm exec vitest run tests/manifest/discovery.test.ts tests/manifest/fetch.test.ts` → PASS. Review gate: ошибка операции не меняет состояние worker/cache inspection.

### M3: Чистый parser и честные derived values

**Files:** создать `src/manifest/parse.ts`, `tests/manifest/parse.test.ts`.
**Interfaces:** экспортировать `parseManifest(input: ManifestParseInput): ManifestAnalysis`; тип `ManifestParseInput` берётся из `src/manifest/types.ts`. Без DOM, сети, extension API и runtime imports из runner.

- [x] Добавить failing tests `json-shapes`, `url-bases`, `scope-fallback`, `declared-fields`, `icon-indices`, `mime-warning`; запустить `rtk proxy pnpm exec vitest run tests/manifest/parse.test.ts` → FAIL.
- [x] JSON.parse с разрешённым первым BOM; syntax error → `invalid-json`, null/array/scalar → `invalid-root`, `{}` → `parsed`. Invalid states не возвращают реконструированные поля/icons.
- [x] Поля v1: name, short_name, id, start_url, scope, display, orientation, theme_color, background_color. Не приводить неправильные типы к строке; диагностировать их; неизвестные поля доступны только в source и не считаются ошибками.
- [x] `start_url` разрешить относительно input.manifestURL; missing/empty/invalid/cross-origin относительно input.documentURL → fallback document URL. `scope` default = `new URL('.', startURL)`; supplied scope разрешить от input.manifestURL, убрать query/hash, требовать origin и pathname prefix для startURL.
- [x] `id`, display/orientation/colors в v1 показывать как Declared: не вычислять browser identity, CSS-color support или применённый режим. Это намеренно ограничивает объём parser; full manifest processing не заявляется.
- [x] Fixtures: manifest `https://app.test/assets/m.json`, start `../launch?x=1#h` → `https://app.test/launch?x=1#h`; default scope → `https://app.test/`; cross-origin start → document URL; scope `/app` принимает pathname `/application` по prefix rule.
- [x] Icon declarations разрешают src от input.manifestURL и сохраняют исходный index, включая duplicate URLs. Не fetch-ить src; sizes/type/purpose остаются declarations. Не объявлять размеры 192/512 обязательным условием универсальной валидности.
- [x] При >128 icons вернуть первые 128 и `icons-truncated` warning с количеством пропущенных. Malformed entries дают path вида `icons[3].src`; неизвестный member сам по себе не ошибка.
- [x] Wrong/missing JSON MIME → `json-mime` warning; raw source остаётся доступным. Diagnostics имеют стабильные code/path, deterministic order: document/MIME, fields в указанном порядке, icons по index.
- [x] Запустить тот же тест → PASS. Отдельно `fetch` stub должен иметь 0 вызовов для всех parser fixtures.

### M4: Сериализация и маршрут команды

**Files:** изменить `src/bridge/expressions.ts`, `src/domain/commands.ts`; создать `tests/manifest/expressions.test.ts`; сохранить foundation routing.
**Interfaces:** `InspectorCommand` включает `ManifestCommand`; transport.invoke принимает `InspectorCommand`, возвращаемые `Result<T>` не меняются.

- [ ] Добавить failing round-trip test: сгенерированный start-expression возвращает синхронный JSON jobId, poll даёт ManifestDiscovery/ManifestFetch; тест выполняет expression без module scope.
- [ ] Запустить `rtk proxy pnpm exec vitest run tests/manifest/expressions.test.ts` → FAIL до подключения factory.
- [ ] В expression явно сериализовать `createManifestRunner.toString()` и передать foundation PageContext. Все исполняемые helpers runner вложены в factory; type-only imports допустимы. Не рассчитывать на импортированный runtime closure.
- [ ] Routing различает manifest commands явно; неизвестная команда не проваливается в legacy `checkUrls(command.paths)`. Не переписывать relay/permissions и не добавлять direct-panel eval.
- [ ] Проверить hostile строковые данные, TTL context disposal, stale-before/after response и отсутствие second fetch при повторном poll завершённого job.
- [ ] Запустить `rtk proxy pnpm exec vitest run tests/manifest/expressions.test.ts tests/bridge/expressions.test.ts tests/bridge/transport.test.ts tests/bridge/devtools-relay.test.ts` → PASS.

### M5: ManifestPane и синтетические UI-сценарии

**Files:** создать `entrypoints/panel/ManifestPane.svelte`; минимально изменить `entrypoints/panel/App.svelte`, `.impeccable/preview/fixture.js`.
**Interfaces:** props `{ page: PageIdentity | null; refreshToken: number; invoke: <T>(command: InspectorCommand, options?: { signal?: AbortSignal }) => Promise<Result<T>> }`; callback принадлежит foundation transport.

- [ ] Перед компонентом использовать текущие Svelte docs через ctx7 (library → docs, вне sandbox) и официальный Svelte MCP; не создавать новый дизайн или dependency.
- [ ] Добавить fixture variants `manifest=absent|valid|invalid-json|network-error|too-large|long|race` и счётчик manifest fetch; начальное mount/destination/Refresh должны оставлять счётчик 0.
- [ ] Pane содержит `discovery`, `source`, `analysis`, `localError`, `busy`, operation generation и AbortController. При изменении page/refreshToken или unmount сбросить всё, abort ожидание, инвалидировать generation.
- [ ] Без page показать `Refresh to inspect this page.`; действия `Discover manifest`, `Load manifest`, `Show source`. Discovery вызывается только явной кнопкой; Load включён для актуальной поддерживаемой ссылки.
- [ ] Source/analysis создаются только по successful loaded response. Вызов: `parseManifest({ documentURL: result.value.page.url, manifestURL: result.value.finalURL, contentType: result.value.contentType, text: result.value.text })`. Show source раскрывает `<pre>` без повторного запроса; failed reload очищает предыдущий source.
- [ ] Property rows показывают source URL, final URL при redirect, status/MIME и declared/resolved values; icons — dense table с index identity, без img/background-image. Notice: `Loaded by SW Inspector. Safari may process this manifest differently.`
- [ ] App добавляет `Manifest` в sidebar и compact select, монтирует Pane с props; никакие manifest errors не попадают в `inspectionError`. Сохранить токены DESIGN, focus и локальный scrolling.
- [ ] Проверить fixture: delayed response предыдущей операции не заменяет новую; duplicate icon URLs отображаются; markup/source не выполняется; loading/absent/error/too-large имеют разные сообщения.
- [ ] Выполнить Svelte MCP validation после исправлений; `rtk proxy pnpm check` → без ошибок; затем `rtk proxy pnpm build:safari` и `rtk proxy python3 .impeccable/preview/server.py`.
- [ ] В браузере проверить wide 1440×900 и narrow 390×844 в light/dark, keyboard tab/focus, длинные значения и source scroll. После проверки остановить fixture server; результаты обозначить synthetic.

### M6: Native Safari acceptance и самостоятельная активация Manifest

**Files:** создать `fixtures/manifest-demo/index.html`, `fixtures/manifest-demo/server.py`; обновить `docs/TESTING.md`, `docs/adr/0004-explicit-development-actions.md`, `PRODUCT.md`, `AGENTS.md`, `README.md`, `DESIGN.md`, `package.json`, `wxt.config.ts`, `entrypoints/panel/App.svelte` в объёме выпускаемой функции. Generated bundles руками не редактировать.

- [ ] Перед выпуском принять в ADR 0004 только реализованное исключение **Load manifest**: явный GET, 256 KiB/8 s, без icon fetch/установки/проверки URL. Если ADR уже активирован другим выпуском, добавить только Manifest; не включать будущие cache/worker/message возможности.
- [ ] Обновить PRODUCT/AGENTS/README и DESIGN copy: discovery/passive inspection не создаёт сеть; Load manifest создаёт один явный запрос. Сохранить остальные запреты ADR 0001; foundation сам по себе ничего не активирует.
- [ ] Уточнить UI и package/config descriptions в пределах поставляемой функции: toolbar label `Inspect`, функция `Load manifest`, короткое описание `Service Worker, Cache Storage and Web App Manifest inspection for Safari.` Не обещать cache deletion, worker controls или messaging, если они ещё не выпущены.

- [ ] Выполнить `rtk proxy pnpm test`, `rtk proxy pnpm check`, `rtk proxy pnpm build:safari`, `rtk proxy pnpm check:manifest`; ожидается PASS каждого. Проверить generated manifest: только devtools/activeTab, без host/background/content scripts.
- [ ] Fixture server на стандартной библиотеке Python обслуживает только `127.0.0.1:4187` и `127.0.0.1:4188`; запуск `rtk proxy python3 fixtures/manifest-demo/server.py`. HTML принимает `?case=absent|valid|redirect|invalid-json|wrong-mime|slow|large|cors-denied|credentials`.
- [ ] Server возвращает локальные manifest responses динамически; slow задерживает body >8 s, large выдаёт 262145 bytes, redirect меняет каталог, cors-denied не выставляет разрешающий header. Credentials case использует только фиктивный cookie, не данные пользователя; никаких внешних URL.
- [ ] Проверить реальный Safari: Load делает один запрос; Discover/Show source/Refresh и icon rows — ноль запросов; ошибки не убирают worker/cache данные. Отдельно CSP `manifest-src`/`connect-src` не превращать в installability conclusion.
- [ ] Проверить reload того же URL, SPA navigation, concurrent Inspectors и отзыв доступа во время загрузки. Stale result не публикуется; текущую ручную Refresh после навигации не скрывать.
- [ ] Записать точные Safari/macOS версии, revision/bundle, installation route, origin, permission gesture, action/result. Для Xcode route сначала `rtk proxy pnpm sync:safari`; сравнивать идентичные bundles.
- [ ] Сохранить pending строки, если native случай не выполнен. Проверить local docs links и metadata export: raw source/icon bytes отсутствуют.

## Источники и границы интерпретации

- [WHATWG HTML: manifest](https://html.spec.whatwg.org/multipage/links.html#link-type-manifest): первый link, основной документ, CORS и response URL. [Link types](https://html.spec.whatwg.org/multipage/links.html#linkTypes) задаёт ASCII case-insensitive tokens rel; selector с `i` сохраняется. Ссылка обнаруживается по текущему DOM, не по внутреннему processed manifest.
- [HTML: credentials](https://html.spec.whatwg.org/multipage/urls-and-fetching.html#cors-settings-attribute-credentials-mode): отсутствие crossorigin и anonymous → same-origin; use-credentials → include.
- [W3C Manifest, опубликованный draft 2026-10-16](https://www.w3.org/TR/2026/WD-appmanifest-20261016/): источник правил start_url/scope/image declarations. Версию правил pin-ить тестами; не заявлять полную реализацию развивающегося стандарта.
- [Fetch RequestInit](https://fetch.spec.whatwg.org/#request-class), [CSP connect-src](https://www.w3.org/TR/CSP3/#directive-connect-src): обычный fetch не имеет задаваемого destination=manifest; его CSP/SW поведение может отличаться от браузерной загрузки.
- [Chrome Manifest UI](https://developer.chrome.com/docs/devtools/progressive-web-apps#web-app-manifest), [Chrome protocol](https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json): UI reference и граница browser-only getAppManifest/getInstallabilityErrors.

## Handoff

- [ ] Выполнять только после разрешения реализации общего дизайна и завершения пассивного foundation; сохранить frozen interfaces и последовательность M1 → M2 → M3 → M4 → M5 → M6. Manifest может выпускаться без cache/worker/message функций; scope активирует его собственная M6.
- [ ] После каждой задачи передать следующему исполнителю paths, команды/результаты, принятые контракты и pending native checks. Не объявлять план выполненным по одному build.
- [ ] Поздний icon preview требует отдельной задачи с явным сетевым действием, byte/decode limits и Safari evidence; v1 не резервирует для него permissions или скрытые fetches.
- [ ] Окончательный отчёт разделяет implemented, automated/synthetic verified и native verified; остающиеся ограничения отражает в TESTING, а этот файл остаётся планом, не источником runtime evidence.
