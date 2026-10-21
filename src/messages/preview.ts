// Serialized into the inspected document. Never invoke data getters or toJSON.
export function formatMessagePreview(value: unknown): { text: string; truncated: boolean } {
  const parts: string[] = [];
  let byteCount = 0;
  let truncated = false;
  let full = false;
  let nodes = 0;
  const ancestors = new Set<object>();
  function size(char: string) {
    const point = char.codePointAt(0)!;
    return point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  function append(text: string) {
    if (full) return;
    for (const char of text) {
      const bytes = size(char);
      if (byteCount + bytes > 16384) { truncated = true; full = true; return; }
      parts.push(char); byteCount += bytes;
    }
  }
  function string(text: string) {
    append('"');
    for (let index = 0; index < text.length && !full; index++) {
      const code = text.charCodeAt(index);
      if (code === 34) append('\\"');
      else if (code === 92) append('\\\\');
      else if (code < 32) append('\\u' + code.toString(16).padStart(4, '0'));
      else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) append(text[index] + text[++index]);
      else if (code >= 0xd800 && code <= 0xdfff) append('\\u' + code.toString(16).padStart(4, '0'));
      else append(text[index]);
    }
    append('"');
  }
  function nativeSize(prototype: object, key: string, object: object): number {
    return Object.getOwnPropertyDescriptor(prototype, key)!.get!.call(object) as number;
  }
  function visit(data: unknown, depth: number) {
    if (full) return;
    if (depth > 6 || nodes >= 1000) { truncated = true; string(depth > 6 ? '[Depth limit]' : '[Node limit]'); return; }
    nodes += 1;
    if (data === null) { append('null'); return; }
    if (typeof data === 'string') { string(data); return; }
    if (typeof data === 'number') { if (Number.isFinite(data)) append(String(data)); else string('[Non-finite number]'); return; }
    if (typeof data === 'boolean') { append(data ? 'true' : 'false'); return; }
    if (typeof data !== 'object') { string(typeof data === 'bigint' ? '[BigInt]' : typeof data === 'undefined' ? '[Undefined]' : typeof data === 'symbol' ? '[Symbol]' : '[Function]'); return; }
    if (ancestors.has(data)) { string('[Circular]'); return; }
    if (data instanceof Date) { const time = Date.prototype.getTime.call(data); string(Number.isNaN(time) ? '[Date: invalid]' : '[Date: ' + Date.prototype.toISOString.call(data) + ']'); return; }
    if (data instanceof Map) { string('[Map: ' + nativeSize(Map.prototype, 'size', data) + ' entries]'); return; }
    if (data instanceof Set) { string('[Set: ' + nativeSize(Set.prototype, 'size', data) + ' entries]'); return; }
    if (typeof Blob !== 'undefined' && data instanceof Blob) { string('[Blob: ' + nativeSize(Blob.prototype, 'size', data) + ' bytes]'); return; }
    if (data instanceof ArrayBuffer) { string('[ArrayBuffer: ' + nativeSize(ArrayBuffer.prototype, 'byteLength', data) + ' bytes]'); return; }
    if (ArrayBuffer.isView(data)) {
      const prototype = data instanceof DataView ? DataView.prototype : Object.getPrototypeOf(Uint8Array.prototype);
      string('[ArrayBuffer view: ' + nativeSize(prototype, 'byteLength', data) + ' bytes]'); return;
    }
    if (typeof MessagePort !== 'undefined' && data instanceof MessagePort) { string('[MessagePort]'); return; }
    ancestors.add(data);
    if (Array.isArray(data)) {
      append('[');
      const length = Object.getOwnPropertyDescriptor(data, 'length')!.value as number;
      for (let index = 0; index < length && !full; index++) {
        if (index) append(',');
        if (nodes >= 1000) { truncated = true; string('[Node limit]'); break; }
        const descriptor = Object.getOwnPropertyDescriptor(data, String(index));
        if (!descriptor) append('null');
        else if ('value' in descriptor) visit(descriptor.value, depth + 1);
        else string('[Getter]');
      }
      append(']');
    } else {
      append('{'); let count = 0; let scanned = 0;
      for (const key in data) {
        if (full) break;
        if (++scanned > 1000 || nodes >= 1000) { truncated = true; break; }
        const descriptor = Object.getOwnPropertyDescriptor(data, key);
        if (!descriptor?.enumerable) continue;
        if (count++) append(',');
        string(key); append(':');
        if ('value' in descriptor) visit(descriptor.value, depth + 1);
        else string('[Getter]');
      }
      append('}');
    }
    ancestors.delete(data);
  }
  try { visit(value, 0); } catch { truncated = true; string('[Uninspectable]'); }
  if (full) {
    while (parts.length && byteCount + 3 > 16384) byteCount -= size(parts.pop()!);
    parts.push('…');
  }
  return { text: parts.join(''), truncated };
}
