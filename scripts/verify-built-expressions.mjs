// Run after pnpm build:safari. Uses exact AST node text from the generated artifact;
// it does not transpile/rebundle source modules or provide their closures.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { MessageChannel, MessagePort } from 'node:worker_threads';

const directory = new URL('../.output/safari-mv3/chunks/', import.meta.url);
const filename = (await readdir(directory)).find(name => /^panel-.*\.js$/.test(name));
assert.ok(filename, 'Build Safari first');
const bundle = await readFile(new URL(filename, directory), 'utf8');
const parsed = ts.createSourceFile(filename, bundle, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = parsed.statements.filter(ts.isFunctionDeclaration);
const start = functions.find(node => node.getText(parsed).includes('const jobsKey ='));
const poll = functions.find(node => node.getText(parsed).includes("state: 'missing'"));
assert.ok(start && poll, 'Compiled start/poll emitters must be present');
const selected = new Set([start, poll]);
// The emitters refer only to serialized factories, the string serializer, and
// the three random registry keys. Resolve those direct top-level dependencies.
for (const emitter of [start, poll]) {
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const declaration = functions.find(item => item.name?.text === node.expression.text);
      if (declaration) selected.add(declaration);
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'toString' && ts.isIdentifier(node.expression)) {
      const declaration = functions.find(item => item.name?.text === node.expression.text);
      assert.ok(declaration, 'Serialized factory declaration exists in artifact');
      selected.add(declaration);
    }
    ts.forEachChild(node, visit);
  }
  visit(emitter);
}
const registry = parsed.statements.find(node => ts.isVariableStatement(node) && node.getText(parsed).includes('__swInspectorJobs_'));
assert.ok(registry);
const extracted = [registry, ...selected].map(node => node.getText(parsed)).join('\n');
const emitters = runInNewContext(`${extracted}; ({ start: ${start.name.text}, poll: ${poll.name.text} })`, { crypto });
const events = new EventTarget();
let names = ['</script>\u2028\u2029'];
const deleted = [];
const realm = { crypto, navigator: {}, location: { origin: 'https://fixture.test', href: 'https://fixture.test/' },
  setTimeout: () => 0, clearTimeout: () => {}, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), effects: 0, caches: { keys: async () => [...names], delete: async name => { deleted.push(name); realm.effects++; return true; } } };
let sequence = 0;
async function run(command) {
  const id = `compiled-${++sequence}`;
  const production = emitters.start(command, id);
  assert.ok(production.includes('const handlers = '));
  assert.ok(!production.includes('globalThis.effects'));
  assert.ok(!production.includes('</script>') && !production.includes('\u2028') && !production.includes('\u2029'));
  assert.deepEqual(JSON.parse(runInNewContext(production, realm)), { jobId: id });
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise(resolve => setImmediate(resolve));
    const reply = JSON.parse(runInNewContext(emitters.poll(id), realm));
    if (reply.state !== 'pending') {
      assert.equal(reply.state, 'complete', JSON.stringify(reply));
      return reply.result;
    }
  }
  assert.fail('Compiled job did not settle');
}
const page = (await run({ type: 'page-context' })).value;
assert.deepEqual((await run({ type: 'overview' })).value.page, page);
assert.equal((await run({ type: 'not-a-command' })).error.code, 'invalid-command');
const hostile = '</script>\u2028\u2029';
const prepare = { type: 'prepare-action', expectedPage: page, intent: { kind: 'delete-cache', cacheName: hostile } };
const ticket = (await run(prepare)).value;
assert.deepEqual(ticket.summary, ['Origin: https://fixture.test', `Cache: ${hostile}`, 'Cached responses will be removed. The site may recreate this cache.']);
assert.equal(realm.effects, 0);
const commit = { type: 'commit-action', expectedPage: page, ticketId: ticket.ticketId };
const receipt = await run(commit);
assert.equal(receipt.ok, true);
assert.equal(receipt.value.status, 'completed');
assert.deepEqual(receipt.value.items, [{ target: hostile, outcome: 'applied' }]);
assert.deepEqual(await run(commit), receipt);
assert.equal(realm.effects, 1);
names = ['compiled-alpha', 'compiled-beta'];
const batch = { type: 'prepare-action', expectedPage: page, intent: { kind: 'delete-all-caches' } };
const batchTicket = (await run(batch)).value;
assert.deepEqual(batchTicket.summary, ['Origin: https://fixture.test', 'Caches: 2', ...names, 'Cached responses in these listed caches will be removed. The site may recreate caches.']);
names.push('compiled-new-after-prepare');
const batchCommit = { type: 'commit-action', expectedPage: page, ticketId: batchTicket.ticketId };
const batchReceipt = await run(batchCommit);
assert.equal(batchReceipt.ok, true);
assert.deepEqual(batchReceipt.value.items, [{ target: 'compiled-alpha', outcome: 'applied' }, { target: 'compiled-beta', outcome: 'applied' }]);
assert.deepEqual(await run(batchCommit), batchReceipt);
assert.deepEqual(deleted, [hostile, 'compiled-alpha', 'compiled-beta']);
assert.equal(realm.effects, 3);
names = [];
assert.equal((await run(batch)).error.code, 'cache-not-found');
names = Array.from({ length: 101 }, (_, i) => `compiled-${i}`);
assert.equal((await run(batch)).error.code, 'unsupported');
assert.equal(realm.effects, 3);
// C3 must preserve inspected-document objects across separate compiled jobs.
names = ['compiled-entries'];
const requests = [
  new Request('https://fixture.test/a?v=1', { headers: { 'Accept-Language': 'en' } }),
  new Request('https://fixture.test/a?v=2', { headers: { 'Accept-Language': 'fr' } }),
];
let opened = 0;
const entryDeletes = [];
const retainedCache = {
  keys: async () => requests,
  match: async request => {
    assert.equal(request, requests[1]);
    return new Response('selected body', { headers: { 'Content-Type': 'text/plain' } });
  },
  delete: async (...args) => { entryDeletes.push(args); return true; },
};
realm.TextDecoder = TextDecoder;
realm.caches.open = async name => { assert.equal(name, names[0]); opened++; return retainedCache; };
const inventory = await run({ type: 'list-cache-keys', cacheName: names[0] });
assert.equal(inventory.ok, true);
assert.equal(opened, 1);
const requestKey = inventory.value.entries[1].requestKey;
assert.deepEqual((await run({ type: 'get-response-details', cacheName: names[0], requestKey, preview: true })).value.preview,
  { kind: 'text', text: 'selected body' });
