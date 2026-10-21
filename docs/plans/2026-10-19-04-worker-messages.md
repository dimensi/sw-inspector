# Service Worker Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Коммиты только по отдельному указанию.

**Goal:** Послать JSON выбранному active/waiting worker, получить кооперативный ответ по port и наблюдать сообщения, доставленные inspected document.
**Architecture:** Общий action controller для отправки; отдельная opt-in message session, bounded buffer и leased page listeners. Всё через текущий relay и start/poll, без перехвата browser protocol.
**Tech Stack:** TypeScript/Svelte 5, ServiceWorker.postMessage, MessageChannel, ServiceWorkerContainer events, Vitest.
**Spec:** [development design](2026-10-19-development-design.md), [00](2026-10-19-00-action-foundation.md), [02/W1 worker handles](2026-10-19-02-worker-management.md).
**Status:** S1 code-complete (2026-10-21); S2–S4 planned. No Messages UI, send remains unsupported. Dependencies: A1–A4 и W1. W2/W3 для send не нужны.

## Global Constraints

- Не перезаписывать `navigator.serviceWorker.onmessage`, не patch postMessage/fetch, не трогать ports чужих сообщений.
- Ноль history до Start listening. Нет доступа к другим clients или частным MessagePorts сайта. Отправка может разбудить worker и вызвать произвольное поведение его обработчика; confirmation это сообщает.
- Отправлять только JSON, включая primitives/null. Не выполнять JS, не отправлять автоматический ping, SKIP_WAITING или неизвестный «универсальный» протокол.
- Payload ≤16 KiB UTF-8 исходного JSON; textarea тоже ограничена 16,384 code units, затем byte check в panel и page. Invalid/oversize → 0 postMessage.
- Port reply timeout 5 s; message session lease 10 s; poll раз в 1 s, без overlap. ≤500 rows и ≤2 MiB сериализованных UTF-8 row data на session, ≤16 KiB preview на row. Один session на Inspector/document. Это выбранные продуктовые limits, не лимиты Web API.
- После view hide, panel close, Refresh/navigation/permission error — best-effort stop; page-side lease сам закрывает listeners/ports, даже если stop не дошёл. В скрытой view lease не продлевать. При возвращении явный Start listening, без автопродолжения.
- Не писать payload в console, storage, общий metadata export или telemetry. UI raw text only.

## Review Focus

| Случай | Поведение | Тест |
| --- | --- | --- |
| Worker сменился при том же scriptURL | Reject retained target до postMessage | S2 |
| Callback reply отсутствует/пришёл поздно | Timeout не равен failed delivery, порт закрыт | S3 |
| Cyclic/binary/huge incoming data | Ограниченный preview, без падения и утечки | S1 |
| Panel пропала без unload/stop | Lease закрывает только наши listeners/ports | S4 |
| SW отвечает через client.postMessage | Incoming row без выдуманной request correlation | S3/S4 |

## Контракты

**Files:** `src/messages/types.ts` (new); добавить MessagingCommand в `src/domain/commands.ts`.

```ts
type MessagingCommand =
  | { type:'open-message-session'; expectedPage:PageIdentity }
  | { type:'start-message-listener'; expectedPage:PageIdentity; sessionId:string }
  | { type:'read-message-events'; expectedPage:PageIdentity; sessionId:string; afterSeq:number }
  | { type:'stop-message-session'; expectedPage:PageIdentity; sessionId:string };
type MessageSession = { sessionId:string; page:PageIdentity; expiresAt:number };
type MessageRecord = {
  seq:number; timestamp:number; direction:'outgoing'|'incoming'|'reply'|'system';
  sourceURL:string|null; requestId:string|null;
  text:string; truncated:boolean;
  status:'posted'|'received'|'reply-timeout'|'message-error';
};
type MessageBatch = { sessionId:string; records:MessageRecord[];
  nextSeq:number; dropped:number; listening:boolean; expiresAt:number };
```

`createMessageRunner(context:PageContext, formatPreview:typeof formatMessagePreview)` → `(command:MessagingCommand)=>Promise<Result<MessageSession|MessageBatch|{stopped:true}>>` в `src/messages/page-runner.ts`. `createMessageActions(context:PageContext, formatPreview:typeof formatMessagePreview):ActionHandlers` в `src/messages/page-actions.ts`. Внутренний MessageSessionRecord shared type в `src/messages/session-types.ts`: identity, id, expiresAt, nextSeq, dropped, rows, byteCount, listening, cleanup callbacks/owned ports. Record хранится в context.messages по sessionId; тип не пересылается.

