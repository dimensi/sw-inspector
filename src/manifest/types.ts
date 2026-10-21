import type { PageIdentity } from '../domain/types';

export type ManifestCommand =
  | { type: 'manifest:discover'; expectedPage: PageIdentity }
  | { type: 'manifest:fetch'; expectedPage: PageIdentity; snapshotId: string };
export type ManifestLink = {
  href: string | null; url: string | null; crossOrigin: string | null;
  referrerPolicy: string; issue: 'missing-href' | 'empty-href' | 'invalid-url' | 'unsupported-url' | null;
};
export type ManifestDiscovery = { page: PageIdentity; snapshotId: string | null; linkCount: number; link: ManifestLink | null };
export type ManifestFetch = {
  page: PageIdentity; snapshotId: string; requestedURL: string; finalURL: string | null;
  status: number | null; contentType: string | null; redirected: boolean | null; readBytes: number | null;
} & ({ state: 'loaded'; finalURL: string; text: string } | {
  state: 'failed'; reason: 'http-error' | 'network-error' | 'unreadable' | 'timeout' | 'too-large'; message: string;
});
export type ManifestDiagnostic = { code: string; path: string; severity: 'error' | 'warning' | 'info'; message: string };
export type ManifestField = { key: string; declared: unknown; resolved: string | null; source: 'declared' | 'fallback' | 'unavailable' };
export type ManifestIcon = { index: number; src: string | null; resolvedURL: string | null; sizes: string | null; type: string | null; purpose: string | null };
export type ManifestAnalysis = { state: 'parsed' | 'invalid-json' | 'invalid-root'; fields: ManifestField[]; icons: ManifestIcon[]; diagnostics: ManifestDiagnostic[] };
export type ManifestParseInput = { documentURL: string; manifestURL: string; contentType: string | null; text: string };