// Fail loudly if prepare/commit reconstruct a Cache instead of using the retained one.
realm.caches.open = async () => { assert.fail('Entry action must not open a cache'); };
const entryTicket = await run({ type: 'prepare-action', expectedPage: page,
  intent: { kind: 'delete-cache-entry', cacheName: names[0], requestKey } });
assert.equal(entryTicket.ok, true);
assert.ok(entryTicket.value.summary.includes('Request: GET https://fixture.test/a?v=2'));
assert.equal(entryDeletes.length, 0);
const entryCommit = { type: 'commit-action', expectedPage: page, ticketId: entryTicket.value.ticketId };
const entryReceipt = await run(entryCommit);
assert.deepEqual(entryReceipt.value.items, [{ target: 'GET https://fixture.test/a?v=2', outcome: 'applied' }]);
assert.deepEqual(await run(entryCommit), entryReceipt);
assert.equal(entryDeletes.length, 1);
assert.equal(entryDeletes[0].length, 1, 'Ordinary match options only');
assert.equal(entryDeletes[0][0], requests[1], 'Exact retained Request');
assert.equal(opened, 1);
assert.equal(realm.effects, 3, 'Entry action must not call CacheStorage.delete');
assert.equal((await run({ type: 'get-response-details', cacheName: names[0], requestKey })).error.code, 'stale-snapshot');
// W4 verifies worker factories from the actual built artifact, without source closures.
names = [];
let updateCalls = 0;
let unregisterCalls = 0;
let firstCalls = 0;
const hostileWorkerURL = 'https://fixture.test/worker.js?value=</script>\u2028\u2029';
const firstRegistration = { scope: 'https://fixture.test/first/', installing: null, waiting: null,
  active: { scriptURL: hostileWorkerURL, state: 'activated' },
  update: async () => { firstCalls++; }, unregister: async () => { firstCalls++; return true; } };
const secondRegistration = { scope: 'https://fixture.test/second/?value=</script>\u2028\u2029', installing: null, waiting: null,
  active: { scriptURL: hostileWorkerURL, state: 'activated' },
  update: async () => { updateCalls++; }, unregister: async () => { unregisterCalls++; return true; } };
realm.navigator.serviceWorker = { controller: firstRegistration.active,
  getRegistrations: async () => [firstRegistration, secondRegistration] };
