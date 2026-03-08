/**
 * Options page: API key and settings.
 */

const FORM_ID = 'settings-form';
const API_KEY_ID = 'api-key';
const PROVIDER_ID = 'provider';
const SAVE_ID = 'save';
const STATUS_ID = 'status';
const STORAGE_KEY = 'ai_assistant_settings';
const EXPAND_SHORT_ID = 'expand-short-prompts';

interface StoredSettings {
  apiKey?: string;
  provider?: 'openai' | 'groq';
  expandShortPrompts?: boolean;
}

function updateProviderUI(provider: string): void {
  const label = document.getElementById('api-key-label');
  const input = document.getElementById(API_KEY_ID) as HTMLInputElement | null;
  const hint = document.getElementById('api-hint');
  if (provider === 'groq') {
    if (label) label.textContent = 'Groq API Key';
    if (input) input.placeholder = 'gsk_...';
    if (hint) hint.innerHTML = 'Free key: <a href="https://console.groq.com" target="_blank">console.groq.com</a>';
  } else {
    if (label) label.textContent = 'OpenAI API Key';
    if (input) input.placeholder = 'sk-...';
    if (hint) hint.textContent = 'Key: platform.openai.com';
  }
}

async function load(): Promise<void> {
  const raw = await chrome.storage.local.get(STORAGE_KEY);
  const s = raw[STORAGE_KEY] as StoredSettings | undefined;
  const input = document.getElementById(API_KEY_ID) as HTMLInputElement | null;
  const providerSelect = document.getElementById(PROVIDER_ID) as HTMLSelectElement | null;
  const expandCheck = document.getElementById(EXPAND_SHORT_ID) as HTMLInputElement | null;
  if (input) input.value = s?.apiKey ?? '';
  if (providerSelect) {
    providerSelect.value = s?.provider ?? 'groq';
    updateProviderUI(providerSelect.value);
  }
  if (expandCheck) expandCheck.checked = s?.expandShortPrompts !== false;
}

function showStatus(text: string, isError = false): void {
  const el = document.getElementById(STATUS_ID);
  if (el) {
    el.textContent = text;
    el.style.color = isError ? '#b91c1c' : '#059669';
  }
}

async function save(): Promise<void> {
  const input = document.getElementById(API_KEY_ID) as HTMLInputElement | null;
  const providerSelect = document.getElementById(PROVIDER_ID) as HTMLSelectElement | null;
  const expandCheck = document.getElementById(EXPAND_SHORT_ID) as HTMLInputElement | null;
  const key = input?.value?.trim() ?? '';
  const provider = (providerSelect?.value as 'openai' | 'groq') ?? 'groq';
  const expandShortPrompts = expandCheck?.checked ?? false;
  await chrome.storage.local.set({
    [STORAGE_KEY]: { apiKey: key, provider, expandShortPrompts } as StoredSettings,
  });
  showStatus('Settings saved.');
}

function init(): void {
  load();
  const form = document.getElementById(FORM_ID);
  const saveBtn = document.getElementById(SAVE_ID);
  const providerSelect = document.getElementById(PROVIDER_ID);
  if (form) form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  if (saveBtn) saveBtn.addEventListener('click', save);
  if (providerSelect) providerSelect.addEventListener('change', () => updateProviderUI((providerSelect as HTMLSelectElement).value));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
