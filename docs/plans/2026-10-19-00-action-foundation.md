# Action Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Не коммить без указания пользователя; этот workspace уже содержит чужие staged/unstaged изменения.

**Goal:** Создать проверяемую границу между чтением состояния и явным действием в конкретном inspected document.
**Architecture:** Сохранить devtools-page relay/start-poll. Ввести page identity, одноразовый prepare/commit и локальный controller подтверждения. Page-side handlers добавляются последующими планами.
**Tech Stack:** существующие TypeScript, Svelte 5, WXT, Vitest, Web APIs; без новой runtime dependency.
**Spec:** [development design](2026-10-19-development-design.md), [ADR 0004, proposed](../adr/0004-explicit-development-actions.md).
**Status:** Partial foundation, 2026-10-20: A1 и A2 code-complete и прошли независимые code/design review; native Safari acceptance pending. A3–A4 не реализованы. Текущая поставка остаётся read-only; [проверки A1](../TESTING.md#a1-document-identity-and-routing--2026-10-20), [проверки A2](../TESTING.md#a2-preparecommit-and-bounded-ledger--2026-10-20).

## Global Constraints

- Применяются все требования и точные лимиты общего design; contracts не переименовывать в дочерних планах.
- `devtools`, `activeTab`; ни одного native eval из панели, ни одного автоматического commit retry.
- Сохранить read-only поведение до первого установленного handler и его UI.
- 15 s transport, 50 ms job polling, 60 s job expiry остаются; action ledger — отдельное состояние.
- Не считать `diagnostic-store.svelte.ts` mounted store: App.svelte сейчас владеет UI.

## Review Focus

| Случай | Нужное поведение | Тест задачи |
| --- | --- | --- |
| Same-origin reload без navigation event | Отказ до effect, включая прежний URL | A1/A3 |
| Потерян ответ после side effect | Outcome unknown, ни одного resubmit | A3 |
| Двойной click/повтор consumed ticket | Максимум одно execute, повторный receipt | A2 |
| Imported helper отсутствует после `.toString()` | Полный expression работает в свежем realm | A3 |
| Старый prepare/result после новой selection | Confirmation закрывается, UI не публикует старое | A4 |

## A1 — Идентичность документа и исчерпывающая маршрутизация

**Files:** create `src/bridge/page-context.ts`, `src/domain/commands.ts`, `tests/bridge/page-context.test.ts`; modify `src/domain/types.ts`, `src/diagnostics/page-runner.ts`, `src/bridge/expressions.ts`, `src/bridge/transport.ts`, `tests/bridge/expressions.test.ts`, `tests/diagnostics/page-runner.test.ts`.

**Interfaces:** `createPageContext(registryKey:string):PageContext`, PageIdentity/PageContext ровно из design. `InspectorCommand` initially включает `DiagnosticCommand | {type:'page-context'}`. `Overview.page:PageIdentity`. `createPageRunner(snapshotRegistryKey?, context?)` сохраняет текущие unit callers; production всегда передаёт context, default контекст разрешён только для прямого исполнения через `executeDiagnostic`, также привязан к документу.

- [x] Написать `same_document_reuses_identity_but_fresh_realm_does_not`: два вызова одного registry в том же документе дают один documentId; новый документ по тому же URL даёт другой; другой Inspector key изолирован.
- [x] Написать `pagehide_disposes_once_and_bfcache_does_not_restore_handles`: dispose callback вызывается один раз, registries пусты, старый expectedPage не принимается после pageshow. Поменять только hash/path → isCurrent(old) false.
- [x] Написать `unknown_command_does_not_run_check_urls`: любой нераспознанный type возвращает invalid-command и не вызывает Cache API. Запустить `rtk proxy pnpm exec vitest run tests/bridge/page-context.test.ts tests/bridge/expressions.test.ts tests/diagnostics/page-runner.test.ts`; убедиться, что новые assertions падают до изменения реализации.
- [x] Реализовать context внутри self-contained factory. Dispose хранит `closed=true`; следующий createPageContext заменяет закрытый instance. Очистка регистраций и пользовательских cleanup callbacks; не выполнять произвольные pending actions при lifecycle events.
- [x] Добавить context в production expressions/overview и switch по командам с явным unknown-result. `page-context` возвращает текущую identity синхронно внутри job результата; никаких сетевых запросов. Обновить fixtures typed Overview и export: page identity НЕ добавлять автоматически в публичный report.
- [x] Повторить указанную команду: все выбранные тесты PASS. Проверить existing overview/cache/preview tests; не менять старые data limits.

## A2 — Prepare/commit и ограниченный ledger

**Files:** create `src/domain/actions.ts`, `src/actions/page-runner.ts`, `tests/actions/page-runner.test.ts`; modify `src/domain/commands.ts`, `src/domain/types.ts` (коды ошибок).

**Interfaces:** contracts ActionIntent/ActionHandlers/Ticket/Receipt/ControlCommand из design. `createControlRunner(context:PageContext, handlers:ActionHandlers)` → `(command:ControlCommand)=>Promise<Result<ActionTicket|ActionReceipt>>`. Handler map пока пустой в production, fake handlers только в тестах. Внутренние action records typed в этом файле, не `any`.

- [x] Написать тесты `prepare_has_zero_effects`, `commit_executes_once`, `duplicate_pending_is_busy`, `duplicate_complete_returns_same_receipt`, `unsupported_kind_is_rejected`. Fake handler считает prepare/execute отдельно; повторный ticket не увеличивает execute count.
- [x] Написать `expired_or_changed_page_never_executes`: 30,000 ms TTL; несовпадающие documentId/origin/url; новый prepare отменяет старый ticket. `busy_lock_survives_ui_timeout`: пока Promise execute не settled, новый commit не запускается.
- [x] Написать `ledger_is_bounded_and_partial_is_not_success`: ≤100 completed records, TTL 300,000 ms; pending не вытесняется; failed/skipped item → partial. На лимите pending/records освобождать только completed/expired, иначе action-busy. Тест failure после первой цели сохраняет результат первой, не превращает весь batch в «ничего не сделано».
- [x] Запустить `rtk proxy pnpm exec vitest run tests/actions/page-runner.test.ts`, увидеть новые FAIL. Реализовать guards, intent validation, serial commit и receipt. Ticket помечается consumed/operation running до первого await commit. Summary приходит только от handler, выводится текстом; не исполняется и не интерполируется в code.
- [x] Передать handler callback `isCurrent()` с frozen ticket.page. Handler обязан проверить callback после каждого await перед следующим effect. Неожиданное исключение handler после dispatch не объявлять гарантированным отказом: error outcome-unknown, при необходимости сохранять известные items.
- [x] Повторить test command; PASS. Проверить fake clock cleanup и отсутствие timers после dispose. Не добавлять production test/no-op actions.

## A3 — Реальная сериализация и неизвестный исход

**Files:** modify `src/bridge/expressions.ts`, `src/bridge/transport.ts`, `tests/bridge/expressions.test.ts`, `tests/bridge/transport.test.ts`; handlers зарегистрировать только по мере реализации C/W/S задач.

**Interfaces:** `createJobStartExpression(command:InspectorCommand,jobId:string):string`; `transport.invoke<T>(command:InspectorCommand,options?)` остаётся. Control runner получает map явно сериализованных factory results; ordinary diagnostics/manifest/messages идут в свои factories. No generic eval command on wire.

- [ ] Тест `serializes_control_dependencies_into_fresh_realm`: evaluated start/poll без импортированного module scope работает с fixture handler; строка `</script>`/U+2028/U+2029 остаётся данными. Реальные domain handlers позже покрываются собственными integration tests, production test handler не нужен.
- [ ] Тесты `commit_timeout_after_start_is_unknown`, `commit_lost_ack_is_unknown`, `commit_malformed_reply_is_unknown`, `commit_failed_poll_is_unknown`: start мог исполниться даже если ack не пришёл; один start, ноль retries. Pre-aborted invoke делает ноль eval и возвращает aborted. Prepare timeout остаётся обычным timeout, поскольку effect не запускался.
- [ ] Тест `valid_pre_effect_rejection_is_preserved`: receipt/error schema проверяется до публикации, page-side stale-target/action-expired не подменяется успехом. Смена документа после completed action подавляет публикацию в новом document и сообщает unknown на старой operation; не запускает rollback.
- [ ] Запустить `rtk proxy pnpm exec vitest run tests/bridge/expressions.test.ts tests/bridge/transport.test.ts`, убедиться в FAIL новых случаев; реализовать классификацию commitAttempted непосредственно перед отправкой start expression (не после ack).
- [ ] Проверить generated JS bundle после `rtk proxy pnpm build:safari`: factories не ссылаются на отсутствующие minified imports. Прогнать start/poll в fresh realm из собранного bundle в fixture; исходный TS unit тест сам по себе не доказывает сохранение `.toString()` зависимостей.
- [ ] Повторить тесты до PASS; оставить native relay tests без ослабления sender/session/URL checks.

## A4 — Один controller и одно подтверждение

**Files:** create `src/ui/action-controller.ts`, `entrypoints/panel/ActionConfirmation.svelte`, `tests/ui/action-controller.test.ts`; modify `entrypoints/panel/App.svelte`, `docs/TESTING.md` только для нового acceptance checklist. Не заменять весь App store.

**Interfaces:**

```ts
type ActionState = {
  phase: 'idle'|'preparing'|'confirming'|'running'|'result';
  ticket: ActionTicket|null; receipt: ActionReceipt|null; error: string|null;
};
createActionController(deps: {
  invoke: <T>(command: ControlCommand) => Promise<Result<T>>;
  getPage: () => PageIdentity|null;
  onState: (state: ActionState) => void;
  onSettled: (receipt: ActionReceipt|null) => Promise<void>;
}): {
  prepare(intent:ActionIntent):Promise<void>; confirm():Promise<void>;
  cancel():void; reset():void;
};
```

`onState` присваивает новое значение `$state` в App; plain object controller сам не становится reactive. `ActionConfirmation` props: `ticket`, `busy`, `onconfirm`, `oncancel`; небольшой native dialog с полной summary. Контроллер — единственный владелец повторного клика/публикации результата; feature controls только вызывают `prepare`.

- [ ] Тесты `cancel_never_commits`, `confirm_uses_frozen_ticket`, `double_confirm_is_one_invoke`, `reset_ignores_late_prepare`, `settled_refresh_failure_does_not_hide_receipt`. До overview.page prepare disabled; новая selection/Refresh/navigation → reset. reset не отменяет уже запущенную browser operation.
- [ ] Запустить `rtk proxy pnpm exec vitest run tests/ui/action-controller.test.ts`, затем минимально реализовать state machine. При unknown onSettled(null) перечитывает текущие данные только если всё ещё тот же document; ошибка refresh сохраняется отдельно от исхода действия.
- [ ] Подключить controller/confirmation к App без доступных mutation кнопок до установки feature handler. Во время running нельзя Cancel/Stop с обещанием отмены; можно закрыть result после завершения. При known completion показать receipt и обновить затронутые данные, не перезагружать сайт автоматически.
- [ ] Проверить UI fixture: Cancel initial focus, Escape только до commit, focus return, длинные URL, light/dark, 1280px/540px widths, keyboard. Вызвать официальный Svelte MCP для новых/изменённых компонентов и исправить замечания.
- [ ] Выполнить общие code checks из design. В native Safari пока проверить только Refresh/context/relay и смену документа без effects; mutation acceptance выполняют feature plans.

## Передача результата

Зафиксировать A1–A4 по отдельности: paths, new contracts, фактически запущенные tests, неизвестные native cases. Не принимать ADR 0004 и не менять обещание текущей поставки только за наличие внутреннего фундамента. Первый пользовательский action план делает это одновременно со своим UI.
