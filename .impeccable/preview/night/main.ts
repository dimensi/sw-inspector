import { mount } from 'svelte';
import App from '../../../entrypoints/panel/App.svelte';
await window.nightready;
mount(App, { target: document.querySelector('#app')! });
