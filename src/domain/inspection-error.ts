export function describeInspectionError(error: string): {
  title: string;
  message: string;
  technicalDetails: string | null;
} {
  // This is the observed Safari tab-access error, not a general eval diagnosis.
  if (error.includes('does not have access')) {
    return {
      title: 'Allow access to this tab',
      message: 'Click SW Inspector in Safari’s toolbar on this tab, then click Refresh.',
      technicalDetails: error,
    };
  }
  return { title: 'Inspection failed', message: error, technicalDetails: null };
}
