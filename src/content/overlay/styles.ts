/**
 * Isolated styles for overlay. Applied inside Shadow DOM.
 */

export const overlayStyles = `
  :host, * { box-sizing: border-box; }
  .root {
    position: fixed;
    inset: 0;
    z-index: 2147483646;
    pointer-events: none;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
  }
  .svg-layer {
    position: fixed;
    inset: 0;
    z-index: 3;
    pointer-events: none;
    width: 100%;
    height: 100%;
  }
  .svg-layer path {
    pointer-events: none;
    fill: none;
    stroke: #2563eb;
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .svg-layer path.temp { stroke: #64748b; stroke-dasharray: 6 4; stroke-width: 2; }
  .svg-layer path.active { stroke: #2563eb; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.1)); }
  .svg-layer path.broken { stroke: #dc2626; stroke-dasharray: 6 3; }
  .assistant-wrap {
    position: fixed;
    z-index: 2;
    pointer-events: auto;
    min-width: 320px;
    max-width: 420px;
    background: rgba(255, 255, 255, 0.65);
    -webkit-backdrop-filter: blur(12px);
    backdrop-filter: blur(12px);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.12), 0 0 0 1px rgba(255,255,255,0.6) inset;
    border: 1px solid rgba(255, 255, 255, 0.5);
    overflow: visible;
    isolation: isolate;
  }
  .assistant-wrap { cursor: grab; user-select: none; }
  .assistant-wrap:active { cursor: grabbing; }
  .assistant-wrap button, .assistant-wrap input, .assistant-wrap textarea, .assistant-wrap select { cursor: default; user-select: auto; }
  .assistant-header {
    padding: 10px 14px;
    background: rgba(249, 250, 251, 0.6);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid rgba(229, 231, 235, 0.8);
    border-radius: 12px 12px 0 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .mode-switcher {
    display: flex;
    gap: 2px;
    pointer-events: auto;
  }
  .mode-btn {
    padding: 4px 8px;
    font-size: 11px;
    border: none;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.35);
    color: #6b7280;
    cursor: pointer;
    font: inherit;
  }
  .mode-btn:hover { background: rgba(243, 244, 246, 0.6); color: #374151; }
  .mode-btn.active {
    background: rgba(71, 85, 105, 0.55);
    color: #fff;
  }
  .header-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
  .assistant-header .drag-hint { font-size: 12px; color: #9ca3af; }
  .close-btn {
    width: 24px;
    height: 24px;
    padding: 0;
    font-size: 18px;
    line-height: 1;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: #6b7280;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .close-btn:hover {
    background: rgba(229, 231, 235, 0.9);
    color: #374151;
  }
  .assistant-body { padding: 14px; }
  .assistant-body textarea {
    width: 100%;
    min-height: 80px;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.5);
    border: 1px solid rgba(229, 231, 235, 0.9);
    border-radius: 8px;
    resize: vertical;
    font: inherit;
  }
  .assistant-body textarea:focus {
    outline: none;
    border-color: #2563eb;
    box-shadow: 0 0 0 2px rgba(37,99,235,0.2);
  }
  .send-row { display: flex; gap: 8px; margin-top: 18px; align-items: center; }
  .send-btn {
    flex: 1;
    min-width: 0;
    padding: 8px 16px;
    background: #2563eb;
    color: #fff;
    border: none;
    border-radius: 8px;
    font: inherit;
    cursor: pointer;
  }
  .send-btn:hover { background: #1d4ed8; }
  .send-btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .record-btn {
    padding: 8px 14px;
    background: rgba(220, 38, 38, 0.9);
    color: #fff;
    border: none;
    border-radius: 8px;
    font: inherit;
    cursor: pointer;
    flex-shrink: 0;
  }
  .record-btn:hover { background: #dc2626; }
  .slots {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    margin-top: 10px;
  }
  .slot {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px 4px 8px;
    background: rgba(243, 244, 246, 0.6);
    border-radius: 8px;
    border: 1px solid rgba(229, 231, 235, 0.8);
    width: 100%;
    max-width: 100%;
    font-size: 12px;
  }
  .slot-add-btn {
    margin: 6px auto 0;
    width: 28px;
    height: 28px;
    padding: 0;
    font-size: 18px;
    line-height: 1;
    border: 1px dashed rgba(156, 163, 175, 0.8);
    border-radius: 6px;
    background: rgba(243, 244, 246, 0.6);
    color: #6b7280;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .slot-add-btn:hover {
    background: rgba(229, 231, 235, 0.8);
    color: #374151;
  }
  .port-dot {
    position: absolute;
    left: -24px;
    top: 50%;
    transform: translateY(-50%);
    width: 16px;
    height: 16px;
    min-width: 16px;
    min-height: 16px;
    border-radius: 50%;
    background: #2563eb;
    border: 2px solid #1d4ed8;
    cursor: crosshair;
    flex-shrink: 0;
  }
  .port-dot:hover { background: #1d4ed8; }
  .slot-title {
    flex: 1;
    min-width: 0;
    padding: 2px 6px;
    font-size: 12px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    font: inherit;
  }
  .slot-title:hover, .slot-title:focus {
    border-color: rgba(229, 231, 235, 0.9);
    outline: none;
  }
  .status { margin-top: 10px; font-size: 12px; color: #6b7280; min-height: 1.2em; }
  .result {
    margin-top: 10px;
    padding: 10px 12px;
    background: rgba(243, 244, 246, 0.6);
    border-radius: 8px;
    font-size: 13px;
  }
  .result-img {
    width: 100%;
    max-width: 100%;
    height: auto;
    border-radius: 6px;
    display: block;
  }
  .result-image-wrap { margin-bottom: 8px; }
  .result-image-descriptions {
    margin-top: 8px;
    font-size: 12px;
  }
  .result-image-descriptions summary {
    cursor: pointer;
    color: #6b7280;
    user-select: none;
  }
  .result-image-desc-item {
    margin-top: 8px;
    padding: 8px;
    background: rgba(229, 231, 235, 0.8);
    border-radius: 6px;
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .result-image-desc-item:first-child { margin-top: 6px; }
  .result-prompt-toggle {
    margin-top: 8px;
    font-size: 12px;
  }
  .prompt-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .result-prompt-toggle summary {
    cursor: pointer;
    color: #6b7280;
    user-select: none;
  }
  .copy-prompt-btn {
    padding: 2px 8px;
    font-size: 12px;
    border: none;
    border-radius: 4px;
    background: rgba(71, 85, 105, 0.2);
    color: #475569;
    cursor: pointer;
    flex-shrink: 0;
  }
  .copy-prompt-btn:hover {
    background: rgba(71, 85, 105, 0.35);
    color: #334155;
  }
  .result-prompt-text {
    margin: 6px 0 0;
    padding: 8px;
    background: rgba(229, 231, 235, 0.8);
    border-radius: 6px;
    font-size: 11px;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-x: auto;
  }
  .result-text {
    white-space: pre-wrap;
    word-break: break-word;
  }
  .result.error { background: rgba(254, 242, 242, 0.9); color: #991b1b; }
  .result-motion-selection { margin-bottom: 8px; }
  .result-motion-question { margin: 0 0 8px; font-weight: 500; color: #374151; }
  .result-motion-candidates { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .motion-candidate-btn {
    padding: 6px 12px;
    font-size: 12px;
    border: 1px solid rgba(229, 231, 235, 0.9);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.8);
    color: #374151;
    cursor: pointer;
    font: inherit;
  }
  .motion-candidate-btn:hover {
    background: rgba(37, 99, 235, 0.1);
    border-color: rgba(37, 99, 235, 0.4);
    color: #1d4ed8;
  }
  .result-motion-hint { margin: 0; font-size: 11px; color: #6b7280; }
  .highlight-box {
    position: fixed;
    border: 2px solid #2563eb;
    border-radius: 4px;
    pointer-events: none;
    z-index: 0;
  }
  .roi-layer {
    position: fixed;
    inset: 0;
    z-index: 4;
    pointer-events: none;
  }
  .roi-layer.active .roi-frame { pointer-events: auto; }
  .roi-frame {
    position: fixed;
    border: 2px solid #2563eb;
    background: rgba(37, 99, 235, 0.08);
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.2);
    cursor: move;
    min-width: 40px;
    min-height: 40px;
  }
  .roi-frame .roi-resize-handle {
    position: absolute;
    width: 10px;
    height: 10px;
    background: #2563eb;
    border: 1px solid #fff;
    border-radius: 2px;
    cursor: nwse-resize;
    pointer-events: auto;
  }
  .roi-frame .roi-resize-handle.n { top: -5px; left: 50%; margin-left: -5px; cursor: n-resize; }
  .roi-frame .roi-resize-handle.s { bottom: -5px; left: 50%; margin-left: -5px; cursor: s-resize; }
  .roi-frame .roi-resize-handle.e { right: -5px; top: 50%; margin-top: -5px; cursor: e-resize; }
  .roi-frame .roi-resize-handle.w { left: -5px; top: 50%; margin-top: -5px; cursor: w-resize; }
  .roi-frame .roi-resize-handle.nw { top: -5px; left: -5px; cursor: nwse-resize; }
  .roi-frame .roi-resize-handle.ne { top: -5px; right: -5px; cursor: nesw-resize; }
  .roi-frame .roi-resize-handle.sw { bottom: -5px; left: -5px; cursor: nesw-resize; }
  .roi-frame .roi-resize-handle.se { bottom: -5px; right: -5px; cursor: nwse-resize; }
`;