const workerOverview = await run({ type: 'overview' });
assert.equal(workerOverview.ok, true);
const selectedRegistration = workerOverview.value.registrations[1];
assert.ok(selectedRegistration.registrationId && selectedRegistration.active.workerId);
assert.notEqual(selectedRegistration.registrationId, workerOverview.value.registrations[0].registrationId);
assert.notEqual(selectedRegistration.active.workerId, workerOverview.value.registrations[0].active.workerId);
for (const kind of ['update-worker', 'unregister-worker']) {
  const prepared = await run({ type: 'prepare-action', expectedPage: page,
    intent: { kind, registrationId: selectedRegistration.registrationId } });
  assert.equal(prepared.ok, true);
  assert.ok(prepared.value.summary.includes(secondRegistration.scope));
  assert.equal(kind === 'update-worker' ? updateCalls : unregisterCalls, 0, 'Prepare has zero worker effects');
  const workerCommit = { type: 'commit-action', expectedPage: page, ticketId: prepared.value.ticketId };
  const committed = await run(workerCommit);
  assert.equal(committed.ok, true);
  assert.equal(committed.value.items[0].outcome, 'applied');
  assert.equal(committed.value.items[0].target, secondRegistration.scope);
  assert.deepEqual(await run(workerCommit), committed);
  assert.equal(kind === 'update-worker' ? updateCalls : unregisterCalls, 1, 'Duplicate commit has one native effect');
}
assert.equal(firstCalls, 0, 'Equal script URLs must not redirect selection');
assert.equal(realm.navigator.serviceWorker.controller, firstRegistration.active);
assert.equal(realm.effects, 3, 'Worker actions must not delete caches');
const staleWorkerTicket = await run({ type: 'prepare-action', expectedPage: page,
  intent: { kind: 'update-worker', registrationId: selectedRegistration.registrationId } });
assert.equal(staleWorkerTicket.ok, true);
secondRegistration.active = { ...secondRegistration.active };
const staleWorkerCommit = await run({ type: 'commit-action', expectedPage: page, ticketId: staleWorkerTicket.value.ticketId });
assert.equal(staleWorkerCommit.ok, false);
assert.equal(staleWorkerCommit.error.code, 'stale-target');
assert.equal(updateCalls, 1);
// M4 executes the serialized DOM discovery and bounded fetch factory from this artifact.
realm.URL = URL;
realm.AbortController = AbortController;
realm.TextEncoder = TextEncoder;
const manifestElement = { rawHref: './manifest.webmanifest',
  getAttribute(name) { return name === 'href' ? this.rawHref : null; },
  get href() { return new URL(this.rawHref, 'https://fixture.test/').href; },
  crossOrigin: 'use-credentials', referrerPolicy: 'no-referrer' };