Внутренний runtime под `message:runtime:v1` владеет active record и одним lease timer на context; он создаётся один раз с одним dispose hook. Records по-прежнему доступны только по sessionId в context.messages. Record имеет internal `append` для общей ring accounting, cleanup Set и owned ports Set; это не public wire API. Новый open закрывает предыдущую session. Полная serialized row свыше128KiB отбрасывается до помещения в ring (слишком длинная metadata preflight до полного stringify), seq и dropped увеличиваются. Source URL не обрезается в ложную полную цель. Batch128KiB считает serialized row data, cursor остаётся последним возвращённым seq.

Open session не ставит listeners и не посылает сообщения. Session создаётся только по Send/Start listening, не при mount. Start listener устанавливает addEventListener один раз. Read возвращает до **50 rows / 128 KiB** после afterSeq и продлевает lease; nextSeq = последний возвращённый seq (или прежний cursor), поэтому backlog не пропускается. dropped — накопительное число вытесненных rows, не количество unread; разрыв seq отображать явно. Stop закрывает listeners/owned ports и удаляет record. Expired/missing session → stale-target, никакого silent recreate.

Успешный controller.open() запускает serial polling сразу, включая время confirmation: иначе 10-секундная lease истечёт раньше 30-секундного ticket. Это чтение нашего буфера, не включение ServiceWorkerContainer listener. При скрытии Messages polling прекращается по общему правилу.

## S1 — Ограниченные сериализация и журнал

**Files:** create `src/messages/preview.ts`, `src/messages/session-types.ts`, `src/messages/page-runner.ts`, `tests/messages/preview.test.ts`, `tests/messages/session.test.ts`; modify expressions/commands.
**Interfaces:** `formatMessagePreview(value:unknown):{text:string;truncated:boolean}` — self-contained serializable function. Для page factories передавать её явно при сборке expression (добавочный аргумент `formatPreview`), обычного import внутри stringified body недостаточно. JSON-safe значения показывать как JSON; BigInt, Date, Map/Set, Blob, ArrayBuffer/views/ports обозначать type+size, без чтения Blob bytes и чужих ports. Cycles = `[Circular]`; depth >6 или >1,000 visited nodes = truncated. Не вызывать пользовательский toJSON/getters.

- [x] Тесты valid primitive/null, UTF-8 16KiB boundary с emoji, cyclic inbound, deep arrays, 10MiB string, binary object, HTML/script-like text. Проверить длину итогового UTF-8 preview ≤16KiB и truncated. Big input не stringify целиком перед обрезкой.
- [x] Тесты ring capacity500, total2MiB eviction, monotonic seq, pagination50/128KiB, explicit dropped counter. После Stop/expiry record и listeners отсутствуют. Read не возвращает rows другой session/document.
- [x] `rtk proxy pnpm exec vitest run tests/messages/preview.test.ts tests/messages/session.test.ts`: сначала новые FAIL, затем реализация, затем PASS. Timer использует expiresAt и fake clock; каждый read не создаёт ещё один бесконечный timer.
- [x] Проверить полный generated start/poll с сериализованным formatPreview в fresh realm; добавить тест в `tests/bridge/expressions.test.ts`.

**S1 scope note:** malformed/oversize outgoing JSON validation тестируется S2, где появляется prepare/send path; отдельный speculative public validator в S1 не добавлен. Runtime ownership и oversized-row drop уточнены выше без изменения публичных command/result interfaces. Send и Messages UI остаются неподключёнными; policy activation не выполнялась.

## S2 — Отправка JSON в конкретный worker

**Files:** create `src/messages/page-actions.ts`, `tests/messages/send.test.ts`; modify action handler wiring.
**Interfaces:** intent из общего design: sessionId/registrationId/workerId/slot/jsonText/reply. Prepare валидирует JSON/bytes/session/page, ищет retained registration/slot из W1 и фиксирует worker ref + JSON value + новый requestId. Summary включает origin, scope, slot, scriptURL, JSON text, reply mode и **“This sends data to website code and may change website state.”**

- [ ] Тесты активного и waiting target; missing/redundant/replaced worker с тем же URL; registration TTL; изменившийся slot до commit; expired message session; invalid/oversize JSON. Для всех отказов postMessage count=0.
- [ ] Тест `post_once_without_application_ack`: для reply=none один postMessage(value), исходный JSON не оборачивается нашим envelope; no throw → item applied с сообщением **“Message posted. Delivery is not confirmed.”** + outgoing row posted. Отсутствие ответов не превращается в synthetic success.
- [ ] `rtk proxy pnpm exec vitest run tests/messages/send.test.ts`: получить FAIL, реализовать self-contained factory и живую проверку target перед effect, повторить до PASS. PostMessage exception → failed с безопасным text; транспортная неопределённость обрабатывается 00, повторять payload запрещено.
- [ ] Send confirmation всегда через общий controller. После send onSettled читает message batch; НЕ вызывает полный overview Refresh, который инвалидировал бы worker handles/session.

