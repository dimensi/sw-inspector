<script lang="ts">
  let { name, size = 14 }: { name: keyof typeof paths; size?: number } = $props();

  const paths = {
    refresh: 'M12.2 6A5 5 0 1 0 13 9M12.2 2.5V6H8.7',
    export: 'M8 10V2m-3 3 3-3 3 3M3 9v4h10V9',
    worker: 'M5 2v2m6-2v2M5 12v2m6-2v2M2 5h2m8 0h2M2 11h2m8 0h2M4 4h8v8H4zM6.5 6.5h3v3h-3z',
    database: 'M13 4c0 1.1-2.2 2-5 2S3 5.1 3 4s2.2-2 5-2 5 .9 5 2ZM3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2',
    file: 'M4 1.5h5l3 3v10H4zM9 1.5v3h3M6 8h4M6 10.5h4',
    search: 'M10.5 10.5 14 14M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z',
    chevron: 'm5.5 3 5 5-5 5',
    check: 'm3 8 3 3 7-7',
    warning: 'M8 2 1.5 13h13ZM8 6v3M8 11v.1',
    diagnostics: 'M2 4h12M2 8h12M2 12h12M5 2v4M11 6v4M6 10v4',
    close: 'm4 4 8 8M12 4l-8 8',
  };
</script>

<svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d={paths[name]} />
</svg>

<style>
  svg { flex: none; vertical-align: middle; }
</style>
