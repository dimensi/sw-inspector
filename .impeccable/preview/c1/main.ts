import { mount } from 'svelte';
import App from '../../../entrypoints/panel/App.svelte';
await window.c1ready;
mount(App, { target: document.querySelector('#app')! });
