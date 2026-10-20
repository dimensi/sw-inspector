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
const realm = { crypto, navigator: {}, location: { origin: 'https://fixture.test', href: 'https://fixture.test/' },
  setTimeout: () => 0, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), effects: 0, caches: { keys: async () => ['</script>\u2028\u2029'], delete: async () => { realm.effects++; return true; } } };
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
assert.equal((await run({ ...prepare, intent: { kind: 'delete-all-caches' } })).error.code, 'unsupported');
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
console.log(`PASS ${filename}: compiled start/poll, context/overview, unsupported batch action, real C1 hostile-name prepare/commit, duplicate executes once`);
