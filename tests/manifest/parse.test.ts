import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseManifest } from '../../src/manifest/parse';

const input = { documentURL: 'https://app.test/current/page?d=1#old', manifestURL: 'https://app.test/assets/m.json', contentType: 'application/manifest+json', text: '{}' };
function parse(value: unknown, overrides: Partial<typeof input> = {}) { return parseManifest({ ...input, ...overrides, text: JSON.stringify(value) }); }
function field(result: ReturnType<typeof parseManifest>, key: string) { return result.fields.find(row => row.key === key)!; }
beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe('manifest parser', () => {
  it.each([null, [], 1, true, 'text'])('rejects JSON root shape %s without derived values', value => {
    expect(parse(value)).toMatchObject({ state: 'invalid-root', fields: [], icons: [] });
  });
  it('accepts one leading BOM and distinguishes bad JSON from an empty object', () => {
    expect(parseManifest({ ...input, text: '\uFEFF{}' }).state).toBe('parsed');
    expect(parseManifest({ ...input, text: '{' })).toMatchObject({ state: 'invalid-json', fields: [], icons: [] });
    expect(parse({}).state).toBe('parsed');
  });
  it('pins manifest response base, document fallback and default scope rules', () => {
    const result = parse({ start_url: '../launch?x=1#h' });
    expect(field(result, 'start_url')).toMatchObject({ declared: '../launch?x=1#h', resolved: 'https://app.test/launch?x=1#h', source: 'declared' });
    expect(field(result, 'scope')).toMatchObject({ resolved: 'https://app.test/', source: 'fallback' });
    const redirected = parse({ start_url: '../launch' }, { manifestURL: 'https://app.test/redirect/deeper/final.json' });
    expect(field(redirected, 'start_url').resolved).toBe('https://app.test/redirect/launch');
  });
  it.each([undefined, '', '   ', 'http://[', 'https://foreign.test/start', 42])('falls back start_url %s to document URL', start_url => {
    const result = parse(start_url === undefined ? {} : { start_url });
    expect(field(result, 'start_url')).toMatchObject({ resolved: input.documentURL, source: 'fallback' });
    expect(field(result, 'scope').resolved).toBe('https://app.test/current/');
  });
  it('resolves scope from manifest response URL, strips query/hash, and uses pathname prefix', () => {
    expect(field(parse({ start_url: '../application?x=1#h', scope: '../app?q=1#h' }), 'scope')).toMatchObject({ resolved: 'https://app.test/app', source: 'declared' });
    expect(field(parse({ start_url: '/assets/start', scope: './?q=1#h' }), 'scope').resolved).toBe('https://app.test/assets/');
  });
  it.each(['https://foreign.test/', '/other/', 'http://[', 42])('falls back invalid scope %s to start directory', scope => {
    expect(field(parse({ start_url: '/app/start?x#h', scope }), 'scope')).toMatchObject({ resolved: 'https://app.test/app/', source: 'fallback' });
  });
  it('preserves declared-only strings without computing browser identity, color or display support', () => {
    const declared = { name: '  App  ', short_name: '', id: '../id', display: 'future-display', orientation: 'future-orientation', theme_color: 'not-a-color', background_color: 'color(display-p3 1 0 0)' };
    const result = parse(declared);
    for (const [key, value] of Object.entries(declared)) expect(field(result, key)).toEqual({ key, declared: value, resolved: null, source: 'declared' });
    expect(result.diagnostics).toEqual([]);
    expect(result.fields.map(row => row.key)).toEqual(['name', 'short_name', 'id', 'start_url', 'scope', 'display', 'orientation', 'theme_color', 'background_color']);
  });
  it('does not coerce malformed fields and orders diagnostics by field order', () => {
    const result = parse({ background_color: 0, orientation: {}, display: [], scope: false, start_url: 1, id: 7, short_name: null, name: {} });
    expect(field(result, 'name')).toMatchObject({ declared: {}, resolved: null, source: 'unavailable' });
    expect(result.diagnostics.map(row => row.path)).toEqual(['name', 'short_name', 'id', 'start_url', 'scope', 'display', 'orientation', 'background_color']);
    expect(result.diagnostics.every(row => row.code === 'field-type')).toBe(true);
    expect(parse({ custom_member: true }).diagnostics).toEqual([]);
  });
  it('preserves icon source indices and duplicate resolved URLs without requests', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const result = parse({ icons: [{ src: '../icon.png', sizes: 'any', type: 'image/custom', purpose: 'maskable future', unknown: true }, null, { src: '../icon.png' }, { src: 3 }] });
    expect(result.icons.map(row => row.index)).toEqual([0, 1, 2, 3]);
    expect(result.icons[0]).toEqual({ index: 0, src: '../icon.png', resolvedURL: 'https://app.test/icon.png', sizes: 'any', type: 'image/custom', purpose: 'maskable future' });
    expect(result.icons[2].resolvedURL).toBe(result.icons[0].resolvedURL);
    expect(result.diagnostics.map(row => row.path)).toEqual(['icons[1]', 'icons[3].src']);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('bounds icon rows at 128 and reports the omitted count', () => {
    const result = parse({ icons: Array.from({ length: 130 }, () => ({ src: 'icon.png' })) });
    expect(result.icons).toHaveLength(128);
    expect(result.icons[127].index).toBe(127);
    expect(result.diagnostics).toContainEqual({ code: 'icons-truncated', path: 'icons', severity: 'warning', message: '2 icon declarations omitted; showing the first 128.' });
  });
  it('reports malformed icon member paths without coercion or universal size requirements', () => {
    const result = parse({ icons: [{ src: 'http://[', sizes: 192, type: [], purpose: false }, { sizes: '16x16' }] });
    expect(result.diagnostics.map(row => row.path)).toEqual(['icons[0].src', 'icons[0].sizes', 'icons[0].type', 'icons[0].purpose', 'icons[1].src']);
    expect(result.icons[0]).toMatchObject({ src: 'http://[', resolvedURL: null, sizes: null, type: null, purpose: null });
    expect(parse({ icons: [{ src: 'icon.png', sizes: '16x16' }] }).diagnostics).toEqual([]);
    expect(parse({ icons: {} }).diagnostics).toMatchObject([{ path: 'icons' }]);
  });
  it.each([null, 'text/plain', 'text/html'])('warns about MIME %s before field/icon diagnostics', contentType => {
    const result = parseManifest({ ...input, contentType, text: JSON.stringify({ name: 3, icons: [null] }) });
    expect(result.state).toBe('parsed');
    expect(result.diagnostics.map(row => row.path)).toEqual(['contentType', 'name', 'icons[0]']);
    expect(result.diagnostics[0].code).toBe('json-mime');
  });
  it.each(['application/json; charset=utf-8', 'APPLICATION/MANIFEST+JSON', 'application/ld+json'])('accepts JSON MIME %s', contentType => {
    expect(parse({}, { contentType }).diagnostics).toEqual([]);
  });
  it('treats hostile text as declarations and never touches network/DOM/extension globals', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const hostile = '</script><img src=x onerror=globalThis.injected=true>';
    const result = parse({ name: hostile, icons: [{ src: 'data:image/svg+xml,<svg/>' }] });
    expect(field(result, 'name').declared).toBe(hostile);
    expect(result.icons[0].src).toBe('data:image/svg+xml,<svg/>');
    expect(fetch).not.toHaveBeenCalled();
    expect(globalThis).not.toHaveProperty('injected');
  });
});
