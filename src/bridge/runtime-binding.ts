export type DevToolsNamespace = {
  runtime?: { id?: unknown };
  devtools?: { inspectedWindow?: { eval?: unknown } };
};

export type DevToolsBinding = {
  selectedNamespace: 'browser' | 'chrome' | 'other';
  browserRuntimeId: boolean;
  browserHasInspectedWindowEval: boolean;
  chromeRuntimeId: boolean;
  chromeHasInspectedWindowEval: boolean;
};

export function describeDevToolsBinding(
  selected: unknown,
  namespaces: { browser?: DevToolsNamespace; chrome?: DevToolsNamespace },
): DevToolsBinding {
  const { browser, chrome } = namespaces;
  return {
    selectedNamespace: selected === browser ? 'browser' : selected === chrome ? 'chrome' : 'other',
    browserRuntimeId: Boolean(browser?.runtime?.id),
    browserHasInspectedWindowEval: typeof browser?.devtools?.inspectedWindow?.eval === 'function',
    chromeRuntimeId: Boolean(chrome?.runtime?.id),
    chromeHasInspectedWindowEval: typeof chrome?.devtools?.inspectedWindow?.eval === 'function',
  };
}