realm.document = { querySelectorAll(selector) { assert.equal(selector, 'link[rel~="manifest" i]'); return [manifestElement]; } };
let manifestRequests = 0;
const manifestText = JSON.stringify({name:'Hostile </script>\u2028\u2029',start_url:'../launch',icons:[{src:'./icon.png'}]});
realm.fetch = async (url, options) => {
  manifestRequests++;
  assert.equal(url, 'https://fixture.test/manifest.webmanifest');
  assert.equal(options.mode, 'cors');
  assert.equal(options.credentials, 'include');
  assert.equal(options.redirect, 'follow');
  assert.equal(options.cache, 'default');
  assert.equal(options.referrerPolicy, 'no-referrer');
  const response = new Response(manifestText, {headers:{'content-type':'application/manifest+json'}});
  Object.defineProperty(response, 'url', {value:'https://fixture.test/redirected/final.webmanifest'});
  Object.defineProperty(response, 'redirected', {value:true});
  return response;
};
const discoveredManifest = await run({type:'manifest:discover',expectedPage:page});
assert.equal(discoveredManifest.ok, true);
assert.equal(discoveredManifest.value.linkCount, 1);
assert.equal(discoveredManifest.value.link.href, './manifest.webmanifest');
assert.equal(manifestRequests, 0, 'DOM discovery never fetches');
const loadedManifest = await run({type:'manifest:fetch',expectedPage:page,snapshotId:discoveredManifest.value.snapshotId});
assert.equal(loadedManifest.ok, true);
assert.equal(loadedManifest.value.state, 'loaded');
assert.equal(loadedManifest.value.text, manifestText);
assert.equal(loadedManifest.value.finalURL, 'https://fixture.test/redirected/final.webmanifest');
assert.equal(loadedManifest.value.readBytes, new TextEncoder().encode(manifestText).byteLength);
assert.equal(manifestRequests, 1);
manifestElement.rawHref = '/replacement.webmanifest';
const staleManifest = await run({type:'manifest:fetch',expectedPage:page,snapshotId:discoveredManifest.value.snapshotId});
assert.equal(staleManifest.ok, false);
assert.equal(staleManifest.error.code, 'stale-result');
assert.equal(manifestRequests, 1, 'Changed retained DOM link rejects before a new request');
// S1 proves serialized preview/session factories and opt-in listener cleanup.
const workerEvents = new EventTarget();
const ownedWorkerListeners = new Set();
realm.navigator.serviceWorker.addEventListener = (type, listener) => {
  ownedWorkerListeners.add(listener); workerEvents.addEventListener(type, listener);
};
realm.navigator.serviceWorker.removeEventListener = (type, listener) => {
  ownedWorkerListeners.delete(listener); workerEvents.removeEventListener(type, listener);
};
const messageSession = await run({type:'open-message-session',expectedPage:page});
assert.equal(messageSession.ok, true);
assert.equal(ownedWorkerListeners.size, 0, 'Open alone installs no listener');
const messageSessionId = messageSession.value.sessionId;
const startMessageListener = {type:'start-message-listener',expectedPage:page,sessionId:messageSessionId};
assert.equal((await run(startMessageListener)).ok, true);
const listenerCount = ownedWorkerListeners.size;
assert.ok(listenerCount > 0);
assert.equal((await run(startMessageListener)).ok, true);
assert.equal(ownedWorkerListeners.size, listenerCount, 'Repeated start installs no duplicate listeners');
const incomingMessage = new Event('message');
Object.defineProperty(incomingMessage,'data',{value:{text:'Hostile </script>\u2028\u2029',nested:{ok:true}}});
Object.defineProperty(incomingMessage,'source',{value:{scriptURL:hostileWorkerURL}});
workerEvents.dispatchEvent(incomingMessage);
const messagesRead = await run({type:'read-message-events',expectedPage:page,sessionId:messageSessionId,afterSeq:0});
assert.equal(messagesRead.ok, true);
assert.equal(messagesRead.value.records.length, 1);
assert.equal(messagesRead.value.records[0].direction, 'incoming');
assert.equal(messagesRead.value.records[0].requestId, null);
assert.ok(messagesRead.value.records[0].text.includes('Hostile </script>'));
assert.equal(messagesRead.value.listening, true);
assert.equal((await run({type:'stop-message-session',expectedPage:page,sessionId:messageSessionId})).value.stopped, true);
assert.equal(ownedWorkerListeners.size, 0);
assert.equal((await run({type:'read-message-events',expectedPage:page,sessionId:messageSessionId,afterSeq:0})).error.code, 'stale-target');
// S2 retains exact active/waiting workers and posts the unwrapped JSON value once.
const postedMessages = [];
secondRegistration.active.postMessage = (...args) => { postedMessages.push({slot:'active',args}); };
secondRegistration.waiting = {scriptURL:hostileWorkerURL,state:'installed',postMessage(...args){postedMessages.push({slot:'waiting',args});}};
const sendSession = await run({type:'open-message-session',expectedPage:page});
assert.equal(sendSession.ok, true);
assert.equal(ownedWorkerListeners.size, 0);
for (const [index,slot] of ['active','waiting'].entries()) {
  const overviewForSend = await run({type:'overview'});
  const targetForSend = overviewForSend.value.registrations[1];
  const payload = slot === 'active' ? 'raw </script>\u2028\u2029' : null;
  const sendIntent = {kind:'send-worker-message',sessionId:sendSession.value.sessionId,
    registrationId:targetForSend.registrationId,workerId:targetForSend[slot].workerId,slot,jsonText:JSON.stringify(payload),reply:'none'};
  const sendTicket = await run({type:'prepare-action',expectedPage:page,intent:sendIntent});
  assert.equal(sendTicket.ok, true);
  assert.equal(postedMessages.length,index,'Prepare posts nothing');
  assert.ok(sendTicket.value.summary.includes('This sends data to website code and may change website state.'));
  const sendCommit = {type:'commit-action',expectedPage:page,ticketId:sendTicket.value.ticketId};
  const sendReceipt = await run(sendCommit);
  assert.equal(sendReceipt.ok,true);
  assert.equal(sendReceipt.value.items[0].message,'Message posted. Delivery is not confirmed.');
  assert.deepEqual(await run(sendCommit),sendReceipt);
  assert.equal(postedMessages.length,index+1);
  assert.equal(postedMessages[index].slot,slot);
  assert.equal(postedMessages[index].args.length,1,'No wrapper envelope or port for reply none');
  assert.equal(postedMessages[index].args[0],payload);
}
const postedRows = await run({type:'read-message-events',expectedPage:page,sessionId:sendSession.value.sessionId,afterSeq:0});
assert.equal(postedRows.value.records.length,2);
assert.ok(postedRows.value.records.every(row=>row.direction==='outgoing'&&row.status==='posted'));
const staleSendOverview = (await run({type:'overview'})).value.registrations[1];
const staleSendTicket = await run({type:'prepare-action',expectedPage:page,intent:{kind:'send-worker-message',
  sessionId:sendSession.value.sessionId,registrationId:staleSendOverview.registrationId,
  workerId:staleSendOverview.active.workerId,slot:'active',jsonText:'{}',reply:'none'}});
