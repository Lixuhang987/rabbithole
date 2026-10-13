export const SETTINGS_KEY = 'rh-web-settings';
const DEFAULT_FETCH_PROXY_URL = typeof __RABBITHOLE_DEFAULT_PROXY_URL__ === 'string' ? __RABBITHOLE_DEFAULT_PROXY_URL__ : '';
const defaults = () => ({ backend: 'codex', model: '', reasoning: '', base_url: 'http://127.0.0.1:41414', token: '', fetch_proxy_url: DEFAULT_FETCH_PROXY_URL });
let currentSettings = null;
const subscribers = new Set();
function normalize(value) {
  const next = defaults();
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.backend !== 'string') return next;
  for (const key of Object.keys(next)) if (typeof value[key] === 'string') next[key] = value[key];
  return next;
}
if (typeof window !== 'undefined') window.addEventListener('storage', (event) => {
  if (event.key !== SETTINGS_KEY) return;
  currentSettings = null;
  for (const subscriber of subscribers) subscriber(loadSettings());
});
export function loadSettings() {
  if (!currentSettings) {
    try { currentSettings = normalize(JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null')); }
    catch { currentSettings = defaults(); }
  }
  return currentSettings;
}
export function saveSettings(settings) {
  const next = normalize(settings);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  currentSettings = next;
  for (const subscriber of subscribers) subscriber(next);
}
export function subscribeSettings(subscriber) { subscribers.add(subscriber); return () => subscribers.delete(subscriber); }
export function resetSettingsCache() { currentSettings = null; }
