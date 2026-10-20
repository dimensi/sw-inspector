import { describe, expect, it } from 'vitest';
import { describeInspectionError } from '../../src/domain/inspection-error';

describe('inspection error presentation', () => {
  it('leads a recognized Safari tab-access denial with the recovery action', () => {
    const message = 'Extension does not have access to the current tab';
    expect(describeInspectionError(message)).toEqual({
      title: 'Allow access to this tab',
      message: 'Click SW Inspector in Safari’s toolbar on this tab, then click Refresh.',
      technicalDetails: message,
    });
  });

  it.each([
    'inspectedWindow.eval is unavailable',
    'DevToolsInspectedWindowEval fails validation',
    'The devtools evaluation relay timed out',
    'Safari denied access',
    'Cache Storage is unavailable in this page context',
  ])('does not turn an ambiguous or non-permission failure into a grant instruction: %s', message => {
    expect(describeInspectionError(message)).toEqual({ title: 'Inspection failed', message, technicalDetails: null });
  });
});
