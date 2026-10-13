import { loadSettings, saveSettings, subscribeSettings } from './settings.js';
import { getGenerationSetupStatus } from './setup-readiness.js';
import { createBridgeConnection } from './bridge-connection.js';
import { bridgeAgent, bridgeModelsForAgent, consumeBridgeEvents, nextBridgeReconnectDelay, pingBridge, restartBridge,
  pairingFromInput, reasoningLabel, BRIDGE_COMMAND, BRIDGE_PING_INTERVAL_MS } from '../provider/bridge-catalog.js';
import { escapeHtml } from '../../core/utils.js';
import { iconSvg } from '../../core/html/icons.js';
import { BUTTON_TAG } from '../../core/html/markup.js';
import { closeSettingsSheet, openSettingsSheet } from '../../ui/settings-sheet.js';
import { fieldMarkup, wireField } from '../../ui/primitives/field.js';
import { comboboxMarkup, wireCombobox } from '../../ui/primitives/combobox.js';
import { isCommandEnter } from '../../ui/input-intent.js';

/** @param {{trigger?: any, onSettingsChange?: () => void}} [options] */
export function createModelSettings({ trigger: defaultTrigger, onSettingsChange = () => {} } = {}) {
  let surface = null;
  let state = null;
  let view = 'idle';
  let readyCallback = null;
  let pairingDraft = '';
  let notice = '';
  let restarting = false;
  let picker = null;
  let renderKey = '';
  let pendingPairing = false;
  const connection = createBridgeConnection({ loadSettings, isConfigured: () => true, consumeEvents: consumeBridgeEvents,
    ping: pingBridge, nextDelay: nextBridgeReconnectDelay, pingInterval: BRIDGE_PING_INTERVAL_MS,
    probeWanted: () => !!surface && ['idle', 're_pair', 'bridge_down'].includes(view), reconnectFromProbe: () => view !== 're_pair',
    onState(next) {
      state = next; view = 'stream';
      const models = bridgeModelsForAgent(state, loadSettings().backend);
      const settings = loadSettings();
      const selected = models.find((model) => model.id === settings.model) || (!settings.model ? models[0] : null);
      if (selected && (!settings.model || !selected.reasoning.options.includes(settings.reasoning))) {
        saveSettings({ ...settings, model: selected.id, reasoning: selected.reasoning.default });
      }
      render(); finishPairing();
    },
    onView(next) { view = next; render(); connection.syncProbe(); },
    onDisconnected() { state = null; },
    onUnauthorized() { state = null; notice = 'Pair this browser again using the link in the bridge terminal.'; },
    onProbeChange() { render(); },
  });
  const unsubscribe = subscribeSettings(() => { onSettingsChange(); connection.start(); render(); });
  function button(id, label, extra = '') { return `<${BUTTON_TAG} id="${id}" type="button" class="settings-text-action" ${extra}>${label}</button>`; }
  function commandMarkup(command = BRIDGE_COMMAND) {
    return `<div class="bridge-command"><code>${escapeHtml(command)}</code>${button('copy-bridge-command', 'Copy', `data-command="${escapeHtml(command)}"`)}</div>`;
  }
  function pairingMarkup() {
    return `<div class="settings-section"><p class="field-hint">Run the bridge, then open its private pairing link or paste it here.</p>${commandMarkup()}
      <div class="bridge-pair-grid settings-advanced-grid">${fieldMarkup({ id: 'bridge-pairing-token', label: 'Pairing link', value: pairingDraft,
        placeholder: 'https://rabbithole.ing/#bridge=…', autocomplete: 'off', spellcheck: 'false' })}
      <${BUTTON_TAG} id="bridge-pair" type="button" class="web-primary">Connect</button></div></div>`;
  }
  function readyMarkup(settings, models) {
    const selected = models.find((model) => model.id === settings.model);
    return `<div class="settings-section model-section"><div class="settings-row"><span id="bridge-model-label" class="settings-label">Model</span>
      ${comboboxMarkup({ id: 'bridge-model', labelledBy: 'bridge-model-label', value: settings.model, label: selected?.name || settings.model || 'Choose a model', iconHtml: iconSvg('chevron') })}</div></div>
      ${selected ? `<div class="settings-section reasoning-section"><span id="reasoning-label" class="settings-label">Reasoning</span>
      <div class="reasoning-choice" role="group" aria-labelledby="reasoning-label">${selected.reasoning.options.map((value) => `<${BUTTON_TAG} type="button" data-reasoning="${escapeHtml(value)}" aria-pressed="${value === settings.reasoning}">${escapeHtml(reasoningLabel(value))}</button>`).join('')}</div></div>` : '<p role="status">The selected model is unavailable. Choose a current model.</p>'}
      <div class="settings-section"><p class="field-hint">Authentication and web search follow your local Codex configuration. PDF transcription uses this model${selected?.vision ? '.' : '; choose a vision model to transcribe PDFs.'}</p></div>
      <div class="settings-section settings-complete-section"><${BUTTON_TAG} id="complete-model-setup" type="button" class="web-primary" ${selected ? '' : 'disabled'}>${readyCallback ? 'Finish setup' : 'Done'}</button></div>`;
  }
  function render() {
    if (!surface) return;
    const settings = loadSettings();
    const agent = bridgeAgent(state, settings.backend);
    const current = view === 'stream' ? agent?.state || 'error' : view;
    const key = JSON.stringify([settings, state, current, notice, restarting, !!readyCallback]);
    if (key === renderKey) return;
    renderKey = key;
    const active = surface.contains(document.activeElement) ? document.activeElement?.id : '';
    picker?.close();
    const models = bridgeModelsForAgent(state, settings.backend);
    let body;
    if (current === 'ready') body = readyMarkup(settings, models);
    else if (current === 'starting') body = '<div class="settings-section" role="status"><p>Connecting to Codex…</p></div>';
    else if (['missing', 'signed_out', 'error'].includes(current)) body = `<div class="settings-section" role="status"><p>${current === 'missing' ? 'Install Codex to continue.' : current === 'signed_out' ? 'Sign in to Codex, or configure a provider in Codex.' : 'Codex is unavailable.'}</p>${agent?.detail ? `<p>${escapeHtml(agent.detail)}</p>` : ''}${commandMarkup(agent?.fix || BRIDGE_COMMAND)}</div>`;
    else body = pairingMarkup();
    surface.innerHTML = `<section id="settings-panel"><div class="settings-section"><div class="settings-row"><span class="settings-label">Backend</span><strong>Codex</strong></div></div>
      <div id="bridge-surface" class="bridge-surface" data-state="${escapeHtml(current)}">${body}</div>
      <div class="settings-section"><div class="settings-row"><span class="switch-copy"><strong>Bridge connection</strong><small>Restart after changing local Codex configuration.</small></span>${button('restart-bridge', restarting ? 'Restarting…' : 'Restart Bridge', `${restarting || current !== 'ready' ? 'disabled' : ''} ${restarting ? 'aria-busy="true"' : ''}`)}</div>
      <p id="bridge-restart-status" class="field-hint" role="status">${escapeHtml(notice)}</p></div></section>`;
    wireField(surface, { id: 'bridge-pairing-token' });
    const tokenInput = surface.querySelector('#bridge-pairing-token');
    tokenInput?.addEventListener('input', () => { pairingDraft = tokenInput.value; });
    const pair = () => {
      const pairing = pairingFromInput(tokenInput?.value);
      if (!pairing) { notice = 'Paste a valid pairing link or token.'; renderKey = ''; render(); return; }
      notice = ''; saveSettings({ ...loadSettings(), token: pairing.token,
        ...(pairing.port ? { base_url: `http://127.0.0.1:${pairing.port}` } : {}) });
      connection.start();
    };
    surface.querySelector('#bridge-pair')?.addEventListener('click', pair);
    tokenInput?.addEventListener('keydown', (event) => { if (isCommandEnter(event)) { event.preventDefault(); pair(); } });
    surface.querySelector('#copy-bridge-command')?.addEventListener('click', async (event) => {
      try { await navigator.clipboard.writeText(event.currentTarget.dataset.command); event.currentTarget.textContent = 'Copied'; } catch { notice = 'Select and copy the command above.'; render(); }
    });
    surface.querySelector('#complete-model-setup')?.addEventListener('click', () => {
      const callback = readyCallback; readyCallback = null; closeSettingsSheet(); void callback?.();
    });
    surface.querySelector('#restart-bridge')?.addEventListener('click', async () => {
      restarting = true; notice = ''; render();
      try { const currentSettings = loadSettings(); state = await restartBridge(currentSettings.base_url, currentSettings.token); }
      catch (error) { notice = error.message; }
      finally { restarting = false; render(); }
    });
    surface.querySelectorAll('[data-reasoning]').forEach((element) => element.addEventListener('click', () => {
      saveSettings({ ...loadSettings(), reasoning: element.dataset.reasoning });
    }));
    picker = wireCombobox(surface, { id: 'bridge-model', labelledBy: 'bridge-model-label', placeholder: 'Search models…', searchIconHtml: iconSvg('search', { size: 13 }), getValue: (model) => model.id,
      source: { load: async () => models, filter: (items, query) => items.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(query.toLowerCase())),
        renderOption: (model, { index }) => `<${BUTTON_TAG} type="button" class="model-option" role="option" data-value="${escapeHtml(model.id)}" data-label="${escapeHtml(model.name)}" data-item-index="${index}" aria-selected="${model.id === settings.model}"><span class="model-option-name">${escapeHtml(model.name)}</span><span class="model-option-price">${model.vision ? 'vision' : ''}</span></button>`,
        loading: () => '<p>Loading models…</p>', empty: () => '<p>No matching models.</p>', error: (retry) => `<p>Model discovery failed.</p>${retry}` },
      onChange: (id) => { const model = models.find((entry) => entry.id === id); if (model) saveSettings({ ...loadSettings(), model: id, reasoning: model.reasoning.default }); } });
    if (active) surface.querySelector(`#${active}`)?.focus({ preventScroll: true });
  }
  function finishPairing() {
    if (!pendingPairing || !getGenerationSetupStatus().ready || bridgeAgent(state, loadSettings().backend)?.state !== 'ready') return;
    pendingPairing = false; const callback = readyCallback; readyCallback = null; void callback?.(); render();
  }
  function mountPane(host) {
    surface = host; renderKey = ''; render(); connection.start(); connection.syncProbe();
    return () => { picker?.close(); surface = null; renderKey = ''; connection.stopProbe(); };
  }
  function open({ trigger = defaultTrigger, status = '', onReady = null } = {}) {
    notice = status; readyCallback = onReady; renderKey = ''; render();
    openSettingsSheet({ section: 'model', trigger }); connection.start();
  }
  function showBridgeUnauthorized({ onReady = null } = {}) {
    readyCallback = onReady; state = null; view = 're_pair'; connection.stopStream(); render(); connection.syncProbe();
  }
  return { open, close: closeSettingsSheet, mountPane, isOpen: () => !!surface,
    beginPairingSetup({ onComplete = null } = {}) { pendingPairing = true; readyCallback = onComplete; connection.start(); finishPairing(); },
    showBridgeUnauthorized, syncConnection: () => connection.start(),
    recoverBridge({ trigger = defaultTrigger, onReady = null } = {}) { open({ trigger, onReady }); },
    dispose() { unsubscribe(); picker?.close(); connection.dispose(); } };
}
