# Развитие SW Inspector: согласованные границы для реализации

Дата: 2026-10-19. **Статус на 2026-10-21: внутренний фундамент 00/A1–A4 code-complete; 01/C1–C3 реализованы; 02/W1 code-complete; следующая задача реализации 02/W2; native 01/C4 acceptance остаётся открытой.** Native Safari acceptance A1 остаётся открытой ([проверки](../TESTING.md#a1-document-identity-and-routing--2026-10-20)); ADR 0004 принят для confirmed selected namespace, fixed-list batch и retained-request entry deletion; native C2 Cancel/batch-delete подтверждён пользователем 2026-10-21 ([evidence](../TESTING.md#c2-user-reported-native-safari-acceptance--2026-10-21)); native C1 Cancel/single-delete подтверждён пользователем 2026-10-21 ([evidence](../TESTING.md#c1-user-reported-native-safari-acceptance--2026-10-21)); остальные native проверки открыты. Запрос пользователя: очистка кеша, управление SW, Web App Manifest, отправка и приём сообщений; планы должны снимать архитектурные догадки с небольших моделей. UI остаётся английским, документы — русскими.

## Выбранный подход

Расширить существующий Inspector: пассивная диагностика по умолчанию, отдельные явные операции над выбранной целью. Это сохраняет текущий relay и визуальный язык Safari Storage/Network. Альтернативы — универсальная «опасная консоль» или перенос в background/content scripts — добавляют произвольное исполнение/permissions и не нужны для перечисленных API. Полное повторение Chrome Application невозможно обещать через публичный page API Safari.

Текущая архитектура: `App.svelte` → `createTransport` → синхронный JSON start/poll → `eval-window.ts` → session relay → **devtools_page** → функции страницы. Нативный eval из панели запрещён по [ADR 0002](../adr/0002-devtools-page-bridge.md). Эта цепочка сохраняется.

## Общие требования

1. Только текущий основной документ и его доступная origin/storage partition. Не сканировать iframes, другие вкладки, браузерные профили.
2. Permissions остаются `devtools`, `activeTab`. Без host patterns, content scripts, background, telemetry, новой runtime-зависимости.
3. По умолчанию нет изменений сайта, сетевых загрузок manifest, отправки сообщений или слушателей. Явный Load manifest — отдельное разрешённое чтение; Check for update может инициировать сеть/установку браузером.
4. Существующие ограничения чтения сохраняются: 1,500 keys, 12 snapshots, 5 min TTL, text preview 48 KiB; origin usage не становится «размером кеша».
5. Потеря результата действия не равна отсутствию эффекта. Не повторять commit автоматически, не показывать Undo, если rollback отсутствует.
6. Любое page data/JSON/ошибку выводить текстом; никакого HTML, eval payload, расширения разрешений для обхода ошибок.
7. Текущие строки `Read-only` остаются правдой до включения первого действия. После — `Inspect` / явные названия операций; пассивный режим описать точно. Обновить package/manifest description, README, PRODUCT, AGENTS, DESIGN и маркетинговые утверждения при выпуске, без преждевременного обещания новых функций сейчас.

## Идентичность страницы и цели

`PageIdentity = { documentId: string; origin: string; url: string }`. `documentId` — случайный token в случайном registry key конкретного Inspector и JS-документа; `url` — полный `location.href`. Проверять все три поля **в странице непосредственно перед действием**, и после каждого await, предшествующего эффекту. Два Inspector имеют разные registry keys. Это не механизм защиты от злонамеренного inspected JS: публичный page context остаётся доверительной границей DevTools.

Обновление origin недостаточно: Safari может не прислать навигационное событие, а reload оставить прежний URL. При `pagehide` контекст закрывается, tickets/ports/listeners освобождаются. При восстановлении BFCache создавать новую идентичность, не оживлять старые handles. Изменение SPA URL делает сохранённую цель stale; требуется Refresh. Не исправлять эту проблему запросом широких permissions.

`src/bridge/page-context.ts` содержит self-contained `createPageContext(registryKey: string): PageContext`. Минимальный публичный контракт:

```ts
type WorkerSlot = 'active' | 'waiting';
type RetainedRegistration = {
  page: PageIdentity;
  registration: ServiceWorkerRegistration;
  expiresAt: number;
  workers: Partial<Record<WorkerSlot, { workerId: string; worker: ServiceWorker }>>;
};
interface PageContext {
  identity(): PageIdentity;
  isCurrent(expected: PageIdentity): boolean;
  onDispose(cleanup: () => void): void;
  replaceRegistrationCleanup(cleanup: () => void): void;
  registrations: Map<string, RetainedRegistration>;
  actions: Map<string, unknown>; // internal records owned by control runner
  manifests: Map<string, unknown>; // records owned by manifest runner
  messages: Map<string, unknown>; // records owned by message runner
}
```

`replaceRegistrationCleanup` владеет одним cleanup для коллекции регистраций: замена синхронно вызывает предыдущий cleanup, disposal вызывает текущий один раз; после закрытия новый cleanup исполняется сразу. Это ограничивает overview одним TTL timer даже при пересоздании сериализуемой фабрики.

Контекст и все retained browser objects живут только в inspected document. Не сериализовать их в панель. `unknown` в локальных registry не разрешает unsafe casts на wire: каждый владелец задаёт свой внутренний тип и проверяет получаемые commands. Registry не сохраняется в localStorage/extension storage.

## Протокол явного действия

Контракты в `src/domain/actions.ts`; JSON-типы определяются там же рекурсивно (`null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }`). `src/domain/commands.ts` собирает `InspectorCommand` из существующего DiagnosticCommand, page-context, ControlCommand, затем ManifestCommand/MessagingCommand по мере добавления. Старый API `transport.invoke<T>` сохраняется; wire result проверяется владельцем операции.

```ts
type ActionIntent =
  | { kind: 'delete-cache'; cacheName: string }
  | { kind: 'delete-all-caches' }
  | { kind: 'delete-cache-entry'; cacheName: string; requestKey: string }
  | { kind: 'update-worker' | 'unregister-worker'; registrationId: string }
  | { kind: 'send-worker-message'; sessionId: string; registrationId: string; workerId: string;
      slot: WorkerSlot; jsonText: string; reply: 'none' | 'port' };
type ActionKind = ActionIntent['kind'];
type ActionTicket = { ticketId: string; operationId: string; page: PageIdentity;
  expiresAt: number; kind: ActionKind; summary: string[] };
type ActionItem = { target: string; outcome: 'applied' | 'absent' | 'failed' | 'skipped'; message?: string };
type ActionReceipt = { operationId: string; kind: ActionKind;
  status: 'completed' | 'partial'; items: ActionItem[] };
type ControlCommand =
  | { type: 'prepare-action'; expectedPage: PageIdentity; intent: ActionIntent }
  | { type: 'commit-action'; expectedPage: PageIdentity; ticketId: string };
interface ActionHandler {
  prepare(intent: ActionIntent): Promise<{ summary: string[]; retained: unknown }>;
  execute(retained: unknown, isCurrent: () => boolean): Promise<ActionItem[]>;
}
type ActionHandlers = Partial<Record<ActionKind, ActionHandler>>;
type ActionRejection = { kind: 'action-rejected';
  code: 'stale-target'|'invalid-command'|'unsupported'|'cache-not-found'; message: string };
```

`createControlRunner(context, handlers)` в `src/actions/page-runner.ts` отвечает за protocol; специализированные self-contained factories `createCacheActions(context, snapshotRegistryKey)`, `createWorkerActions(context)`, `createMessageActions(context, formatPreview)` возвращают ActionHandlers. Handler владеет конкретным retained типом, проверяет intent.kind и повторно проверяет живую цель перед API call. Браузерные вызовы не прятать в универсальную plugin architecture. Контракт formatPreview определён в плане сообщений; он явно передаётся обеим message factories.

Для типизированного отказа handler бросает plain `ActionRejection` **только до первого эффекта**. Control runner проверяет marker и allowlist кодов, преобразует в Result error. Импортированный Error subclass в stringified factory не использовать. После первого эффекта batch возвращает известные items и skipped/failed для остальных; непредвиденное исключение без доказанного безопасного отказа — outcome-unknown. Нельзя помечать произвольное исключение браузера как `action-rejected`.

Порядок для namespace/batch: prepare читает актуальную цель → показывает ticket summary → подтверждение пользователем → commit атомарно помечает ticket использованным до первого await → один вызов handler → receipt → перечитать затронутые данные. Prepare ничего не удаляет/не обновляет/не посылает. Confirmation показывает origin, полную цель и последствия. Focus по умолчанию на Cancel, Escape отменяет, focus возвращается к вызвавшей кнопке.

Исключение C3 по запросу пользователя 2026-10-21: **Delete entry** не показывает confirmation, но выполняет fresh prepare → commit exact local ticket в одной generation. Reset/смена selection/navigation до dispatch отменяет старый путь; stale prepare никогда не подтверждает более новый shared ticket.

Ticket: 30 s, один ожидающий на Inspector/document. Повторный prepare инвалидирует предыдущий. Commit проверяет identity/TTL/валидность и блокирует конкурентный commit в том же контексте. Для consumed ticket вернуть уже записанный receipt; пока операция не завершена — `action-busy`, повторный эффект запрещён. Ledger максимум 100 records, TTL 5 min; pending record не вытеснять и не снимать блокировку по transport timeout. Закрытие документа прекращает возможность новых действий из этой панели, но не откатывает браузерную операцию.

Добавить ErrorCode: `stale-target`, `action-expired`, `action-busy`, `invalid-command`, `unsupported`, `outcome-unknown`. Существующий Result остаётся. До commit безопасная ошибка — обычный Result error. После попытки отправить commit любой неясный timeout/abort/transport exception/malformed/missing reply — `outcome-unknown` с текстом **“The action may have completed. Refresh to inspect the current state.”** Только валидный page-side отказ до эффекта можно назвать отказом. Никакого автоматического повторения с новым ticket.

Receipt `completed` означает, что обработаны все цели; каждое `applied/absent/failed` показывается отдельно. `partial` — есть failed/skipped либо работа остановилась между целями. `applied` трактуется по операции: для update это завершение проверки, для message — submission, не активация/доставка. У receipt нет обещания атомарности или отсутствия конкурирующих записей сайта.

## Сериализация и интеграция

`expressions.ts` сейчас вставляет `createPageRunner.toString()`. Обычные runtime imports внутри новой page factory **не попадут в страницу**. Конструировать expression явно из сериализованных factories: создать context, создать map поддержанных handlers, передать их в control runner; для manifest/messages передать тот же context. Только type imports разрешены без явной runtime-инъекции. Unsupported kind отвергать; не исполнять диагностический `checkUrls` как fallback для неизвестной команды.

`overview` возвращает дополнительное `page: PageIdentity`. `Registration.registrationId?` и `WorkerState.workerId?` добавляет W1; отсутствие ID означает, что управление недоступно, а не отсутствие регистрации. При полном Refresh атомарно заменить registry handles. Лимит 100 registrations, TTL 5 min, до двух worker refs каждой регистрации; при превышении все action handles выключены, список диагностики остаётся. Не выбирать регистрацию заново по URL/scope вместо устаревшего ID.

Mounted state сейчас находится в `entrypoints/panel/App.svelte`; `src/ui/diagnostic-store.svelte.ts` там не используется. Новая операция не считается интегрированной после изменения только этого store. Выносить только новые самостоятельные панели/confirmation, не переписывать весь App в рамках roadmap.

## UI и границы функций

Сохранить [DESIGN](../../DESIGN.md): 12px system, 11px mono, плоские разделители, системная тема, таблицы и локальный scroll. Cache actions — в текущем cache toolbar/response pane; SW actions — у выбранной регистрации; Manifest и Messages — destinations в sidebar **и** compact select. Новые ошибки локальны, toolbar/overview не исчезают при ошибке функции. Длинные URL не должны прятать действие или target confirmation.

Cache deletion ограничен Cache Storage; unregister не удаляет кеши и не останавливает уже controlled clients. Update не равен activation. Нет универсального skipWaiting. Manifest — объявленные данные и вычисления инспектора, не browser installability. Messages — только текущий document и явно открытый reply port; не весь трафик SW.

## Проверки перед выпуском

Каждая задача фиксирует собственные тесты. Общие обязательные adversarial cases: same-origin reload без события Safari; смена цели при том же URL; двойной клик; timeout после эффекта; hostile/слишком большие данные; завершение старого ответа после новой selection. Проверять сгенерированный expression в свежем realm без исходных module closures. Кроме unit-тестов нужен synthetic browser fixture с настоящими Cache/ServiceWorker API.

Команды после изменения кода: `rtk proxy pnpm test`, `rtk proxy pnpm check`, `rtk proxy pnpm build:safari`, `rtk proxy pnpm check:manifest`. При wrapper acceptance — `rtk proxy pnpm sync:safari`. Новые зависимости не добавлять только ради удобства тестов; если браузерный harness не установлен, отдельно зафиксировать это и использовать ручной fixture workflow. Для Svelte использовать официальный Svelte MCP при реализации компонентов.

Native Safari acceptance — реальный браузер и disposable fixture origin, не production site. Никогда не испытывать удаление на пользовательских данных по умолчанию. Записать Safari/macOS version, installation route, extension reload, permission gesture, action/ожидаемый/фактический результат. Без native проверки задача может быть code-complete, но не release-accepted.
