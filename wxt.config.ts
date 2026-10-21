import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  manifest: ({ browser }) => ({
    name: 'SW Inspector',
    description: 'Inspect workers, caches and Web App Manifests; explicitly load manifests, manage workers, send JSON and delete cache data.',
    version: '0.1.1',
    permissions: ['devtools', 'activeTab'],
    icons: {
      16: '/icons/16.png',
      32: '/icons/32.png',
      48: '/icons/48.png',
      128: '/icons/128.png',
    },
    action: {
      default_title: 'SW Inspector',
      default_icon: browser === 'safari' ? '/icons/toolbar.svg' : {
        16: '/icons/toolbar-16.png',
        19: '/icons/toolbar-19.png',
        32: '/icons/toolbar-32.png',
        38: '/icons/toolbar-38.png',
      },
    },
  }),
});
