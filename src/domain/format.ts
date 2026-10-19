export function formatBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return 'Unknown';
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MiB`;
  return `${(value / 1024 ** 3).toFixed(1)} GiB`;
}

export function formatStoragePercentage(usageBytes: number | null, quotaBytes: number | null): string {
  if (usageBytes === null || quotaBytes === null || quotaBytes <= 0) return 'Unknown';
  return `${Math.round((usageBytes / quotaBytes) * 100)}%`;
}
