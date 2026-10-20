import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPageContext } from '../../src/bridge/page-context';

function realm() {
  const events = new EventTarget();
  const location = { origin: 'https://app.test', href: 'https://app.test/path#one' };
  const factory = runInNewContext(`(${createPageContext.toString()})`, {
    crypto, location, addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  }) as typeof createPageContext;
  return { factory, events, location };
}

afterEach(() => vi.unstubAllGlobals());
describe('page context', () => {
  it('same_document_reuses_identity_but_fresh_realm_does_not', () => {
    const first = realm();
    const context = first.factory('inspector-one');
    expect(first.factory('inspector-one')).toBe(context);
    expect(first.factory('inspector-two').identity().documentId).not.toBe(context.identity().documentId);
    expect(realm().factory('inspector-one').identity().documentId).not.toBe(context.identity().documentId);
  });
  it('pagehide_disposes_once_and_bfcache_does_not_restore_handles', () => {
    const { factory, events } = realm();
    const context = factory('inspector');
    const expected = context.identity();
    const cleanup = vi.fn();
    context.onDispose(cleanup);
    context.actions.set('ticket', {});
    context.manifests.set('manifest', {});
    context.messages.set('port', {});
    context.registrations.set('registration', {} as never);
    events.dispatchEvent(new Event('pagehide'));
    events.dispatchEvent(new Event('pagehide'));
    expect(cleanup).toHaveBeenCalledOnce();
    for (const registry of [context.actions, context.manifests, context.messages, context.registrations]) expect(registry.size).toBe(0);
    events.dispatchEvent(new Event('pageshow'));
    const restored = factory('inspector');
    expect(restored.identity().documentId).not.toBe(expected.documentId);
    expect(restored.isCurrent(expected)).toBe(false);
    expect(context.isCurrent(expected)).toBe(false);
  });
  it.each(['https://app.test/path#two', 'https://app.test/other#one'])('invalidates a changed SPA URL: %s', (url) => {
    const { factory, location } = realm();
    const context = factory('inspector');
    const expected = context.identity();
    location.href = url;
    expect(context.isCurrent(expected)).toBe(false);
    expect(context.identity().url).toBe(url);
  });
});
