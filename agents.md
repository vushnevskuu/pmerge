# AGENTS.md

## Project

Browser extension (Manifest V3) with a floating on-page AI assistant window that can be dragged around, accepts a user prompt, and creates multiple visual links from an output port to DOM elements on the current page. Primary use case: on Pinterest, the user connects the assistant to several images they like and asks the assistant to generate a new image prompt in a similar vibe for a different theme. The extension uses the OpenAI API.

## Product Goal

Build a stable MV3 browser extension where the assistant overlay behaves like a lightweight node editor on top of any webpage:

- draggable floating assistant window
- text input for user prompt
- one visual output port on the assistant window
- multiple links from that port to selected page elements
- linked targets can be images, text blocks, links, or generic DOM elements
- collected context is converted into structured data and sent to OpenAI
- result is shown inside the floating assistant window

The implementation must prioritize:

- robustness on dynamic websites like Pinterest
- non-intrusive UI that does not break page interaction
- secure API handling
- clear modular architecture for future growth

---

## Required Architecture

### 1. Service Worker / Background

Responsibilities:

- receive requests from content script
- call OpenAI API
- centralize retries, throttling, and queueing
- optionally cache responses by request hash
- store project/session state if needed
- keep secrets and network logic out of content scripts whenever possible

Rules:

- do not call OpenAI directly from injected page context
- prefer background-mediated messaging for all model requests
- implement explicit error categories: network, auth, rate limit, invalid payload, timeout

### 2. Content Script

Responsibilities:

- inject floating UI overlay into the current page
- isolate styles with Shadow DOM
- implement drag-and-drop for the assistant window
- render visual links between assistant port and selected page targets
- inspect DOM under cursor while linking
- collect structured metadata from linked elements
- observe DOM mutations and maintain or repair links

Rules:

- the overlay root must be `position: fixed`
- use a very high z-index
- default outer overlay to `pointer-events: none`
- interactive elements must explicitly use `pointer-events: auto`
- never permanently block page scroll or clicks

### 3. Options / Settings Page

Responsibilities:

- API key entry for local-only mode
- backend endpoint configuration for proxy mode
- privacy settings
- feature flags for screenshot capture, debug logs, domain allowlist

### 4. Optional Panels

Optional:

- popup
- side panel

Do not make these blocking for MVP.

---

## UI Requirements

### Floating Assistant Window

The assistant window must:

- be draggable by header area
- preserve position per tab session at minimum
- optionally persist to `chrome.storage.local`
- contain:
  - title/header
  - prompt textarea/input
  - send button
  - status area
  - result area
  - a visible output port/handle for link creation

Recommended behavior:

- compact default size
- resizable in future, but not required in MVP-1
- smooth movement using pointer events
- no dependency on page CSS

### Shadow DOM

All assistant UI styles must be isolated using Shadow DOM.

Inside Shadow DOM:

- apply CSS reset
- define design tokens locally
- do not rely on host page typography or spacing

### Linking / Node Behavior

The assistant has one output port.

Link flow:

1. User starts drag from port.
2. Temporary rope/curve follows cursor.
3. DOM element under cursor is highlighted.
4. On pointer release, if target is valid, create persistent edge.
5. Multiple edges may exist simultaneously.

The user must be able to:

- create multiple links
- inspect connected targets
- remove a link
- re-run prompt using current graph

### Rope Rendering

Use a fullscreen fixed SVG overlay.

Requirements:

- render bezier curves from assistant port to target anchor point
- update positions on drag, scroll, resize
- redraw with `requestAnimationFrame` throttling
- visually distinguish:
  - temporary link
  - active link
  - broken link
  - hovered link

Do not use Canvas for MVP unless SVG becomes a blocker.

---

## DOM Targeting Rules

Each connected target must be stored as a structured node.

Minimum target schema:

```json
{
  "id": "target_123",
  "targetType": "image",
  "pageUrl": "https://www.pinterest.com/...",
  "locator": {
    "primary": "heuristic-selector",
    "css": "...",
    "xpath": "..."
  },
  "meta": {
    "tagName": "IMG",
    "src": "...",
    "alt": "...",
    "href": "...",
    "title": "...",
    "naturalWidth": 1000,
    "naturalHeight": 1500
  },
  "rect": {
    "x": 0,
    "y": 0,
    "width": 0,
    "height": 0
  },
  "timestamp": 0
}
```

