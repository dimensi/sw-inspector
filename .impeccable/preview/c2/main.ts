import { mount } from 'svelte';
import App from '../../../entrypoints/panel/App.svelte';
await window.c2ready;
mount(App, { target: document.querySelector('#app')! });
