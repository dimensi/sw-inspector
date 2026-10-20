import { mount } from 'svelte';
import App from '../../../entrypoints/panel/App.svelte';
import Harness from './Harness.svelte';
mount(App, { target: document.querySelector('#app')! });
mount(Harness, { target: document.querySelector('main.inspector')! });
