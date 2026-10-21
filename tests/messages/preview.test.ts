import { describe, expect, it, vi } from 'vitest';
import { formatMessagePreview } from '../../src/messages/preview';
const bytes = (text: string) => new TextEncoder().encode(text).byteLength;

describe('bounded message preview', () => {
  it.each([null, true, false, 3, 'text', { a: [1, null, 'x'] }])('shows JSON-safe value %s as JSON', value => {
    expect(formatMessagePreview(value)).toEqual({ text: JSON.stringify(value), truncated: false });
  });
  it('respects exact UTF-8 boundary with emoji and truncates without broken surrogates', () => {
    const exact = '😀'.repeat(4095) + 'aa';
    const result = formatMessagePreview(exact);
    expect(bytes(result.text)).toBe(16384); expect(result.truncated).toBe(false);
    const large = formatMessagePreview('😀'.repeat(4096));
    expect(bytes(large.text)).toBeLessThanOrEqual(16384); expect(large.truncated).toBe(true);
    expect(large.text).not.toContain('�');
  });
  it('bounds a 10 MiB string before any full stringify and escapes script text', () => {
    const spy = vi.spyOn(JSON, 'stringify').mockImplementation(() => { throw new Error('whole stringify forbidden'); });
    try { const result = formatMessagePreview('x'.repeat(10 * 1024 * 1024)); expect(bytes(result.text)).toBeLessThanOrEqual(16384); expect(result.truncated).toBe(true); }
    finally { spy.mockRestore(); }
    expect(formatMessagePreview('</script><img src=x>')).toEqual({ text: '"</script><img src=x>"', truncated: false });
  });
  it('does not call getters, constructor/toJSON or Symbol.toStringTag hooks', () => {
    const getter = vi.fn(() => { throw new Error('getter invoked'); });
    const toJSON = vi.fn(() => { throw new Error('toJSON invoked'); });
    const value = Object.defineProperties({ toJSON }, { secret: { enumerable: true, get: getter }, constructor: { enumerable: true, get: getter }, [Symbol.toStringTag]: { get: getter } });
    const result = formatMessagePreview(value);
    expect(result.text).toContain('[Getter]');
    expect(getter).not.toHaveBeenCalled(); expect(toJSON).not.toHaveBeenCalled();
  });
  it('bounds depth and visited nodes and marks cycles', () => {
    const cycle: { self?: unknown } = {}; cycle.self = cycle;
    expect(formatMessagePreview(cycle).text).toContain('[Circular]');
    let deep: unknown = 1; for (let i = 0; i < 8; i++) deep = [deep];
    expect(formatMessagePreview(deep).truncated).toBe(true);
    const many = formatMessagePreview(Array.from({ length: 2000 }, () => 0));
    expect(many.truncated).toBe(true); expect(bytes(many.text)).toBeLessThanOrEqual(16384);
  });
  it('summarizes binary and collection metadata without reading bytes or ports', () => {
    const blob = new Blob(['secret']); const read = vi.spyOn(blob, 'arrayBuffer');
    const close = vi.fn(); const port = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
    try {
      if (port) Object.defineProperty(port.port1, 'close', { value: close });
      const result = formatMessagePreview({ big: 3n, date: new Date('2026-10-21T00:00:00Z'), map: new Map([['a', 1]]), set: new Set([1]), blob, buffer: new ArrayBuffer(32), view: new Uint8Array(4), port: port?.port1 });
      for (const type of ['BigInt', 'Date', 'Map', 'Set', 'Blob', 'ArrayBuffer', 'view']) expect(result.text).toContain(type);
      expect(result.text).toContain('32 bytes'); expect(result.text).toContain('6 bytes');
      expect(read).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
    } finally { if (port) { MessagePort.prototype.close.call(port.port1); port.port2.close(); } }
  });
  it('does not bulk-enumerate huge objects before traversal bounds', () => {
    const value = Object.fromEntries(Array.from({ length: 10000 }, (_, index) => ['key' + index, index]));
    const keys = vi.spyOn(Object, 'keys').mockImplementation(() => { throw Error('bulk keys forbidden'); });
    const descriptors = vi.spyOn(Object, 'getOwnPropertyDescriptors').mockImplementation(() => { throw Error('bulk descriptors forbidden'); });
    let result;
    try { result = formatMessagePreview(value); }
    finally { keys.mockRestore(); descriptors.mockRestore(); }
    expect(result.truncated).toBe(true);
  });
});
