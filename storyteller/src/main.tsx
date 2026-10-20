import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { loadGestures } from './gestures/store';
import './styles.css';

void loadGestures();
render(<App />, document.getElementById('app')!);

if (import.meta.env.PROD) registerSW({ immediate: true });
