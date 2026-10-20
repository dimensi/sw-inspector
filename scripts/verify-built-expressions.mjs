// Run after pnpm build:safari. Uses exact AST node text from the generated artifact;
// it does not transpile/rebundle source modules or provide their closures.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

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
  setTimeout: () => 0, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), effects: 0, caches: { keys: async () => [...names], delete: async name => { deleted.push(name); realm.effects++; return true; } } };
let sequence = 0;
async function run(command) {
  const id = `compiled-${++sequence}`;
  const production = emitters.start(command, id);
  assert.ok(production.includes('const handlers = ('));
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
console.log(`PASS ${filename}: compiled start/poll, context/overview, C1 hostile-name prepare/commit, C2 fixed names/new-name exclusion, empty/101 rejection, C3 inventory/preview/prepare/commit retained Cache+Request and invalidation, duplicate commits execute once`);