### Locator Strategy

Do not trust a plain CSS selector alone.

Store multiple locator strategies:

- heuristic selector
- css selector
- xpath
- useful attributes
- local DOM fingerprint if needed

On rehydration:

1. try heuristic selector
2. try css selector
3. try xpath
4. try fuzzy recovery using image src / alt / nearest anchor / DOM neighborhood

If recovery fails:

- mark edge as broken
- show UI state for rebind

---

## Pinterest and Dynamic Pages

Pinterest is a primary target and must be treated as hostile/dynamic DOM.

Required handling:

- MutationObserver for feed changes
- target revalidation after mutations
- periodic lightweight integrity checks for connected targets
- robust extraction of best available image data

When linked target is an image, collect if available:

- current `src`
- `srcset`
- best candidate URL from `srcset`
- nearest pin link
- alt/aria labels
- rendered size and natural size

Do not assume DOM nodes remain stable between renders.

---

## Data Collection Modes

### Mode A: Metadata-only

Use when:

- fast MVP path
- user has not enabled screenshots
- image bytes are not required

Payload may include:

- prompt
- list of linked image URLs
- alt/title/caption text
- target metadata
- page title and URL

### Mode B: Screenshot/Crop

Use when image understanding must be reliable.

Recommended flow:

1. capture visible tab
2. crop target element by bounding rect
3. compress to acceptable size
4. convert to base64 or blob as required by chosen API format
5. include as image input in model request

Requirements:

- gate behind user setting/consent
- document privacy implications
- protect against oversized payloads
- skip capture if target is offscreen and no reliable bytes are available

---

## OpenAI Integration

The extension uses OpenAI API through the background layer.

Supported use cases:

1. text-only prompt enrichment
2. multimodal vibe extraction from selected images
3. structured output describing style, composition, palette, mood, and generation prompt
4. optional image generation in a later phase

### Security Modes

#### Preferred: Backend Proxy

Production recommendation:

- extension sends sanitized payload to your backend
- backend stores API secret
- backend calls OpenAI
- backend enforces auth, quotas, abuse prevention, and logging

#### Allowed for personal MVP: Local API Key

If no backend exists:

- store key in `chrome.storage.local`
- warn user that client-side key storage is insecure
- never hardcode keys
- never commit keys

### Request Contract

The content script sends a structured payload to background.

Example:

```json
{
  "prompt": "Make an image concept with this vibe but on the theme of futuristic eco cafe branding.",
  "page": {
    "url": "https://www.pinterest.com/...",
    "title": "Pinterest board title"
  },
  "connections": [
    {
      "targetType": "image",
      "meta": {
        "src": "https://...",
        "alt": "warm neutral editorial interior"
      }
    }
  ],
  "images": []
}
```

### Output Contract

Background returns:

```json
{
  "ok": true,
  "result": {
    "summary": "...",
    "styleSignals": ["warm beige", "soft natural light"],
    "generatedPrompt": "..."
  },
  "usage": {
    "cached": false
  }
}
```

For model outputs, prefer structured JSON where possible.

---

## Extension Permissions

Minimum likely permissions:

- `storage`
- `activeTab`
- `scripting`
- `tabs` if capture or broader tab handling is required

Host permissions:

- start with the narrowest domain scope possible
- for Pinterest MVP, prefer `https://*.pinterest.com/*`
- avoid `<all_urls>` unless absolutely necessary

If screenshot capture is enabled, implement only the permissions actually required for that flow.

---

## Internal Data Model

Represent state as a small graph.

### Graph Schema

```json
{
  "projectId": "project_001",
  "pageUrl": "https://www.pinterest.com/...",
  "assistantNode": {
    "id": "assistant_main",
    "position": { "x": 120, "y": 80 }
  },
  "targets": [],
  "edges": []
}
```

### Edge Schema

```json
{
  "id": "edge_001",
  "source": "assistant_main:out",
  "target": "target_123",
  "status": "active"
}
```

Persist graph state per page or project as needed.