assert.equal(staleSendTicket.ok,true);
secondRegistration.active = {...secondRegistration.active};
const staleSendResult = await run({type:'commit-action',expectedPage:page,ticketId:staleSendTicket.value.ticketId});
assert.equal(staleSendResult.error.code,'stale-target');
assert.equal(postedMessages.length,2,'Same-URL replaced worker is never posted');
assert.equal((await run({type:'stop-message-session',expectedPage:page,sessionId:sendSession.value.sessionId})).value.stopped,true);
// S3 uses a real MessageChannel primitive around the compiled reply factory.
const constructedChannels = [];
realm.MessagePort = MessagePort;
realm.MessageChannel = function () {
  const channel = new MessageChannel();
  const tracked = {channel,port1Closes:0};
  const close = channel.port1.close.bind(channel.port1);
  channel.port1.close = () => {tracked.port1Closes++;close();};
  constructedChannels.push(tracked);
  return channel;
};
let portPosts = 0;
secondRegistration.active.postMessage = (value,ports) => {
  portPosts++;
  assert.equal(value,17,'Port reply uses the original primitive payload');
  assert.equal(ports.length,1);
  assert.ok(ports[0] instanceof MessagePort);
  ports[0].postMessage({reply:'first',value});
  ports[0].postMessage({reply:'duplicate',value});
  ports[0].close(); // The receiving mock owns this transferred side.
};
const portOverview = (await run({type:'overview'})).value.registrations[1];
const portSession = (await run({type:'open-message-session',expectedPage:page})).value;
await run({type:'start-message-listener',expectedPage:page,sessionId:portSession.sessionId});
const portTicket = await run({type:'prepare-action',expectedPage:page,intent:{kind:'send-worker-message',
  sessionId:portSession.sessionId,registrationId:portOverview.registrationId,workerId:portOverview.active.workerId,
  slot:'active',jsonText:'17',reply:'port'}});
assert.equal(portTicket.ok,true);
const portCommit = {type:'commit-action',expectedPage:page,ticketId:portTicket.value.ticketId};
const portReceipt = await run(portCommit);
assert.equal(portReceipt.ok,true);
assert.deepEqual(await run(portCommit),portReceipt);
assert.equal(portPosts,1);
let portRows;
for(let attempt=0;attempt<10;attempt++) {
  portRows=(await run({type:'read-message-events',expectedPage:page,sessionId:portSession.sessionId,afterSeq:0})).value.records;
  if(portRows.some(row=>row.direction==='reply'))break;
  await new Promise(resolve=>setImmediate(resolve));
}
const outgoingPortRow=portRows.find(row=>row.direction==='outgoing');
const replyPortRows=portRows.filter(row=>row.direction==='reply');
assert.equal(replyPortRows.length,1,'Only the first owned-port reply is recorded');
assert.equal(replyPortRows[0].requestId,outgoingPortRow.requestId);
assert.ok(replyPortRows[0].text.includes('first'));
assert.ok(constructedChannels[0].port1Closes>=1,'Owned local port closes after terminal reply');
const unrelatedMessage=new Event('message');
Object.defineProperty(unrelatedMessage,'data',{value:{requestId:outgoingPortRow.requestId,reply:'ordinary client message'}});
Object.defineProperty(unrelatedMessage,'source',{value:{scriptURL:hostileWorkerURL}});
workerEvents.dispatchEvent(unrelatedMessage);
const finalPortRows=(await run({type:'read-message-events',expectedPage:page,sessionId:portSession.sessionId,afterSeq:0})).value.records;
assert.equal(finalPortRows.find(row=>row.direction==='incoming').requestId,null);
assert.equal((await run({type:'stop-message-session',expectedPage:page,sessionId:portSession.sessionId})).value.stopped,true);
assert.equal(ownedWorkerListeners.size,0);
console.log(`PASS ${filename}: compiled C/W/M/S1/S2 contracts, S3 raw port transfer once, first reply correlation/duplicate suppression, local-port cleanup and uncorrelated container messages`);
