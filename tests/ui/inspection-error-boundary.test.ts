import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('panel inspection error boundary', () => {
  it('keeps origin inspection failures separate from tool-local failures', async () => {
    const source = await readFile(new URL('../../entrypoints/panel/App.svelte', import.meta.url), 'utf8');

    expect(source).toContain('let inspectionError = $state<string | null>(null);');
    expect(source).toContain("type OperationArea = 'cache' | 'details' | 'measure' | 'offline';");
    expect(source).toContain('let operationError = $state<{ area: OperationArea; message: string } | null>(null);');
    expect(source).toContain('deriveInspectionStatus(overview, loading, inspectionError)');
    expect(source).toContain("operationError = { area: 'cache', message: result.error.message };");
    expect(source).toContain("operationError = { area: 'details', message: result.error.message };");
    expect(source).toContain("operationError = { area: 'measure', message: result.error.message };");
    expect(source).toContain("operationError = { area: 'offline', message: result.error.message };");
  });
});
