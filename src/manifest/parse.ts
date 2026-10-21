import type { ManifestAnalysis, ManifestDiagnostic, ManifestField, ManifestIcon, ManifestParseInput } from './types';

// These are Inspector reconstructions from declared JSON, not Safari's processed manifest.
export function parseManifest(input: ManifestParseInput): ManifestAnalysis {
  const diagnostics: ManifestDiagnostic[] = [];
  function issue(code: string, path: string, message: string, severity: ManifestDiagnostic['severity'] = 'warning') {
    diagnostics.push({ code, path, severity, message });
  }
  function url(value: string, base?: string): URL | null {
    try { return new URL(value, base); } catch { return null; }
  }
  const documentURL = url(input.documentURL);
  const manifestURL = url(input.manifestURL);
  if (!documentURL) issue('document-url', 'documentURL', 'The document URL cannot be resolved.', 'error');
  if (!manifestURL) issue('manifest-url', 'manifestURL', 'The manifest response URL cannot be resolved.', 'error');
  const mime = input.contentType?.split(';')[0].trim().toLowerCase() ?? '';
  if (!/^application\/(?:[\w!#$&^_.+-]+\+)?json$/.test(mime)) {
    issue('json-mime', 'contentType', 'The response did not declare a JSON MIME type.');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(input.text.charCodeAt(0) === 0xfeff ? input.text.slice(1) : input.text); }
  catch {
    issue('invalid-json', '', 'The manifest source is not valid JSON.', 'error');
    return { state: 'invalid-json', fields: [], icons: [], diagnostics };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    issue('invalid-root', '', 'The manifest root must be a JSON object.', 'error');
    return { state: 'invalid-root', fields: [], icons: [], diagnostics };
  }
  const root = parsed as Record<string, unknown>;
  const fields: ManifestField[] = [];
  let startURL: URL | null = documentURL;
  for (const key of ['name', 'short_name', 'id', 'start_url', 'scope', 'display', 'orientation', 'theme_color', 'background_color']) {
    const exists = Object.hasOwn(root, key);
    const declared = exists ? root[key] : undefined;
    const text = typeof declared === 'string' ? declared : null;
    if (exists && text === null) issue('field-type', key, 'Expected a string declaration.');
    const field: ManifestField = { key, declared, resolved: null, source: text === null ? 'unavailable' : 'declared' };
    if (key === 'start_url') {
      const candidate = text?.trim() && manifestURL ? url(text, manifestURL.href) : null;
      if (candidate && documentURL && candidate.origin === documentURL.origin) {
        startURL = candidate;
        field.resolved = candidate.href;
      } else {
        startURL = documentURL;
        field.resolved = documentURL?.href ?? null;
        field.source = documentURL ? 'fallback' : 'unavailable';
        if (text !== null) issue('start-url-fallback', key, 'Using the document URL because start_url is empty, invalid, or cross-origin.');
      }
    } else if (key === 'scope') {
      const fallback = startURL ? url('.', startURL.href) : null;
      const candidate = text !== null && manifestURL ? url(text, manifestURL.href) : null;
      if (candidate) { candidate.search = ''; candidate.hash = ''; }
      if (candidate && startURL && candidate.origin === startURL.origin && startURL.pathname.startsWith(candidate.pathname)) {
        field.resolved = candidate.href;
      } else {
        field.resolved = fallback?.href ?? null;
        field.source = fallback ? 'fallback' : 'unavailable';
        if (text !== null) issue('scope-fallback', key, 'Using the start URL directory because scope is invalid or does not contain start_url.');
      }
    }
    fields.push(field);
  }
  const icons: ManifestIcon[] = [];
  if (Object.hasOwn(root, 'icons')) {
    if (!Array.isArray(root.icons)) issue('field-type', 'icons', 'Expected an array of icon declarations.');
    else {
      for (const [index, entry] of root.icons.slice(0, 128).entries()) {
        const path = `icons[${index}]`;
        const icon: ManifestIcon = { index, src: null, resolvedURL: null, sizes: null, type: null, purpose: null };
        icons.push(icon);
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          issue('icon-entry', path, 'Expected an icon object.');
          continue;
        }
        const record = entry as Record<string, unknown>;
        for (const member of ['src', 'sizes', 'type', 'purpose'] as const) {
          if (typeof record[member] === 'string') icon[member] = record[member];
          else if (member === 'src' || Object.hasOwn(record, member)) issue('icon-type', `${path}.${member}`, 'Expected a string declaration.');
          if (member === 'src' && icon.src !== null && manifestURL) {
            const resolved = url(icon.src, manifestURL.href);
            icon.resolvedURL = resolved?.href ?? null;
            if (!resolved) issue('icon-url', `${path}.src`, 'The icon source URL cannot be resolved.');
          }
        }
      }
      if (root.icons.length > 128) issue('icons-truncated', 'icons', `${root.icons.length - 128} icon declarations omitted; showing the first 128.`);
    }
  }
  return { state: 'parsed', fields, icons, diagnostics };
}
