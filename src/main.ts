import { mount } from 'svelte';
import App from './App.svelte';
import './lib/styles/theme.css';
import { installBrowserZoomPolicy } from './lib/services/native/zoom-policy';
installBrowserZoomPolicy(window);
mount(App, { target: document.getElementById('app')! });
