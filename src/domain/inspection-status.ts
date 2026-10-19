import type { Overview } from './types';

export type InspectionStatus = {
  tone: 'idle' | 'loading' | 'attention' | 'healthy';
  title: string;
  detail: string;
  action: string;
};

export function deriveInspectionStatus(
  overview: Overview | null,
  loading: boolean,
  error: string | null,
): InspectionStatus {
  if (loading) {
    return { tone: 'loading', title: 'Inspecting origin', detail: 'Reading Service Worker and storage metadata.', action: 'Inspecting…' };
  }

  if (error) {
    return { tone: 'attention', title: 'Inspection needs attention', detail: error, action: 'Try inspection again' };
  }

  if (!overview) {
    return { tone: 'idle', title: 'Ready to inspect', detail: 'Run a read-only scan of the current origin.', action: 'Run inspection' };
  }

  if (!overview.controller) {
    return {
      tone: 'attention',
      title: 'No active controller',
      detail: overview.registrations.length
        ? 'A registration exists, but this page is not controlled by an active Service Worker.'
        : 'No Service Worker registration is visible for this origin.',
      action: 'Inspect again',
    };
  }

  return {
    tone: 'healthy',
    title: 'Origin is controlled',
    detail: `${overview.caches.length} cache ${overview.caches.length === 1 ? 'namespace' : 'namespaces'} visible to this page.`,
    action: 'Inspect again',
  };
}
