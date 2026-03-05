/**
 * Assistant overlay: Shadow DOM root, window HTML, drag, port link-drag, send, result.
 */

import type { GraphState, ConnectionSlotId } from '../../shared/types';
import { CONNECTION_SLOT_IDS } from '../../shared/types';
import { overlayStyles } from './styles';
import { drawRopes, scheduleRopeDraw } from './ropes';
import { resolveTarget } from '../targeting/locators';
import {
  createInitialState,
  addTarget,
  addEdge,
  removeEdge,
  setAssistantPosition,
  setSlotTitle,
  revalidateTargets,
  updateTargetRect,
  getTargetById,
  getEdgeBySlot,
} from '../graph/state';
import { extractTarget } from '../targeting/extract';
import { MESSAGE_TYPES } from '../../shared/types';

const STORAGE_POSITION_KEY = 'ai_assistant_position';

export interface OverlayCallbacks {
  onStateChange?: (state: GraphState) => void;
}

export function createOverlay(callbacks: OverlayCallbacks = {}): {
  root: HTMLElement;
  shadow: ShadowRoot;
  getState: () => GraphState;
  setState: (s: GraphState) => void;
} {
  const root = document.createElement('div');
  root.className = 'root';
  const shadow = root.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>${overlayStyles}</style>
    <div class="assistant-wrap" data-assistant-window>
      <div class="assistant-header" data-drag-handle title="Drag to move">
        <span class="assistant-title">AI Assistant</span>
        <span class="drag-hint">drag</span>
      </div>
      <div class="assistant-body">
        <textarea data-prompt placeholder="e.g. make an image with this vibe on the theme of a cosmic cafe"></textarea>
        <div class="send-row">
          <button type="button" class="send-btn" data-send>Send</button>
        </div>
        <div class="slots" data-slots>
          <div class="slot" data-slot="composition">
            <span class="port-dot" data-port title="Drag to element"></span>
            <input class="slot-title" data-slot-title type="text" value="Composition" />
          </div>
          <div class="slot" data-slot="tone">
            <span class="port-dot" data-port title="Drag to element"></span>
            <input class="slot-title" data-slot-title type="text" value="Tone" />
          </div>
          <div class="slot" data-slot="palette">
            <span class="port-dot" data-port title="Drag to element"></span>
            <input class="slot-title" data-slot-title type="text" value="Palette" />
          </div>
          <div class="slot" data-slot="theme">
            <span class="port-dot" data-port title="Drag to element"></span>
            <input class="slot-title" data-slot-title type="text" value="Theme" />
          </div>
        </div>
        <details class="connections-list" data-connections-list>
          <summary>Connections</summary>
          <div data-connections-items></div>
        </details>
        <div class="status" data-status></div>
        <div class="result" data-result style="display:none">
          <div class="result-image-wrap" data-result-image></div>
          <details class="result-image-descriptions" data-result-image-descriptions>
            <summary>Image descriptions</summary>
            <div class="result-image-descriptions-list" data-result-image-descriptions-list></div>
          </details>
          <details class="result-prompt-toggle" data-result-prompt-toggle>
            <summary>Prompt</summary>
            <pre class="result-prompt-text" data-result-prompt-text></pre>
          </details>
          <div class="result-text" data-result-text></div>
        </div>
      </div>
    </div>
    <svg class="svg-layer" data-ropes-svg></svg>
    <div class="highlight-box" data-highlight style="display:none"></div>
  `;

  let state: GraphState = createInitialState(window.location.href);

  const getState = () => state;
  const setState = (s: GraphState) => {
    state = s;
    callbacks.onStateChange?.(state);
  };

  const svg = shadow.querySelector('[data-ropes-svg]') as SVGElement;
  const updateSvgViewBox = () => {
    svg.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
    svg.setAttribute('width', String(window.innerWidth));
    svg.setAttribute('height', String(window.innerHeight));
  };
  updateSvgViewBox();
  const windowEl = shadow.querySelector('[data-assistant-window]') as HTMLElement;
  const dragHandle = shadow.querySelector('[data-drag-handle]') as HTMLElement;
  const slotsContainer = shadow.querySelector('[data-slots]') as HTMLElement;
  const promptInput = shadow.querySelector('[data-prompt]') as HTMLTextAreaElement;
  const sendBtn = shadow.querySelector('[data-send]') as HTMLButtonElement;
  const statusEl = shadow.querySelector('[data-status]') as HTMLElement;
  const resultEl = shadow.querySelector('[data-result]') as HTMLElement;
  const resultImageWrap = shadow.querySelector('[data-result-image]') as HTMLElement;
  const resultImageDescriptions = shadow.querySelector('[data-result-image-descriptions]') as HTMLDetailsElement;
  const resultImageDescriptionsList = shadow.querySelector('[data-result-image-descriptions-list]') as HTMLElement;
  const resultPromptToggle = shadow.querySelector('[data-result-prompt-toggle]') as HTMLDetailsElement;
  const resultPromptText = shadow.querySelector('[data-result-prompt-text]') as HTMLElement;
  const resultTextEl = shadow.querySelector('[data-result-text]') as HTMLElement;
  const highlightEl = shadow.querySelector('[data-highlight]') as HTMLElement;
  const connectionsList = shadow.querySelector('[data-connections-list]') as HTMLDetailsElement;
  const connectionsItems = shadow.querySelector('[data-connections-items]') as HTMLElement;

  function updateConnectionsList() {
    if (!connectionsItems) return;
    connectionsItems.innerHTML = '';
    CONNECTION_SLOT_IDS.forEach((slotId) => {
      const edge = getEdgeBySlot(state, slotId);
      const title = state.slotTitles[slotId];
      const div = document.createElement('div');
      div.className = 'connection-slot';
      div.setAttribute('data-slot', slotId);
      const titleSpan = document.createElement('span');
      titleSpan.className = 'connection-slot-title';
      titleSpan.textContent = title + ': ';
      const labelSpan = document.createElement('span');
      labelSpan.className = 'connection-slot-label';
      if (edge) {
        const t = getTargetById(state, edge.target);
        labelSpan.textContent = t?.meta?.alt || t?.meta?.src?.slice(-30) || edge.target.slice(0, 8) || '—';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = '✕';
        btn.addEventListener('click', () => {
          removeEdge(state, edge.id);
          updateConnectionsList();
          renderRopes();
        });
        div.appendChild(titleSpan);
        div.appendChild(labelSpan);
        div.appendChild(btn);
      } else {
        labelSpan.textContent = '—';
        div.appendChild(titleSpan);
        div.appendChild(labelSpan);
      }
      connectionsItems.appendChild(div);
    });
  }

  function syncSlotTitleInputs() {
    CONNECTION_SLOT_IDS.forEach((slotId) => {
      const slotEl = slotsContainer?.querySelector(`[data-slot="${slotId}"]`);
      const input = slotEl?.querySelector('[data-slot-title]') as HTMLInputElement | null;
      if (input && state.slotTitles[slotId] !== undefined) {
        input.value = state.slotTitles[slotId];
      }
    });
  }

  const resolveTargetEl = (target: GraphState['targets'][0]) =>
    resolveTarget(target, document);

  const getPortPositions = (): Partial<Record<ConnectionSlotId, { x: number; y: number }>> => {
    const out: Partial<Record<ConnectionSlotId, { x: number; y: number }>> = {};
    CONNECTION_SLOT_IDS.forEach((slotId) => {
      const slotEl = slotsContainer?.querySelector(`[data-slot="${slotId}"]`);
      const port = slotEl?.querySelector('[data-port]') as HTMLElement | null;
      if (port) {
        const r = port.getBoundingClientRect();
        out[slotId] = { x: r.left + r.width / 2, y: r.bottom };
      }
    });
    return out;
  };

  let tempDragSlot: ConnectionSlotId | null = null;

  function renderRopes(tempEnd: { x: number; y: number } | null = null) {
    scheduleRopeDraw(
      svg,
      state,
      () => tempEnd,
      () => tempDragSlot,
      resolveTargetEl,
      getPortPositions
    );
  }

  function loadSavedPosition() {
    try {
      const raw = localStorage.getItem(STORAGE_POSITION_KEY);
      if (raw) {
        const { x, y } = JSON.parse(raw);
        if (typeof x === 'number' && typeof y === 'number') {
          windowEl.style.left = x + 'px';
          windowEl.style.top = y + 'px';
          setAssistantPosition(state, x, y);
        }
      }
    } catch (_) {}
    if (!windowEl.style.left) {
      windowEl.style.left = state.assistantNode.position.x + 'px';
      windowEl.style.top = state.assistantNode.position.y + 'px';
    }
  }

  loadSavedPosition();

  let dragStartX = 0, dragStartY = 0, windowStartX = 0, windowStartY = 0;
  dragHandle.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('[data-port]')) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = windowEl.getBoundingClientRect();
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    windowStartX = rect.left;
    windowStartY = rect.top;
    const pid = e.pointerId;
    dragHandle.setPointerCapture(pid);
    let dragScheduled = false;
    let lastEv = { clientX: 0, clientY: 0 };
    const onMove = (ev: PointerEvent) => {
      lastEv = { clientX: ev.clientX, clientY: ev.clientY };
      if (dragScheduled) return;
      dragScheduled = true;
      requestAnimationFrame(() => {
        dragScheduled = false;
        const dx = lastEv.clientX - dragStartX;
        const dy = lastEv.clientY - dragStartY;
        const x = Math.max(0, windowStartX + dx);
        const y = Math.max(0, windowStartY + dy);
        windowEl.style.left = x + 'px';
        windowEl.style.top = y + 'px';
        setAssistantPosition(state, x, y);
        renderRopes();
      });
    };
    const onUp = () => {
      try {
        dragHandle.releasePointerCapture(pid);
      } catch (_) {}
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      try {
        const r = windowEl.getBoundingClientRect();
        localStorage.setItem(STORAGE_POSITION_KEY, JSON.stringify({ x: r.left, y: r.top }));
      } catch (_) {}
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  });

  let tempEnd: { x: number; y: number } | null = null;

  function setupSlotDrag(slotId: ConnectionSlotId) {
    const slotEl = slotsContainer?.querySelector(`[data-slot="${slotId}"]`);
    const port = slotEl?.querySelector('[data-port]') as HTMLElement | null;
    const titleInput = slotEl?.querySelector('[data-slot-title]') as HTMLInputElement | null;
    if (!port) return;
    if (titleInput) {
      titleInput.addEventListener('change', () => {
        setSlotTitle(state, slotId, titleInput.value);
        updateConnectionsList();
      });
      titleInput.addEventListener('blur', () => {
        setSlotTitle(state, slotId, titleInput.value);
        updateConnectionsList();
      });
    }
    port.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      tempDragSlot = slotId;
      const pid = e.pointerId;
      const startX = e.clientX;
      const startY = e.clientY;
      port.setPointerCapture(pid);
      let moveScheduled = false;
      let lastMove = { x: 0, y: 0 };
      const onMove = (ev: PointerEvent) => {
        lastMove = { x: ev.clientX, y: ev.clientY };
        if (moveScheduled) return;
        moveScheduled = true;
        requestAnimationFrame(() => {
          moveScheduled = false;
          tempEnd = lastMove;
          renderRopes(tempEnd);
          const el = document.elementFromPoint(lastMove.x, lastMove.y);
          if (el && !shadow.contains(el)) {
            highlightEl.style.display = 'block';
            const r = el.getBoundingClientRect();
            highlightEl.style.left = r.left + 'px';
            highlightEl.style.top = r.top + 'px';
            highlightEl.style.width = r.width + 'px';
            highlightEl.style.height = r.height + 'px';
          } else {
            highlightEl.style.display = 'none';
          }
        });
      };
      const cleanup = () => {
        highlightEl.style.display = 'none';
        tempEnd = null;
        tempDragSlot = null;
        try {
          port.releasePointerCapture(pid);
        } catch (_) {}
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        renderRopes();
      };
      const onUp = (ev: PointerEvent) => {
        cleanup();
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 8) return;
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        if (el && !shadow.contains(el)) {
          const tag = el.tagName?.toLowerCase();
          const isImg = el instanceof HTMLImageElement || el.querySelector('img');
          const isLink = el instanceof HTMLAnchorElement || el.closest('a');
          if (isImg || isLink || tag === 'p' || tag === 'span' || tag === 'div') {
            const targetEl = el instanceof HTMLImageElement ? el : (el.querySelector('img') || el);
            const id = 'target_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
            const extracted = extractTarget(targetEl, id);
            addTarget(state, extracted);
            addEdge(state, id, slotId);
            const t = getTargetById(state, id);
            if (t) {
              const resolved = resolveTarget(t, document);
              if (resolved) {
                const r = resolved.getBoundingClientRect();
                updateTargetRect(state, id, {
                  x: r.left + window.scrollX,
                  y: r.top + window.scrollY,
                  width: r.width,
                  height: r.height,
                });
              }
            }
            callbacks.onStateChange?.(state);
            updateConnectionsList();
          }
        }
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    });
  }
  CONNECTION_SLOT_IDS.forEach(setupSlotDrag);

  sendBtn.addEventListener('click', async () => {
    const prompt = promptInput.value?.trim();
    if (!prompt) return;
    statusEl.textContent = 'Sending…';
    if (resultImageWrap) resultImageWrap.innerHTML = '';
    if (resultImageDescriptions) resultImageDescriptions.style.display = 'none';
    if (resultPromptToggle) resultPromptToggle.style.display = 'none';
    if (resultTextEl) resultTextEl.textContent = '';
    resultEl.style.display = 'none';
    sendBtn.disabled = true;

    const payload = {
      prompt,
      page: { url: window.location.href, title: document.title },
      connections: state.edges.map((edge) => {
        const t = getTargetById(state, edge.target);
        return t
          ? {
              slotId: edge.slotId,
              slotTitle: state.slotTitles[edge.slotId],
              targetType: t.targetType,
              meta: t.meta,
              id: t.id,
            }
          : null;
      }).filter(Boolean) as Array<{
        slotId: ConnectionSlotId;
        slotTitle: string;
        targetType: string;
        meta: Record<string, unknown>;
        id: string;
      }>,
    };

    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.ASSISTANT_SEND_REQUEST,
        payload,
      });
      if (response?.ok) {
        const r = response.result;
        resultEl.classList.remove('error');
        if (r.imageUrl) {
          resultImageWrap.innerHTML = '';
          const img = document.createElement('img');
          img.src = r.imageUrl;
          img.alt = 'Generated image';
          img.className = 'result-img';
          resultImageWrap.appendChild(img);
          resultImageWrap.style.display = 'block';
        } else {
          resultImageWrap.innerHTML = '';
          resultImageWrap.style.display = 'none';
        }
        if (r.imageDescriptions?.length && resultImageDescriptions && resultImageDescriptionsList) {
          const summaryEl = resultImageDescriptions.querySelector('summary');
          if (summaryEl) summaryEl.textContent = `Image descriptions (${r.imageDescriptions.length})`;
          resultImageDescriptionsList.innerHTML = '';
          r.imageDescriptions.forEach((desc, i) => {
            const block = document.createElement('div');
            block.className = 'result-image-desc-item';
            const h = document.createElement('strong');
            h.textContent = `Image ${i + 1}:`;
            block.appendChild(h);
            block.appendChild(document.createTextNode(' ' + desc));
            resultImageDescriptionsList.appendChild(block);
          });
          resultImageDescriptions.style.display = 'block';
          resultImageDescriptions.setAttribute('open', '');
        } else if (resultImageDescriptions) {
          resultImageDescriptions.style.display = 'none';
        }
        if (r.generatedPrompt) {
          resultPromptText.textContent = r.generatedPrompt;
          resultPromptToggle.style.display = 'block';
          resultPromptToggle.setAttribute('open', '');
        } else {
          resultPromptToggle.style.display = 'none';
        }
        if (r.imageUrl && r.generatedPrompt) {
          resultTextEl.style.display = 'none';
        } else {
          const lines: string[] = [];
          if (r.summary) lines.push(r.summary);
          if (r.styleSignals?.length) lines.push('\nStyle: ' + r.styleSignals.join(', '));
          if (!r.imageUrl && r.generatedPrompt) {
            lines.push('\n\n(Image generation — OpenAI only)');
          }
          resultTextEl.textContent = lines.length ? lines.join('') : (r.text ?? 'Done.');
          resultTextEl.style.display = 'block';
        }
      } else {
        resultImageWrap.innerHTML = '';
        resultImageWrap.style.display = 'none';
        if (resultImageDescriptions) resultImageDescriptions.style.display = 'none';
        resultPromptToggle.style.display = 'none';
        resultTextEl.textContent = response?.error ?? 'Error';
        resultEl.classList.add('error');
      }
      resultEl.style.display = 'block';
    } catch (err) {
      resultImageWrap.innerHTML = '';
      resultImageWrap.style.display = 'none';
      if (resultImageDescriptions) resultImageDescriptions.style.display = 'none';
      resultPromptToggle.style.display = 'none';
      resultTextEl.textContent = String(err);
      resultEl.classList.add('error');
      resultEl.style.display = 'block';
    }
    statusEl.textContent = '';
    sendBtn.disabled = false;
  });

  const doScrollResizeWork = () => {
    updateSvgViewBox();
    if (state.edges.length === 0) return;
    revalidateTargets(state);
    state.targets.forEach((t) => {
      const el = resolveTargetEl(t);
      if (el) {
        const r = el.getBoundingClientRect();
        updateTargetRect(state, t.id, {
          x: r.left + window.scrollX,
          y: r.top + window.scrollY,
          width: r.width,
          height: r.height,
        });
      }
    });
    renderRopes();
  };
  let scrollResizeTimer: ReturnType<typeof setTimeout> | null = null;
  const SCROLL_DEBOUNCE_MS = 600;
  const scrollOrResize = () => {
    if (scrollResizeTimer) clearTimeout(scrollResizeTimer);
    scrollResizeTimer = setTimeout(() => {
      scrollResizeTimer = null;
      doScrollResizeWork();
    }, SCROLL_DEBOUNCE_MS);
  };
  window.addEventListener('scroll', scrollOrResize, { passive: true });
  window.addEventListener('resize', scrollOrResize);

  try {
    const scrollables = document.querySelectorAll('[data-pinterest-scroll], .mainContent, [role="main"], [data-test-id="pin-feed"], [data-test-id="scrollable-content"]');
    scrollables.forEach((el) => el.addEventListener('scroll', scrollOrResize, { passive: true }));
  } catch (_) {}

  setInterval(() => {
    if (state.edges.length === 0 || document.visibilityState !== 'visible') return;
    renderRopes();
  }, 1500);

  /* MutationObserver отключён: на Pinterest DOM меняется постоянно (лента, lazy-load),
     наблюдение за body вызывает тяжёлую работу и зависания. Пересчёт позиций — только по scroll/resize. */

  syncSlotTitleInputs();
  updateConnectionsList();
  renderRopes();

  return { root, shadow, getState, setState };
}
