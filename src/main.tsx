import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import './styles/app.css';

// Registra Service Worker (Workbox) para operación offline-first en campo
registerSW({ immediate: true });

render(<App />, document.getElementById('app')!);
