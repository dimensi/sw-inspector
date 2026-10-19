import { describe, expect, it } from 'vitest';
import { describeDevToolsBinding } from '../../src/bridge/runtime-binding';

describe('DevTools runtime binding diagnostics', () => {
  it('reports when the imported API is Chrome even though native Browser exposes inspected-window eval', () => {
    const browser = {
      runtime: { id: undefined },
      devtools: { inspectedWindow: { eval: () => undefined } },
    };
    const chrome = {
      runtime: { id: 'extension-id' },
      devtools: { inspectedWindow: { eval: () => undefined } },
    };

    expect(describeDevToolsBinding(chrome, { browser, chrome })).toEqual({
      selectedNamespace: 'chrome',
      browserRuntimeId: false,
      browserHasInspectedWindowEval: true,
      chromeRuntimeId: true,
      chromeHasInspectedWindowEval: true,
    });
  });
});
