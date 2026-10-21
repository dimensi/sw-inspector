# Worker Management Implementation Plan

> Архив завершённой реализации: этот файл сохраняет контракт и историю задач, а не активные инструкции на повторное выполнение. Native Safari acceptance остаётся открытой; следующий шаг — [утренний список](../MORNING-CHECKLIST.md), фактические результаты — [TESTING](../TESTING.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Статус:** W1–W6 code-complete (2026-10-21); native Safari acceptance pending. Worker update/unregister доступны через явное подтверждение; native Safari acceptance pending. Этот файл не является разрешением выполнять операции над произвольным сайтом.

**Goal:** добавить явную проверку обновления и удаление выбранной регистрации Service Worker с проверкой цели и честным результатом операции.

**Architecture:** действия выполняются в inspected page через существующий devtools-page relay и общий prepare/commit протокол. Отдельная сериализуемая фабрика `createWorkerActions(context)` использует сохранённые ссылки на регистрации; общие tickets, очередь и подтверждение принадлежат плану 00. Панель обновляет снимок после завершённой операции, сохраняя результат отдельно от ошибки обновления снимка.

**Tech Stack:** TypeScript, Svelte 5, WXT/Safari MV3, Service Worker API, Vitest; без новых runtime-зависимостей.

**Spec:** [общий дизайн](2026-10-19-development-design.md), обязательная зависимость [00 — Action Foundation](2026-10-19-00-action-foundation.md).

## Global Constraints

- Сначала завершить 00; он создаёт протокол и пустой registry, сохраняя read-only поставку. Если workers — первая выпущенная action-функция, W6 принимает ADR 0004 и обновляет policy/copy одновременно с UI; запреты ещё не реализованных функций сохраняются.
- В scope только `update-worker` и `unregister-worker`; нет register, start/stop/restart, универсального skipWaiting, reload страницы или удаления кэшей.
- Native eval остаётся в devtools_page; panel использует relay, JSON start/poll и существующие `devtools` + `activeTab`.
- `PageIdentity = {documentId, origin, url}`; `context.identity()` синхронный, `context.isCurrent(expected)` сравнивает все три поля.
- `context.registrations: Map<string, RetainedRegistration>` принадлежит 00; максимум 100 регистраций, lifetime 5 минут; active/waiting handles максимум 200.
- `RetainedRegistration = {page: PageIdentity; registration: ServiceWorkerRegistration; expiresAt: number; workers: {active?: {workerId: string; worker: ServiceWorker}; waiting?: {workerId: string; worker: ServiceWorker}}}`.
- Каждый полный overview атомарно заменяет retained handles; свыше 100 регистраций диагностика работает, management недоступен для всего снимка.
- TicketTTL 30 секунд, один pending ticket, эффекты последовательно на Inspector/page; общий ledger 5 минут / максимум 100 операций.
- После commit attempt timeout/abort/malformed/missing reply означает `outcome-unknown`; повторной отправки нет, cancellation не обещает остановить page-side API.
- Ссылки на объекты и повторная проверка уменьшают риск устаревшей цели, но не дают атомарную защиту от действий сайта.
- Сохранять плотные native controls, обе темы, keyboard focus, локальные ошибки и длинные scope/scriptURL; все UI-строки на английском.
- Все shell-команды с `rtk`; Svelte-компоненты проверить официальными Svelte tools; generated bundles вручную не редактировать.
- План не даёт разрешения на commit/push; этап реализации заканчивается проверяемыми изменениями и отчётом о реально запущенных проверках.

## Review Focus

- Новый worker с тем же scriptURL или новая registration с тем же scope не должны подменять сохранённую цель: тесты W1.
- Lifecycle может смениться во время подтверждения; stale target должен завершиться до native API: тесты W2.
- Unregister не прекращает немедленно контроль текущей страницы и не чистит Cache Storage: тесты W3.
- Потерянный ответ после commit не доказывает отсутствие эффекта и не разрешает retry: тесты W4.
- После Refresh старый selected registrationId нельзя восстанавливать как action target поиском по scope: fixture W5.

---

## Карта файлов и фиксированные контракты

| Путь | Ответственность |
| --- | --- |
| `src/workers/page-actions.ts` | Новый self-contained worker handler factory; никаких import runtime helpers внутри сериализуемого тела. |
| `src/domain/actions.ts` | Общие типы из 00; worker variants уже входят в ActionIntent, не создавать параллельный протокол. |
| `src/bridge/expressions.ts` | Явно сериализовать factory и передать handlers в общий `createControlRunner(context, handlers)`. |
| `src/domain/types.ts` | W1 добавляет optional Registration.registrationId и WorkerState.workerId, не изменяя прежнюю семантику absent/null. |
| `src/diagnostics/page-runner.ts` | W1 заполняет retained registrations при overview в Map, созданную 00; второго registry нет. |
| `entrypoints/panel/WorkerActions.svelte` | Выбор регистрации, новые кнопки и локальное состояние доступности. |
| `entrypoints/panel/App.svelte` | Общий action controller/confirmation, receipt и повторное чтение overview. |
| `tests/workers/page-actions.test.ts` | Реальные вызовы моков update/unregister, identity, race и result semantics. |
| `tests/diagnostics/page-runner.test.ts` | W1 проверяет overview IDs, реальные references, TTL, обновление handles и cap. |
| `tests/bridge/expressions.test.ts` | Выполнение сериализованной фабрики без доступа к module closure. |
| `.impeccable/preview/fixture.js` | Синтетические сценарии выбора/подтверждения/результата. |

`ActionIntent` worker-ветви: `{kind: 'update-worker' | 'unregister-worker'; registrationId: string}`.
Публичный экспорт: `createWorkerActions(context: PageContext): ActionHandlers`; карта содержит только эти две ветви.
`PageContext` импортируется как type из `src/bridge/page-context.ts`, `ActionHandlers`/`ActionIntent`/`ActionItem` — из `src/domain/actions.ts`.
Каждый handler: `prepare(intent): Promise<{summary: string[]; retained: unknown}>`; `execute(retained, isCurrent: () => boolean): Promise<ActionItem[]>`.
`ActionItem = {target: string; outcome: 'applied' | 'absent' | 'failed' | 'skipped'; message?: string}`; `target` здесь равен scope выбранной регистрации.
Общие prepare/commit возвращают `ActionTicket`/`ActionReceipt` из 00; собственные tickets, retry и modal здесь запрещены.
До первого эффекта handler бросает plain `ActionRejection` из `src/domain/actions.ts`: `{kind: 'action-rejected', code: 'stale-target' | 'invalid-command' | 'unsupported' | 'cache-not-found', message: string}`. Control runner проверяет marker/allowlist; imported Error subclass и маркировка произвольного post-effect исключения как безопасного отказа запрещены.
Будущий `WorkerTarget = {registrationId, workerId, slot: 'active' | 'waiting', scriptURL, state}` только использовать как согласованную границу; sending реализует отдельный план.

### W1: Handles в overview и подготовка цели без побочных эффектов

**Files:** создать `src/workers/page-actions.ts`, `tests/workers/page-actions.test.ts`; изменить `src/domain/types.ts`, `src/diagnostics/page-runner.ts`, `tests/diagnostics/page-runner.test.ts`; потреблять PageContext/ActionHandlers из 00.

**Interfaces:** W1 уточняет общий `RetainedRegistration` обязательным `page: PageIdentity` исходного overview и добавляет `PageContext.replaceRegistrationCleanup(cleanup: () => void): void` с одним private cleanup slot; replacement/disposal отменяет предыдущий/текущий timer. `createWorkerActions(context: PageContext): ActionHandlers`; внутри фабрики private retained record содержит kind, page, registrationId, registration, expiresAt и captured installing/waiting/active ссылки.
`Registration.registrationId?: string`, `WorkerState.workerId?: string`; `createPageRunner(snapshotRegistryKey?, context?)` из 00 сохраняет сигнатуру, production передаёт context; overview теперь атомарно публикует descriptors и соответствующие retained references.

- [x] Написать `overview retains exact registration and worker references`: два разных registration объекта с одинаковым scriptURL дают разные registrationId/workerId; `expect(context.registrations.get(id)?.registration).toBe(original)` и active/waiting `.worker` равен исходному объекту; installing/controller не получают отдельные action handles.
- [x] Написать `overview refresh replaces handles and bounds management`: второй overview удаляет все старые IDs; при 100 регистрациях Map.size=100, worker refs ≤200, expiresAt=now+300000; при 101 Map.size=0, все 101 diagnostic rows сохранены и ни один не содержит action IDs.
- [x] Написать `expired overview releases retained objects`: fake timers на 300000 ms удаляют expired records; старый cleanup не удаляет IDs нового overview; context dispose отменяет его timer и освобождает references.
- [x] Добавить `overview collection failure clears old handles`: getRegistrations rejection не оставляет доступными прежние IDs; overview сохраняет существующую warning/partial семантику. TTL expiry не превращает строку диагностики в отсутствующую регистрацию.
- [x] Запустить `rtk pnpm test tests/diagnostics/page-runner.test.ts`; новые assertions должны падать до реализации.
- [x] Добавить optional поля types; внутри реального overview собрать новый локальный Map и descriptors с crypto.randomUUID IDs только при count≤100. После identity check синхронно без await очистить context.registrations и заполнить подготовленными records; expiresAt один на коллекцию, 300000 ms. При overlimit/failure очистить registry и не выдавать IDs, сохраняя diagnostic data/warnings.
- [x] Поставить ограниченный cleanup timer на TTL этой коллекции: удалять только её IDs с истёкшим expiresAt; зарегистрировать отмену timer через `context.replaceRegistrationCleanup` (один owner на контекст; замена отменяет предыдущий timer, dispose освобождает текущий). Проверка срока в prepare/execute обязательна независимо от точности timer.
- [x] Запустить тот же command; ожидается PASS, включая старые overview/empty-origin/no-ready тесты. Сохранённые browser objects не попадают в JSON response/export.

- [x] Написать тест `prepare retains the selected registration without effects`: два scope, вызвать prepare второго ID; `expect(first.update).not.toHaveBeenCalled()`, `expect(second.update).not.toHaveBeenCalled()`, `expect(second.unregister).not.toHaveBeenCalled()`; summary содержит второй scope и текущую страницу.
- [x] Написать `prepare rejects missing expired and replaced targets`: неизвестный ID, `expiresAt <= Date.now()`, новый объект с тем же scope, active/waiting объект с тем же scriptURL; ожидать типизированный stale-target отказ из 00 и ноль update/unregister.
- [x] Написать `prepare does not wait for ready`: getter `navigator.serviceWorker.ready` бросает; валидный prepare по `getRegistrations()` всё равно завершается.
- [x] Запустить `rtk pnpm test tests/workers/page-actions.test.ts`; убедиться, что новый тест падает по отсутствующему поведению.
- [x] Реализовать prepare: проверить identity/срок, получить retained record, вызвать `getRegistrations()`, проверить `includes(retained.registration)` и совпадение actual active/waiting с retained workers; отсутствие slot означает `null`.
- [x] После await повторно проверить `context.isCurrent(page)` и срок; захватить installing/waiting/active ссылки для commit, без поиска registration по scope/scriptURL.
- [x] Зафиксировать summary update: `Check for update`, scope, `This may download and install a new worker. Activation is not guaranteed.`; unregister: `Unregister`, scope, `Existing pages may remain controlled. Cache Storage is unchanged.`
- [x] Запустить тот же test command; ожидается PASS. Проверить, что `getRegistrations()` failure не выдаётся за пустой список.

### W2: Update только сохранённой регистрации

**Files:** изменить `src/workers/page-actions.ts`, `tests/workers/page-actions.test.ts`.

**Interfaces:** `handlers['update-worker'].execute(retained, isCurrent): Promise<ActionItem[]>`; успешно разрешившийся `update()` даёт item `applied`.

- [x] Написать `update calls the retained registration once`: после prepare выполнить execute; `expect(selected.update).toHaveBeenCalledTimes(1)`, другие registrations и unregister не вызваны.
- [x] Написать `update does not imply activation`: update resolve без изменения waiting/active/controller; item `applied` с message `Update check completed. Activation is not guaranteed.`; никаких искусственных изменений worker state.
- [x] Написать `execute revalidates before update`: после prepare заменить registration или любой captured slot, истечь срок либо вернуть false из isCurrent; ошибка stale target до вызова native API.
- [x] Написать `update failure is local`: rejected DOMException становится item `failed` с безопасной текстовой причиной; valid overview остаётся доступным.
- [x] Запустить `rtk pnpm test tests/workers/page-actions.test.ts` и проверить ожидаемые FAIL новых тестов.
- [x] Реализовать execute с повторным `getRegistrations()`, сравнением registration/slot references и `isCurrent()` непосредственно перед `registration.update()`; не ждать activation/controllerchange/ready.
- [x] После отправки API не превращать поздний navigation в утверждение «не выполнено»: publication и `outcome-unknown` контролирует foundation; не делать второй update.
- [x] Запустить тот же command; ожидается PASS, включая уже прошедшие prepare-тесты.

### W3: Unregister с корректной семантикой результата

**Files:** изменить `src/workers/page-actions.ts`, `tests/workers/page-actions.test.ts`.

**Interfaces:** `handlers['unregister-worker'].execute(retained, isCurrent): Promise<ActionItem[]>`; true → `applied`, false → `absent`, rejection → `failed`.

- [x] Написать `unregister preserves controller and caches`: после true исходный controller остаётся, spies `caches.delete`, `registration.update`, `location.reload` имеют ноль вызовов; item message `Unregister request completed. Existing pages may remain controlled.`.
- [x] Написать `unregister false means absent`: native API вызван один раз, receipt item `absent`, message `Registration was not found.`; нет ложно успешного текста о завершении worker.
- [x] Написать `unregister rejects stale confirmation`: замена объекта с тем же scope между prepare и execute вызывает stale-target до native unregister; отдельный rejected API возвращает `failed`.
- [x] Запустить `rtk pnpm test tests/workers/page-actions.test.ts`; убедиться в FAIL новых случаев.
- [x] Реализовать unregister через ту же повторную проверку identity/references/сроков; вызвать только сохранённый `registration.unregister()` и сохранить boolean semantics.
- [x] Не обещать атомарность: сайт может повторно зарегистрироваться после проверки; строка результата описывает вызов API, новый overview показывает текущее состояние.
- [x] Запустить тот же command; ожидается PASS для update и unregister. Проверить отсутствие веток register/skipWaiting/terminate.

### W4: Подключение к control runner и неоднозначный исход

**Files:** изменить `src/bridge/expressions.ts`, `tests/bridge/expressions.test.ts`, общий `tests/bridge/transport.test.ts` из 00.

**Interfaces:** фабрика worker actions явно сериализуется и вызывается с тем же PageContext, что `createControlRunner(context, handlers)`; map объединяется с уже установленными handlers без перезаписи.

- [x] Добавить `worker handlers survive expression serialization`: выполнить generated start/poll через `new Function`, без module globals; prepare ничего не мутирует, commit выбранного ticket вызывает ровно нужный native mock.
- [x] Добавить malicious scope/scriptURL с кавычками, newline и `</script>`; данные остаются текстом, произвольный код не выполняется.
- [x] Добавить `commit response loss does not retry unregister`: native эффект произошёл, poll timeout/missing/malformed; результат `outcome-unknown`, `expect(unregister).toHaveBeenCalledTimes(1)`.
- [x] Запустить `rtk pnpm test tests/bridge/expressions.test.ts tests/bridge/transport.test.ts`; новые проверки должны сначала падать.
- [x] Подключить self-contained factory к общей сборке выражения; не импортировать helper, который будет потерян после `.toString()`.
- [x] При обнаружении пробела в shared protocol исправлять общий модуль 00 с его тестами, без worker-specific retry или прямого panel eval.
- [x] Повторить command; ожидается PASS. Сверить, что 30-секундный ticket и ledger limits взяты из 00, а не продублированы здесь.

### W5: Компактные controls и подтверждение выбранной цели

**Files:** synthetic real-App harness `.impeccable/preview/night/` используется вместо расширения исторической fixture; source/runtime evidence остаётся synthetic, deeper browser navigation races и native acceptance pending.

**Files:** создать `entrypoints/panel/WorkerActions.svelte`; изменить `entrypoints/panel/App.svelte`, `.impeccable/preview/fixture.js`; потреблять `src/ui/action-controller.ts` и `ActionConfirmation.svelte` из 00.

**Interfaces:** props WorkerActions: `{registrations: Registration[]; disabled: boolean; onintent: (intent: ActionIntent) => void}`. Компонент владеет только выбранным ID; App владеет controller и общим confirmation.
`createActionController({invoke, getPage, onState, onSettled})` из `src/ui/action-controller.ts` возвращает `{prepare, confirm, cancel, reset}` по 00; `onState` записывает ActionState в Svelte `$state` App, обычный объект controller не считается реактивным.
`ActionConfirmation` получает `{ticket, busy, onconfirm, oncancel}`. App callback `reloadOverviewAfterWorkerAction(receipt: ActionReceipt | null): Promise<void>` читает свежий overview также при null/unknown, только если документ операции всё ещё текущий; receipt/error действия сохраняется отдельно.

- [x] В fixture подготовить два scope с одинаковым scriptURL, пустой список, 101 registration, pending, failed, absent и outcome-unknown сценарии; добавить счётчики prepare/commit/update/unregister.
- [x] До UI проверить сценарий: выбрать второй scope, `Check for update` → confirmation содержит второй scope; Cancel оставляет commit count=0; Confirm приводит к update count=1.
- [x] Реализовать в WorkerActions native select `aria-label="Registration"` со scope в options и пустой опцией `Select registration`; после смены массива registrations сбрасывать выбранный ID, не сопоставлять новую цель по scope.
- [x] Встроить WorkerActions в worker pane toolbar: `Check for update` и `Unregister`; disabled без выбранного registrationId или при props.disabled; отсутствие handles при overlimit объяснить `Management unavailable for this snapshot.`. Existing property sections оставить.
- [x] Использовать только общий ActionConfirmation; управление pending/confirm/cancel через публичный controller 00. Не писать второй modal, `window.confirm` или прямой transport commit в дочернем компоненте.
- [x] Receipt показывать в worker pane; `outcome-unknown` → `The action may have completed. Refresh to inspect the current state.`; refresh failure не заменяет подтверждённый receipt новым ложным failure действия.
- [x] Через onSettled вызвать `reloadOverviewAfterWorkerAction` один раз: receipt или null/unknown перечитывает overview только в том же документе, обновляет массив registrations и сохраняет исходный receipt/unknown error. Это только чтение, никогда новый prepare/commit; при смене документа перечитывание старой операции пропускается. Ошибка чтения локальная, старые handles UI отключены до успешного Refresh.
- [x] При navigation/manual Refresh вызвать controller.reset и reset выбора; post-action reread не вызывает reset результата. generation guards не публикуют старый receipt в новый документ. Не стирать unrelated cache/preview ошибки через worker receipt.
- [x] Проверить fixture обеих тем при 1440×900 и 390×844: длинные scope/scriptURL, zero/overlimit/error, Tab/Space, Cancel/Escape и focus return; записать actual результаты, не ограничиваться source-string тестом.
- [x] Прогнать официальные Svelte diagnostics/autofixer для обоих изменённых компонентов и затем `rtk pnpm check`; ожидаются ноль ошибок.

### W6: Актуальная policy, итоговая проверка и native Safari acceptance

**Files:** evidence в `docs/TESTING.md`; при первом выпущенном action также `docs/adr/0004-explicit-development-actions.md`, `PRODUCT.md`, `AGENTS.md`, `README.md`, `package.json`, `wxt.config.ts`, `DESIGN.md`, `entrypoints/panel/App.svelte` и реальные файлы copy под `marketing/app-store/`. Implementation commands ниже выполнять после предыдущих задач.

- [x] Если workers — первая shipped action-функция, принять ADR 0004 и синхронно обновить перечисленные policy/copy владельцы: пассивная диагностика по умолчанию, явные update/unregister, без ложного `Read only`. Через `rtk rg -n -i 'read.only|readonly|only inspects|no.*mutat' PRODUCT.md AGENTS.md README.md DESIGN.md package.json wxt.config.ts entrypoints marketing/app-store` найти actual copy; запреты cache deletion, messaging и иных ещё не выпущенных функций сохранить. Если другой план уже активировал policy, добавить только worker scope без повторного принятия ADR.
- [x] Проверить локальные ссылки и соответствие product/manifest/store copy реально включённым controls; tokens DESIGN не менять ради новых кнопок. Новую native acceptance не выводить из принятия ADR.

- [x] Запустить `rtk pnpm test`; ожидается PASS всего набора, не переносить историческое число тестов.
- [x] Запустить `rtk pnpm check`, затем `rtk pnpm build:safari`, затем `rtk pnpm check:manifest`; каждую команду отдельно, ожидается exit 0.
- [x] Прочитать `rtk cat .output/safari-mv3/manifest.json`: MV3/devtools_page/devtools/activeTab; нет новых host permissions/background/content_scripts.
- [x] Проверить synthetic UI через сохранённый real-App harness `.impeccable/preview/night/` и один QA browser вместо исторического preview server: initial overview остаётся разрешён, body reads только явные; выполнить bounded W5 matrix. Прежняя no-initial-eval предпосылка superseded by ADR 0002. QA browser сохраняется для следующих roadmap задач; evidence не является native Safari acceptance.
- [x] Для native использовать только управляемый тестовый origin с worker v1/v2 и известным кэшем; чужой сайт из исторического TESTING не является разрешением unregister.
- [ ] Зафиксировать Safari/macOS build, revision/bundle, installation route, origin, access gesture и evidence. Для Xcode wrapper сначала `rtk pnpm sync:safari`; temporary bundle тестировать отдельно.
- [ ] Update одинакового worker: check completed, activation не обещана. Update v2: новый installing/waiting виден после Refresh, controller может оставаться v1.
- [ ] Unregister при открытой контролируемой странице: receipt соответствует boolean; после Refresh registrations/controller показаны независимо; известный Cache Storage остаётся.
- [ ] Reload того же origin во время confirmation при temporary activeTab: commit старого ticket отвергается до API даже без native navigation event; сохранить **Refresh after navigation**.
- [ ] Повторить denied access, worker replacement во время confirmation, два Inspector окна и потерю ответа после commit; ни одного blind retry или операции в другом Inspector/page.
- [ ] В TESTING записать passed только для реально выполненных native случаев; оставшиеся отметить pending. Сохранить строки API result, refreshed snapshot и unknown outcome отдельно.

**W6 handoff:** isolated native fixture `/sw-inspector-worker/` и stable-URL v1/v2 source server готовы на существующем localhost:4174; worker registration/removal и version changes только явные. Existing cache fixture/delay сохранены. Chrome real-API проверка и signed packaging evidence записаны в TESTING отдельно от native Safari. Signed wrapper повторно собран только по прежнему `/tmp/sw-inspector-a1-signed` пути, output/repository/embedded Resources совпали, strict deep codesign прошёл. Нативные Safari пункты выше остаются unchecked; **Refresh after navigation** сохраняется.

## Источники и границы доказательств

- [MDN update()](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/update): проверка загружает script и может установить новую версию; завершение не равно активации.
- [MDN unregister()](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/unregister): boolean result, ongoing operations и concurrent registration имеют отдельную семантику.
- [Service Workers standard: unregister](https://w3c.github.io/ServiceWorker/#navigator-service-worker-unregister): unregister job использует scope, текущие controlled clients могут продолжать работать до unload.
- [MDN ServiceWorker methods](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorker#instance_methods): публичного force start/stop/terminate нет.
- [MDN skipWaiting()](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/skipWaiting): worker-global API; cooperative messaging обсуждается отдельно и не реализуется здесь.
- [ADR 0002](../adr/0002-devtools-page-bridge.md), [LEARNINGS](../LEARNINGS.md), [TESTING](../TESTING.md): существующие relay, identity, permission и Safari evidence ограничения остаются обязательными.
- Документация подтверждает Web API semantics; успешная сборка и synthetic fixture не доказывают Safari runtime. Этот план не содержит отметок о выполненной реализации.
