import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { expect, it } from 'vitest';
import { createPanelRelay } from '../../src/bridge/devtools-relay';
import { createTransport } from '../../src/bridge/transport';
import type { Overview } from '../../src/domain/types';
import { createJobStartExpression, createJobPollExpression } from '../../src/bridge/expressions';

it('existing synthetic fixture can run A1 overview', async () => {
  const realm = createContext({ window: {}, location: { origin: 'http://127.0.0.1:4186' }, crypto, EventTarget, Request, Response, URL, setTimeout: () => 0 });
  runInContext(readFileSync('.impeccable/preview/fixture.js', 'utf8'), realm);
  runInContext('globalThis.previewControl = window.previewControl', realm);
  const send = (source: string) => realm.window.browser.runtime.sendMessage({ session: 'preview', source });
  const started = await send(createJobStartExpression({ type: 'overview' }, 'test'));
  expect(JSON.parse(started.result)).toEqual({ jobId: 'test' });
  await new Promise(resolve => setImmediate(resolve));
  const reply = JSON.parse((await send(createJobPollExpression('test'))).result);
  expect(reply.state).toBe('complete');
  expect(reply.result.ok).toBe(true);
  expect(reply.result.value.page.url).toBe('https://fixture.example.test/');
});

it('explicit refresh reads external changes and a same-URL replacement without a navigation event', async () => {
  const mutable = { names: ['old-cache'], registrations: [{ scope: 'https://fixture.test/', active: { scriptURL: 'https://fixture.test/sw.js', state: 'activated' } }] };
  const makeRealm = () => {
    const events = new EventTarget();
    return createContext({ crypto, location: { origin: 'https://fixture.test', href: 'https://fixture.test/' },
      navigator: { serviceWorker: { controller: null, getRegistrations: async () => mutable.registrations }, storage: { estimate: async () => ({}) } },
      caches: { keys: async () => mutable.names, open: async () => ({ keys: async () => [] }) },
      setTimeout: () => 0, clearTimeout: () => {}, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) });
  };
  let realm = makeRealm();
  const transport = createTransport(async (source) => [runInContext(source, realm), undefined], { getOrigin: () => 'https://fixture.test', pollIntervalMs: 0 });
  const refresh = async () => {
    const result = await transport.invoke<Overview>({ type: 'overview' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };
  const before = await refresh();
  expect(before.caches.map(cache => cache.name)).toEqual(['old-cache']);
  expect(before.registrations).toHaveLength(1);
  mutable.names = [];
  mutable.registrations = [];
  const emptied = await refresh();
  expect(emptied.page.documentId).toBe(before.page.documentId);
  expect(emptied.caches).toEqual([]);
  expect(emptied.registrations).toEqual([]);
  realm = makeRealm();
  const reloaded = await refresh();
  expect(reloaded.page.documentId).not.toBe(before.page.documentId);
  expect(reloaded.page.url).toBe(before.page.url);
  expect(reloaded.caches).toEqual([]);
  expect(reloaded.registrations).toEqual([]);
});


it('synthetic fixture supports production activation epochs without evaluating activation messages', async () => {
  const realm = createContext({ window: {}, location: { origin: 'http://127.0.0.1:4186' }, crypto, EventTarget, Request, Response, URL, setTimeout: () => 0 });
  runInContext(readFileSync('.impeccable/preview/fixture.js', 'utf8'), realm);
  runInContext('globalThis.previewControl = window.previewControl', realm);
  const relay = createPanelRelay(realm.window.browser.runtime, 'http://127.0.0.1:4186/panel.html?session=preview');
  const refresh = () => { refreshed += 1; };
  let refreshed = 0;
  await relay.initializePanelActivation();
  await relay.requestPanelActivation(refresh, () => true);
  expect(refreshed).toBe(0);
  realm.window.previewControl.hiddenEpoch += 1;
  await relay.requestPanelActivation(refresh, () => true);
  await relay.requestPanelActivation(refresh, () => true);
  expect(refreshed).toBe(1);
  expect(realm.window.previewControl.calls).toEqual([]);
});