## S3 — Ответ по MessageChannel

**Files:** modify `src/messages/page-actions.ts`, `src/messages/page-runner.ts`; create `tests/messages/reply.test.ts`.
**Interfaces:** reply='port' → создать MessageChannel, подписаться на собственный port1 до `worker.postMessage(value,[port2])`; никаких полей не добавлять в JSON. Worker должен сам ответить `event.ports[0].postMessage(value)`. Первый reply → row с тем же requestId; закрыть owned port1 и timer, локальную доступную сторону port2 при ошибке transfer. Не ждать reply внутри action handler: receipt фиксирует submission, результат поступает через read-message-events.

- [ ] Тесты immediate reply, reply через4,999ms, no reply через5,000ms, messageerror, late reply, duplicate reply, exception during post/transfer. После всех terminal paths и session dispose закрыты наши ports/timers, нет второго reply/эффекта.
- [ ] Тест `plain_client_message_is_not_correlated`: событие ServiceWorkerContainer.message не получает requestId даже если payload похож. Только выделенный port даёт correlation.
- [ ] `rtk proxy pnpm exec vitest run tests/messages/reply.test.ts`: сначала FAIL, затем реализация и PASS. Timeout row text **“No reply on the supplied port within 5 seconds. The message may have been handled.”** Не говорить worker offline/unresponsive глобально.

## S4 — Явный приём сообщений страницы и UI

**Files:** create `entrypoints/panel/MessagesPane.svelte`, `src/ui/message-session-controller.ts`, `tests/ui/message-session-controller.test.ts`; modify App/Icon, fixtures/controls-demo index/sw и TESTING.
**Interfaces:** MessagesPane props `{page:PageIdentity|null,registrations:Registration[],onintent:(intent:ActionIntent)=>void}`; локальный controller `createMessageSessionController({invoke,onState,getPage})` с методами `open():Promise<MessageSession|null>`, `startListening():Promise<void>`, `stop():Promise<void>`, `dispose():void`. onState даёт `{session,rows,listening,error,dropped}`; row retention в панели также500/2MiB. Controller scheduling serial 1s, без overlap; dispose синхронно выключает polling, stop best effort.

- [ ] Тест start/stop/restart: свои message/messageerror listeners не дублируются и не заменяют page onmessage; Start listening не посылает сообщение. Native event.source scriptURL только metadata, не authentication/доказательство controller.
- [ ] Тесты session lease истекает после потери панели; permission failure прекращает polling и продление; view hide/Refresh/navigation обнуляют draft/targets/rows и вызывают dispose. Очистка видимого журнала (**Clear log**) продвигает cursor, не останавливает listener и не очищает данные сайта.
- [ ] `rtk proxy pnpm exec vitest run tests/messages tests/ui/message-session-controller.test.ts` → сначала FAIL новых кейсов, затем PASS после реализации.
- [ ] Добавить Messages в sidebar и compact select. Сверху target registration + active/waiting, textarea JSON, reply checkbox, **Send…**. Отдельно **Start listening / Stop listening**, **Clear log**, индикатор listening/expired/dropped; ниже плотная таблица Time/Direction/Source/Status и text details. Не декоративный chat UI, не message bubbles. Send enabled при valid page/target/JSON даже без session: click сначала await controller.open(), затем prepare с возвращённым sessionId, без включения listener. На время open/prepare/commit Send disabled; неудачный open показывает local error и допускает только явный новый click.
- [ ] Synthetic fixture поддерживает только документированные локальные команды: echo по supplied port, no-reply, delayed-reply, page-directed message. Вариант «Activate waiting worker» показывать только как пользовательский JSON к fixture, в продукте не создавать preset SKIP_WAITING. Fixture side effects не переносить в generic inspected page.
- [ ] Проверить реальные browser MessageChannel и ServiceWorker API, UTF-8/hostile text, narrow/light/dark, keyboard, multiple Inspector sessions. Official Svelte MCP для компонентов, общие code checks, native Safari send/reply/listen/stop/reload на disposable fixture. Записать, какие проверки действительно выполнены.
- [ ] Обновить PRODUCT/ADR0004/copy только для реализованных возможностей; никакого automatic payload export или persisted draft. Pending native cases не заменять success по mocks.

## Источники

- [ServiceWorker.postMessage](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorker/postMessage): structured clone/transfer и отсутствие подтверждения доставки в return value.
- [ServiceWorkerContainer.message](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/message_event): сообщения текущему document.
- [MessageChannel](https://developer.mozilla.org/en-US/docs/Web/API/MessageChannel), [MessagePort.close](https://developer.mozilla.org/en-US/docs/Web/API/MessagePort/close): отдельный reply channel и cleanup.
- [skipWaiting](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/skipWaiting): API worker global; произвольный message не вызывает его без обработчика сайта.
