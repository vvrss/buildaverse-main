import '@fontsource-variable/figtree/wght.css';
import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { initProfiles } from './store/profile';
import { showToast } from './store/storyStore';
import { setUpdateHandler } from './ui/pwa';
import './styles.css';

void initProfiles();
render(<App />, document.getElementById('app')!);

if (import.meta.env.PROD) {
  const update = registerSW({
    immediate: true,
    onNeedRefresh: () => {
      setUpdateHandler(() => void update(true));
      showToast('A new version is ready. Update it in Settings → App.');
    },
  });
}
