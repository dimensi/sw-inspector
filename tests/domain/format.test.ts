import { describe, expect, it } from 'vitest';
import { formatBytes, formatStoragePercentage } from '../../src/domain/format';

describe('diagnostic formatting', () => {
  it('formats byte values without treating missing values as zero', () => {
    expect(formatBytes(null)).toBe('Unknown');
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KiB');
  });

  it('only renders a storage percentage when both inputs are usable', () => {
    expect(formatStoragePercentage(null, 100)).toBe('Unknown');
    expect(formatStoragePercentage(5, null)).toBe('Unknown');
    expect(formatStoragePercentage(5, 0)).toBe('Unknown');
    expect(formatStoragePercentage(5, 20)).toBe('25%');
  });
});