---

## Messaging Contract

Use explicit message types between content script and background.

Examples:

- `ASSISTANT_SEND_REQUEST`
- `ASSISTANT_SEND_SUCCESS`
- `ASSISTANT_SEND_ERROR`
- `GRAPH_SAVE_REQUEST`
- `GRAPH_RESTORE_REQUEST`
- `TARGET_CAPTURE_REQUEST`
- `TARGET_CAPTURE_RESULT`

Rules:

- validate all incoming messages
- use typed payloads
- never pass raw DOM nodes through extension messages

---

## Performance Requirements

Must remain responsive on heavy pages.

Rules:

- throttle visual redraw with `requestAnimationFrame`
- avoid layout thrashing
- batch DOM reads and writes
- do not attach excessive listeners to many elements
- prefer event delegation where possible
- use MutationObserver carefully; debounce expensive recomputation

The extension must not noticeably degrade scroll performance on Pinterest feed pages.

---

## Accessibility and UX

Minimum expectations:

- visible focus states
- keyboard access for send/remove/retry actions
- clear error messages
- clear loading state
- broken links visibly indicated
- no hidden destructive actions

Nice to have later:

- keyboard shortcut to toggle overlay
- keyboard shortcut to enter link mode

---

## Privacy and Safety

Rules:

- only collect data from explicitly linked targets unless user enables broader context mode
- never scrape the entire page silently for MVP
- make screenshot capture opt-in
- clearly label when image crops are sent to API
- keep logs minimal and strip secrets

---

## MVP Roadmap

### MVP-1

Deliver:

- MV3 extension scaffold
- floating draggable assistant window
- prompt input and send button
- output port with multi-link support
- target hover highlight
- SVG rope rendering
- metadata-only context extraction for linked targets
- background OpenAI call pipeline
- result rendering in assistant window

### MVP-2

Deliver:

- screenshot capture and crop pipeline
- multimodal requests with selected image crops
- stronger Pinterest recovery logic
- link deletion/editing UI
- saved project state

### MVP-3

Deliver:

- backend proxy mode
- import/export of sessions
- broken-link repair workflow
- optional prompt templates
- optional generated image workflow

---

## Definition of Done

A task is done only if:

- it works on at least one Pinterest feed/board flow
- assistant window is draggable without breaking page interaction
- multiple links can be created and removed
- links visually track targets during scroll and resize
- broken targets are detected gracefully
- a prompt plus linked context reaches OpenAI through background messaging
- the returned result is rendered inside the overlay
- no secrets are hardcoded
- code is modular and documented

---

## Engineering Standards

Use:

- TypeScript preferred
- clear module boundaries
- small focused files
- no giant monolithic content script if avoidable

Suggested folders:

```text
src/
  background/
  content/
    overlay/
    graph/
    targeting/
    capture/
  shared/
  options/
```

Expectations:

- define shared types for graph, messages, and API payloads
- avoid duplicated selector logic
- document non-obvious DOM heuristics
- write code so future React migration is possible, but do not require React for MVP

---

## Implementation Order

Build in this order:

1. extension scaffold + permissions
2. content-script overlay shell in Shadow DOM
3. draggable assistant window
4. SVG overlay + temporary rope drag
5. target hit-testing and persistent edges
6. metadata extraction from linked targets
7. background messaging pipeline
8. OpenAI request/response handling
9. broken-link detection and mutation handling
10. screenshot crop mode

Do not start with image generation. First make context linking reliable.

---

## Explicit Non-Goals for Initial Build

Do not spend time initially on:

- perfect cross-browser parity beyond Chromium
- complex multi-window graph editor
- full design system
- cloud sync
- advanced auth
- publishing to extension store

Focus on working local prototype quality first.

---

## What the Agent Should Produce

The coding agent should generate:

1. complete MV3 extension scaffold
2. manifest configuration
3. background/service worker implementation
4. content script overlay implementation
5. SVG link rendering system
6. DOM target selection and persistence logic
7. settings page for API key / backend URL
8. typed messaging layer
9. minimal styling for usable overlay
10. README with setup steps

If architectural tradeoffs arise, optimize for reliability on dynamic pages and safe API handling.

