/**
 * Service worker: receives messages from content script, calls OpenAI API.
 * Keeps API key and network logic out of content scripts.
 */

import type {
  AssistantSendRequestPayload,
  AssistantSendSuccessPayload,
  AssistantSendErrorPayload,
  AssistantErrorCode,
} from '../shared/types';
import { MESSAGE_TYPES } from '../shared/types';
import { extractDescriptionFromMergeFormat, normalizeMergePrompt, stripColorFromMaterial, sanitizePromptMaterialColors, enforceWhiteBackground } from '../shared/parseUtils';
import { VISUAL_ANALYSIS_INSTRUCTIONS } from './visualInstructions';
import { MERGE_INSTRUCTIONS } from './mergeInstructions.generated';
import { MOTION_PROMPT } from './motionInstructions';
import { isValidImageUrl } from '../shared/imageValidation';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const STORAGE_KEY = 'ai_assistant_settings';

interface StoredSettings {
  apiKey?: string;
  provider?: 'openai' | 'groq';
  expandShortPrompts?: boolean;
}

async function getSettings(): Promise<StoredSettings> {
  const raw = await chrome.storage.local.get(STORAGE_KEY);
  return (raw[STORAGE_KEY] as StoredSettings) ?? {};
}

const MAX_IMAGES = 5;
/** Max images in one API request (model limit). */
const PER_REQUEST_IMAGES = 5;
/** Max total frames for motion; we send in chunks of PER_REQUEST_IMAGES. */
const MOTION_MAX_TOTAL_IMAGES = 20;

function getConnectionsBySlotOrder(payload: AssistantSendRequestPayload): Array<typeof payload.connections[0] & { slotId: string }> {
  const bySlot = new Map<string, (typeof payload.connections)[0]>();
  for (const c of payload.connections) {
    const slotId = (c as { slotId?: string }).slotId;
    if (slotId) bySlot.set(slotId, c as (typeof payload.connections)[0] & { slotId: string });
  }
  const slotIds = payload.slotIds ?? [];
  const ordered: Array<(typeof payload.connections)[0] & { slotId: string }> = [];
  for (const slotId of slotIds) {
    const c = bySlot.get(slotId);
    if (c) ordered.push({ ...c, slotId });
  }
  return ordered;
}

function getImageUrlsFromPayload(payload: AssistantSendRequestPayload): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  const maxImgs = payload.mode === 'motion' ? PER_REQUEST_IMAGES : MAX_IMAGES;
  const ordered = getConnectionsBySlotOrder(payload);
  for (const c of ordered) {
    const src = c.meta?.src;
    if (typeof src === 'string' && isValidImageUrl(src) && !seen.has(src)) {
      seen.add(src);
      urls.push(src);
      if (urls.length >= maxImgs) break;
    }
  }
  if (payload.images?.length) {
    for (const img of payload.images) {
      if (typeof img === 'string' && isValidImageUrl(img) && !seen.has(img)) {
        seen.add(img);
        urls.push(img);
        if (urls.length >= maxImgs) break;
      }
    }
  }
  return urls;
}

type MessageContent = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;

function countImagePartsInMessages(messages: Array<{ content?: MessageContent }>): number {
  let n = 0;
  for (const msg of messages) {
    const c = msg.content;
    if (Array.isArray(c)) for (const p of c) if (p.type === 'image_url') n++;
  }
  return n;
}

/** Enforce API limit: no message may contain more than maxImages image_url parts. */
function capMessagesImages(
  messages: Array<{ role: string; content: MessageContent }>,
  maxImages: number = PER_REQUEST_IMAGES
): Array<{ role: string; content: MessageContent }> {
  return messages.map((msg) => {
    const content = msg.content;
    if (typeof content === 'string') return msg;
    let count = 0;
    const out: MessageContent[0][] = [];
    for (const part of content) {
      if (part.type === 'image_url') {
        count++;
        if (count <= maxImages) out.push(part);
      } else {
        out.push(part);
      }
    }
    return { ...msg, content: out };
  });
}

function buildMessages(
  payload: AssistantSendRequestPayload,
  overrideImageUrls?: string[]
): Array<{ role: 'system' | 'user'; content: MessageContent }> {
  const mode = payload.mode ?? 'compile';
  const ordered = getConnectionsBySlotOrder(payload);
  const imageUrls = overrideImageUrls ?? getImageUrlsFromPayload(payload);
  const hasImages = imageUrls.length > 0;

  const textParts: string[] = [];
  textParts.push(`Page: ${payload.page.title} (${payload.page.url})\n`);
  textParts.push(`MODE: ${mode}\n`);

  if (mode === 'motion') {
    if (payload.prompt?.trim()) {
      const hint = payload.prompt.trim();
      textParts.push(`\nUSER FOCUS (prioritize in analysis and in section #11): "${hint}"\n`);
      if (/\b(стрелка|влево|вправо|вверх|вниз|left|right|up|down|arrow|chevron)\b/i.test(hint)) {
        textParts.push('The user may have specified direction — if so, treat it as correct. Do not invert or contradict.\n');
      }
    }
    const of = payload.observationFrame;
    if (of && typeof of.x === 'number' && typeof of.y === 'number' && typeof of.width === 'number' && typeof of.height === 'number') {
      textParts.push('\nOBSERVATION FRAME (analyze ONLY this region):\n');
      textParts.push(`- frame_mode: approximate_box`);
      textParts.push(`- frame_position: x=${of.x}, y=${of.y} (viewport px)`);
      textParts.push(`- frame_size: width=${of.width}, height=${of.height}`);
      textParts.push(`- frame_boundaries: viewport coordinates`);
      textParts.push(`- tracking_behavior: fixed\n`);
    } else {
      textParts.push('\nOBSERVATION FRAME: Full captured area (no ROI crop). Analyze the entire frame.\n');
    }
    if (ordered.length > 0) {
      textParts.push('\nLinked source:\n');
      ordered.forEach((c) => {
        const slotTitle = (c as { slotTitle?: string }).slotTitle || c.slotId;
        textParts.push(`- "${slotTitle}": type ${c.targetType}`);
        if (c.meta.src) textParts.push(`  src: ${String(c.meta.src).slice(0, 120)}...`);
        textParts.push('');
      });
    }
    if (hasImages) {
      if (payload.prompt?.trim()) {
        textParts.push('\nAnalyze with focus on the user-described element/area above.\n');
      }
      textParts.push(`\nFrame 1 is the start, Frame ${imageUrls.length} is the end. Describe direction and motion as they appear from start to end.`);
      textParts.push(`\nDEFAULT APPEARANCE: Frames 1–3 (first frames) define how the element looks at rest. Describe exactly: shape, colors, and arrow/chevron direction (e.g. left-pointing). The implementation prompt MUST reproduce this; do not invert direction. If later frames show a hover-like change (e.g. fill, color), describe it as hover and include "default" vs "on hover" in the code prompt.`);
      textParts.push(`\nYou will receive ${imageUrls.length} KEYFRAMES in strict temporal order (Frame 1, Frame 2, ...). These are a sparse sample from one continuous motion. INFER and INTERPOLATE the full motion between keyframes; describe the complete animation from start to end, including phases between the keyframes. Analyze ONLY the observation frame region.`);
      textParts.push(`\nLOOP DETECTION: Compare Frame 1 and Frame ${imageUrls.length}. If they are visually similar (same state/position), the recording is likely a LOOPED animation. You MUST report loop.detected and include loop/repeat instructions in the implementation prompt.`);
    }
    if (payload.pageContext?.detectedLibraries?.length) {
      textParts.push(`\nPage context: detected possible use of ${payload.pageContext.detectedLibraries.join(', ')}. Prefer this ecosystem's component names and motion patterns when naming the element and in the code-generation prompt (#11).`);
      if (payload.pageContext.detectedHints?.length) {
        textParts.push(` Detected classes/hints: ${payload.pageContext.detectedHints.slice(0, 5).join(', ')}.`);
      }
    }
  } else if (mode === 'merge') {
    textParts.push('MERGE mode: ONE subject. MANDATORY: every connected port (Character, Material, Color, Style, etc.) MUST appear in the prompt. No port may be omitted. Format: [character] MADE OF [material] IN [colors], or in [style] style. If no Background port: background = pure white, ideal white, no gradients, no scenery.\n');
    textParts.push('Example: "Two men MADE OF smooth yellow plastic IN orange and green." — the men ARE plastic sculptures, not wearing plastic. Whole body = material. 250+ words.\n');
    if (ordered.length > 0) {
      textParts.push('\nPORTS — extract aspect from each image:\n');
      ordered.forEach((c, i) => {
        const slotTitle = (c as { slotTitle?: string }).slotTitle || c.slotId;
        textParts.push(`- PORT [${i + 1}] "${slotTitle}": extract from this image`);
        textParts.push(`  Type: ${c.targetType}`);
        if (c.meta.src) textParts.push(`  URL: ${c.meta.src}`);
        if (c.meta.alt) textParts.push(`  Alt: ${c.meta.alt}`);
        if (c.meta.title) textParts.push(`  Title: ${c.meta.title}`);
        textParts.push('');
      });
    }
    if (hasImages) {
      textParts.push(`\n=== STRICT: Each image = ONE port only ===`);
      ordered.forEach((c, i) => {
        const slotTitle = (c as { slotTitle?: string }).slotTitle || c.slotId;
        textParts.push(`Image ${i + 1} → ${slotTitle} ONLY. Do NOT use this image for any other port.`);
      });
      textParts.push(`\nCRITICAL: generatedPrompt = expand descriptions into rich, detailed prompt. Elaborate — add texture, nuance. Do NOT invent (no "Dali", no artists). Expansion = deepening, not adding new concepts.`);
      const hasColorPort = ordered.some((c) => /color|colour|palette|цвет|палитра/i.test((c as { slotTitle?: string }).slotTitle || c.slotId || ''));
      textParts.push(`\nMaterial port: texture/surface (smooth, glossy). When Color exists: no color in Material.`);
      if (hasColorPort) {
        textParts.push(`\nCOLOR RULE: Colors come ONLY from Color port. Character and Material give NO colors. Color image → extract all its colors (teal bear → "teal, black, yellow, pink, green"; dog → "yellow, black, red").`);
        textParts.push(`\nCharacter port: NO color words when Color exists. Material port: NO color. Colors in generatedPrompt = only from Color (desc[2]).`);
      } else {
        textParts.push(`\nCOLOR RULE: No Color port — use all visible colors from Character, Material, etc. Character and Material may include colors.`);
      }
      textParts.push(`\nCharacter in generatedPrompt: subject = EXACTLY from Image 1 (desc[0]). Character can be object: suitcase, box, controller, machine. If Image 1 = suitcase → "suitcase", NOT "man". Use desc[0] verbatim.`);
      textParts.push(`\nBelow are ${imageUrls.length} image(s) in order. imageDescriptions[i] = extract ONLY from image i+1.`);
      const hasStylePort = ordered.some((c) => /style|styl|illustration/i.test((c as { slotTitle?: string }).slotTitle || c.slotId || ''));
      if (hasStylePort) {
        textParts.push(`\nSTYLE PORT: APPLY the style from the Style image TO the character. The character is RENDERED in that style — do NOT just copy the Character image as-is. Style = transformation. Embed "in [style] style" in FIRST sentence. Character: NO text (no speech bubbles, captions, "Yes sir").`);
      }
      textParts.push(`\nCRITICAL: Format adapts to ports. 250+ words.`);
      const hasBackgroundPort = ordered.some((c) => /background|scene|фон|бэкграунд|setting|environment/i.test((c as { slotTitle?: string }).slotTitle || c.slotId || ''));
      if (!hasBackgroundPort) {
        textParts.push(`\nBACKGROUND: No Background port — MANDATORY: add "on plain white background" or "on pure white background". Do NOT invent dark, dim, fiery, or dramatic background. Only white.`);
      }
    }
  } else {
    textParts.push(`USER PROMPT (MAIN SUBJECT — the image MUST depict this): "${payload.prompt ?? ''}"\n`);
    if (ordered.length > 0) {
      textParts.push('Structured connections — extract ONLY the specified aspect from each image:\n');
      ordered.forEach((c, i) => {
        const slotTitle = (c as { slotTitle?: string }).slotTitle || c.slotId;
        textParts.push(`- Image [${i + 1}]: extract ONLY "${slotTitle}" from this source`);
        textParts.push(`  Type: ${c.targetType}`);
        if (c.meta.src) textParts.push(`  URL: ${c.meta.src}`);
        if (c.meta.alt) textParts.push(`  Alt: ${c.meta.alt}`);
        if (c.meta.title) textParts.push(`  Title: ${c.meta.title}`);
        if (c.meta.textContent) textParts.push(`  Text: ${String(c.meta.textContent).slice(0, 500)}`);
        textParts.push('');
      });
    }
    if (hasImages) {
      textParts.push(`\nBelow are ${imageUrls.length} image(s) in slot order. For each image, extract ONLY the aspect assigned to it:`);
      ordered.forEach((c, i) => {
        const slotTitle = (c as { slotTitle?: string }).slotTitle || c.slotId;
        textParts.push(`  Image [${i + 1}] → ${slotTitle}`);
      });
      textParts.push(`\nIMPORTANT: generatedPrompt must be a SELF-CONTAINED prompt for image generation. NO references to "image 1", "image 2", "take from", "from the first image", etc. Only embed the extracted descriptions directly. The source images will NOT be attached to the prompt — only this text will be sent to the image generator.`);
    }
  }

  const userText = textParts.join('\n');

  const slotTitlesList = ordered.map((c) => (c as { slotTitle?: string }).slotTitle || c.slotId).join(', ');
  let systemPrompt: string;

  if (mode === 'motion') {
    systemPrompt = hasImages
      ? MOTION_PROMPT
      : 'Motion mode requires at least one linked video/GIF/canvas and captured frames. Connect a motion source and try again.';
  } else if (mode === 'merge') {
    systemPrompt = hasImages
      ? `${MERGE_INSTRUCTIONS}

CRITICAL: Every connected port MUST appear in generatedPrompt. Character, Material, Color, Style — ALL ports in this request. No exceptions. Never omit.
CRITICAL: generatedPrompt MUST be at least 250 words. Expand each part. Count words before replying.

Ports in this request: ${slotTitlesList}

CRITICAL 1:1 MAPPING — Image 1 = Character. SUBJECT = exactly from Image 1. Character can be object: suitcase, box, controller, machine. If Image 1 = suitcase → subject is "suitcase", NOT "man". If Image 1 = dog → "dog". NEVER substitute with man/human when Character image is an object. imageDescriptions[i] = ONLY from image i+1.

STRICT: Each port = ONLY its aspect from its image. Material port = texture. Color port = color names. Style port = visual style (graphic, illustration type, key elements). NEVER object names. NEVER mix images.

For EACH port: extract ONLY its aspect. IGNORE the rest.
- Character: ONLY the subject — who, form, pose, expression. If recognizable — NAME them. NO background, NO material, NO colors. STRICT: NO text — no "Yes sir", speech bubbles, captions, inscriptions, logos. If image has text — omit it entirely. Only visual subject.
- Material: ONLY texture/surface words. NEVER name the object. Keypad/buttons → "worn metallic surface with engraved letters and numbers, distressed finish, grayish-silver, tarnished steel". NOT "buttons", NOT "keypad". Shopping cart → "wireframe, metal mesh". Remote → "smooth plastic, matte". Describe the SURFACE in detail — do NOT say what the object is.
- Color: ONLY color names. NEVER character/object. Blue bear image → "blue, white, yellow, colorful accents". NOT "blue cartoon bear" or "bear with stars". Only: "blue, white, vibrant yellow, star accents".
OUTPUT FORMAT: Reply in JSON with imageDescriptions as array of plain strings. Each imageDescriptions[i] = extracted aspect for port i. Do NOT use DESCRIPTION/NEGATIVE_HINTS/TRACE blocks. Use plain strings only.

## MERGE RULES (by port intent — infer from port NAME per merge.md §8)
User can add any ports with custom names. Infer intent from name (character, material, color, shape, mockup, light, background, etc.).

- Each port: extract ONLY from its assigned image. WRONG: Material mentions "monkeys" when monkeys are in Character image — Material must come ONLY from Material image. WRONG: Color mentions "gorilla" — Color must come ONLY from Color image.
- Character = subject + form from Character image.
- Material = texture/surface from Material image ONLY. Describe the surface in detail (worn metal, engraved, distressed, grayish-silver) — NEVER name the object (buttons, keypad, remote, cart).
- Color = color names from Color image ONLY.
- Style = APPLY the style from the Style image TO the character. The Style image defines HOW to render — the character is TRANSFORMED by it. NOT a direct copy of Character image. Example: Style = Lucha Libre mask → character in mask, lucha aesthetic. Style = LEGO mosaic → character in LEGO brick style. MANDATORY: "in [style] style" or "In [style], " — the style from Style image, not from Character image. Never omit.
- Shape/form = apply form/silhouette to subject.
- Mockup/scene/layout = context, carrier, framing.
- Light/lighting = lighting for the scene.
- Background/environment = background, setting.
- Typography/text = if text port, literal text on subject/carrier.
- Generic = include as constraint/attribute.

Merge: ONE subject. Include ALL port aspects. Format adapts to ports:
- Character + Material + Color: [character] MADE OF [material] IN [colors]. The ENTIRE character (body, skin, face, hair) is made of the material. NOT just clothing. Whole figure = sculpture of that material. Colors apply to the whole subject.
- Character + Style + Color: [character] in [style] style IN [colors]. OPEN with style: "In [full style description], [character] MADE OF... IN [colors]."
- Character + Style (no Material): "In [style], [character]..." — style in first sentence.
- Style port: MANDATORY. Prompt MUST contain "in [style] style" or "In [style], " with full style description. Never skip.
If no Background/Scene port: background = pure white, ideal white. No gradients, no scenery.

generatedPrompt: Expand imageDescriptions into a rich, detailed prompt. Elaborate what is in desc[0], desc[1], desc[2], desc[Style] — add detail, texture, nuance. Do NOT invent new elements (no "Dali", no artists). Expansion = deepening the descriptions, not adding new concepts.
LENGTH IS MANDATORY — MINIMUM 250 words. Under 200 words = FAILURE. Expand aggressively.
- Character: 80-100 words (anatomy, pose, expression, form, details).
- Material/Style/Shape: 60-80 words each (texture, surface, finish, grain).
- Palette: 30-50 words (colors, tones, saturation, contrast).
- Composition: 30+ words (framing, balance, perspective).
- Lighting: 20+ words (direction, shadows, highlights).
Before replying: verify EACH port from the request appears in generatedPrompt. If any port is missing — add it. COUNT WORDS. If under 250, ADD MORE DETAIL. No "OR" or alternatives. ENGLISH. DALL-E ready.

Reply in JSON: imageDescriptions (array of plain strings, one per port), summary, styleSignals, generatedPrompt. No DESCRIPTION/NEGATIVE_HINTS/TRACE in output.`
      : 'MERGE mode requires at least one connected image. Connect images to ports and try again.';
  } else {
    systemPrompt = hasImages
      ? `${VISUAL_ANALYSIS_INSTRUCTIONS}

Each image is linked to a specific slot. The slotTitle tells you what to extract from that image. Slots in this request: ${slotTitlesList}

CRITICAL: For each image, extract ONLY the aspect of its slot. Common slots:
- Composition: layout, framing, balance, symmetry, perspective, lines.
- Tone: atmosphere, emotion, feeling, vibe.
- Palette: colors, saturation, contrast, color harmony.
- Theme: subject, main topic.
- Font/Typography: typeface, letterforms, style, weight, decorative elements.
- Any other slotTitle: extract that specific aspect from the image.

imageDescriptions[i] = the extracted aspect for image i (not a full description).

generatedPrompt: CRITICAL — the image must depict the USER'S PROMPT as the main subject. The attached images provide STYLE/ASPECTS to apply, NOT the subject.
- If user wrote "пицца" (pizza) → the image is OF PIZZA, styled with composition/palette/tone from the sources.
- If user wrote "черепаха" (turtle) → the image is OF A TURTLE, styled with the extracted aspects.
- NEVER describe the content of the source images as the main subject. Extract their composition, palette, tone — then APPLY those to the user's subject.

RULES:
1. MAIN SUBJECT = user prompt. The generated image depicts what the user asked for.
2. Apply extracted aspects (composition, palette, tone) FROM the sources TO the user's subject.
3. ENGLISH only. MINIMUM 200 words. Be EXTREMELY detailed — describe composition (framing, perspective, balance, symmetry, negative space), palette (exact colors, saturation, contrast, gradients), lighting (direction, soft/hard, shadows), mood (atmosphere, emotion), textures, style. No shortcuts.
4. NO "image 1", "take from". Self-contained for DALL-E.

Example: User "pizza" → "An image of a pizza as the central subject. Composition: [2-3 sentences on layout, framing, perspective]. Palette: [2-3 sentences on colors, tones, contrast]. Lighting: [1-2 sentences]. Mood: [1-2 sentences]. The pizza must be the clear main subject."

Reply in JSON: imageDescriptions, summary, styleSignals, generatedPrompt.`
      : 'You are an assistant that helps users create image concepts. Given a prompt and context from linked web page elements (e.g. image URLs, alt text, captions), respond with a short summary, style/mood signals, and a generated image prompt. Reply in JSON with keys: summary, styleSignals (array of strings), generatedPrompt. generatedPrompt MUST be in ENGLISH and maximally detailed (150-300 words).';
  }

  let userContent: MessageContent = userText;
  if (hasImages) {
    const capped = mode === 'motion' ? imageUrls.slice(0, PER_REQUEST_IMAGES) : imageUrls;
    if (mode === 'motion' && capped.length > 1) {
      const parts: MessageContent[0][] = [{ type: 'text' as const, text: userText }];
      const n = capped.length;
      capped.forEach((url, i) => {
        const label = i === 0 ? `\nFrame 1 (START of sequence):` : i === n - 1 ? `\nFrame ${n} (END of sequence):` : `\nFrame ${i + 1} (keyframe ${i + 1}/${n}):`;
        parts.push({ type: 'text' as const, text: label });
        parts.push({ type: 'image_url' as const, image_url: { url } });
      });
      userContent = parts;
    } else {
      userContent = [
        { type: 'text' as const, text: userText },
        ...capped.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
      ];
    }
  }

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];
}

const MOTION_SEGMENT_SYSTEM = `You are analyzing one segment of a UI motion sequence (same observation frame rules apply). Describe only what happens in the given frames: UI elements, motion type, timing. One concise paragraph. Ignore any blue rope/overlay. Reply with JSON only: {"segmentDescription": "..."}.`;

function buildMotionSegmentMessages(
  payload: AssistantSendRequestPayload,
  chunk: string[],
  segmentIndex: number,
  totalSegments: number
): Array<{ role: 'system' | 'user'; content: MessageContent }> {
  const safeChunk = chunk.slice(0, PER_REQUEST_IMAGES);
  const start = segmentIndex * PER_REQUEST_IMAGES + 1;
  const end = start + safeChunk.length - 1;
  let text = `Page: ${payload.page.title} (${payload.page.url})\nMODE: motion (segment ${segmentIndex + 1}/${totalSegments})\n`;
  const of = payload.observationFrame;
  if (of && typeof of.x === 'number' && typeof of.y === 'number') {
    text += `\nOBSERVATION FRAME: x=${of.x}, y=${of.y}, width=${of.width}, height=${of.height}. Analyze ONLY this region.\n`;
  }
  text += `\nThis is segment ${segmentIndex + 1} of ${totalSegments} (frames ${start}–${end}). Describe only what happens in these frames: UI elements, motion type, timing. One concise paragraph. Reply with JSON: {"segmentDescription": "..."}\n`;
  const parts: MessageContent[0][] = [{ type: 'text' as const, text }];
  safeChunk.forEach((url, i) => {
    parts.push({ type: 'text' as const, text: `\nFrame ${i + 1}:` });
    parts.push({ type: 'image_url' as const, image_url: { url } });
  });
  return [
    { role: 'system', content: MOTION_SEGMENT_SYSTEM },
    { role: 'user', content: parts },
  ];
}

function buildMotionSynthesisMessages(
  payload: AssistantSendRequestPayload,
  segmentDescriptions: string[]
): Array<{ role: 'system' | 'user'; content: string }> {
  let text = `Page: ${payload.page.title} (${payload.page.url})\nMODE: motion (synthesis)\n\n`;
  text += `The following are segment descriptions from one continuous motion sequence (in order). Synthesize them into ONE complete motion analysis.\n\n`;
  segmentDescriptions.forEach((desc, i) => {
    text += `Segment ${i + 1}: ${desc}\n\n`;
  });
  if (payload.prompt?.trim()) text += `User hint: ${payload.prompt.trim()}\n\n`;
  text += `Provide the full analysis: motion description, timeline, implementation spec, and generated prompt for recreating the effect.`;
  return [
    { role: 'system', content: MOTION_PROMPT },
    { role: 'user', content: text },
  ];
}

async function callAPI(
  payload: AssistantSendRequestPayload,
  apiKey: string,
  provider: 'openai' | 'groq'
): Promise<AssistantSendSuccessPayload['result']> {
  // Enforce API limit: never send more than 5 images from payload.images (content may send more).
  if (payload.mode === 'motion' && Array.isArray(payload.images) && payload.images.length > PER_REQUEST_IMAGES) {
    payload = { ...payload, images: payload.images.slice(0, PER_REQUEST_IMAGES) };
  }
  const imageUrls = getImageUrlsFromPayload(payload);
  const hasImages = imageUrls.length > 0;
  if (
    payload.mode === 'motion' &&
    imageUrls.length === 0 &&
    (Array.isArray(payload.images) ? payload.images.length > 0 : false)
  ) {
    throw {
      code: 'network' as AssistantErrorCode,
      message:
        'Все кадры отфильтрованы (некорректные данные изображений). Попробуйте снова: уменьшите область ROI или перезапишите запись.',
    };
  }
  const isMotionMulti = payload.mode === 'motion' && imageUrls.length > PER_REQUEST_IMAGES;
  // #region agent log
  const logBC = { sessionId: '62a955', location: 'index.ts:callAPI', message: 'after getImageUrlsFromPayload', data: { mode: payload.mode, payloadImagesLength: payload.images?.length ?? 0, imageUrlsLength: imageUrls.length, isMotionMulti, provider }, hypothesisId: 'B,C', timestamp: Date.now() };
  console.log('[motion-debug]', JSON.stringify(logBC));
  fetch('http://127.0.0.1:7912/ingest/44514764-7d00-4f93-8141-03f86e3272e2', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '62a955' }, body: JSON.stringify(logBC) }).catch(() => {});
  // #endregion
  const url = provider === 'groq' ? GROQ_API_URL : OPENAI_API_URL;
  const model =
    provider === 'groq'
      ? hasImages
        ? 'meta-llama/llama-4-scout-17b-16e-instruct'
        : 'llama-3.1-8b-instant'
      : 'gpt-4o-mini';
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  let content: string;
  if (isMotionMulti) {
    const chunks: string[][] = [];
    for (let i = 0; i < imageUrls.length; i += PER_REQUEST_IMAGES) {
      chunks.push(imageUrls.slice(i, i + PER_REQUEST_IMAGES));
    }
    const segmentDescriptions: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const segMessages = capMessagesImages(buildMotionSegmentMessages(payload, chunks[i], i, chunks.length));
      // #region agent log
      const logSeg = { sessionId: '62a955', location: 'index.ts:segmentFetch', message: 'before segment request', data: { segmentIndex: i, chunkLength: chunks[i].length, imagePartsInBody: countImagePartsInMessages(segMessages) }, hypothesisId: 'D', timestamp: Date.now() };
      console.log('[motion-debug]', JSON.stringify(logSeg));
      fetch('http://127.0.0.1:7912/ingest/44514764-7d00-4f93-8141-03f86e3272e2', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '62a955' }, body: JSON.stringify(logSeg) }).catch(() => {});
      // #endregion
      const segRes = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: segMessages,
          max_tokens: 2048,
          response_format: { type: 'json_object' as const },
        }),
      });
      if (!segRes.ok) {
        const text = await segRes.text();
        const debugSeg = `[Debug] path=segment segmentIndex=${i} chunkLength=${chunks[i].length} imagePartsInBody=${countImagePartsInMessages(segMessages)}`;
        if (segRes.status === 401) throw { code: 'auth' as AssistantErrorCode, message: 'Invalid or missing API key', debug: debugSeg };
        if (segRes.status === 429) throw { code: 'rate_limit' as AssistantErrorCode, message: 'Rate limit exceeded', debug: debugSeg };
        throw { code: 'network' as AssistantErrorCode, message: text || segRes.statusText, debug: debugSeg };
      }
      const segData = (await segRes.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const segContent = segData.choices?.[0]?.message?.content ?? '';
      let segDesc = '';
      try {
        const p = JSON.parse(segContent) as { segmentDescription?: string };
        segDesc = typeof p.segmentDescription === 'string' ? p.segmentDescription : segContent;
      } catch {
        segDesc = segContent;
      }
      segmentDescriptions.push(segDesc);
    }
    const synMessages = buildMotionSynthesisMessages(payload, segmentDescriptions);
    const synRes = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages: synMessages, max_tokens: 8192 }),
    });
    if (!synRes.ok) {
      const text = await synRes.text();
      if (synRes.status === 401) throw { code: 'auth' as AssistantErrorCode, message: 'Invalid or missing API key' };
      if (synRes.status === 429) throw { code: 'rate_limit' as AssistantErrorCode, message: 'Rate limit exceeded' };
      throw { code: 'network' as AssistantErrorCode, message: text || synRes.statusText };
    }
    const synData = (await synRes.json()) as { choices?: Array<{ message?: { content?: string } }> };
    content = synData.choices?.[0]?.message?.content ?? '';
  } else {
    const singleRequestImages = payload.mode === 'motion' ? imageUrls.slice(0, PER_REQUEST_IMAGES) : undefined;
    const messages = capMessagesImages(buildMessages(payload, singleRequestImages));
    // #region agent log
    const logSingle = { sessionId: '62a955', location: 'index.ts:singleFetch', message: 'before single request', data: { singleRequestImagesLength: singleRequestImages?.length ?? 0, imageUrlsLength: imageUrls.length, imagePartsInBody: countImagePartsInMessages(messages) }, hypothesisId: 'C,D', timestamp: Date.now() };
    console.log('[motion-debug]', JSON.stringify(logSingle));
    fetch('http://127.0.0.1:7912/ingest/44514764-7d00-4f93-8141-03f86e3272e2', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '62a955' }, body: JSON.stringify(logSingle) }).catch(() => {});
    // #endregion
    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: 8192,
      ...(payload.mode !== 'motion' ? { response_format: { type: 'json_object' as const } } : {}),
    };
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      const debugSingle = `[Debug] path=single imageUrlsLength=${imageUrls.length} singleRequestImagesLength=${singleRequestImages?.length ?? 0} imagePartsInBody=${countImagePartsInMessages(messages)}`;
      const isModelNotFound =
        res.status === 400 &&
        /model_not_found|does not exist|do not have access/i.test(text);
      if (
        isModelNotFound &&
        provider === 'groq' &&
        model === 'meta-llama/llama-4-scout-17b-16e-instruct'
      ) {
        const payloadWithoutImages: AssistantSendRequestPayload = {
          ...payload,
          connections: payload.connections.map((c) => ({
            ...c,
            meta: { ...c.meta, src: undefined },
          })),
          images: [],
        };
        return callAPI(payloadWithoutImages, apiKey, provider);
      }
      if (res.status === 401) throw { code: 'auth' as AssistantErrorCode, message: 'Invalid or missing API key', debug: debugSingle };
      if (res.status === 429) throw { code: 'rate_limit' as AssistantErrorCode, message: 'Rate limit exceeded', debug: debugSingle };
      throw { code: 'network' as AssistantErrorCode, message: text || res.statusText, debug: debugSingle };
    }

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    content = data.choices?.[0]?.message?.content ?? '';
  }

  if (!content) throw { code: 'invalid_payload' as AssistantErrorCode, message: 'Empty response from API' };

  const apiError = (() => {
    try {
      const p = JSON.parse(content) as { error?: { message?: string } };
      if (p?.error?.message) return p.error.message;
    } catch {
      /* ignore */
    }
    return null;
  })();
  if (apiError) {
    const debugLine = `[Debug] path=single imageUrlsLength=${imageUrls.length}`;
    throw { code: 'network' as AssistantErrorCode, message: apiError, debug: debugLine };
  }

  try {
    let parsed = JSON.parse(content) as Record<string, unknown>;
    const summary = typeof parsed.summary === 'string' ? parsed.summary : undefined;
    const styleSignals = Array.isArray(parsed.styleSignals)
      ? (parsed.styleSignals as string[])
      : undefined;
    let imageDescriptions = Array.isArray(parsed.imageDescriptions)
      ? (parsed.imageDescriptions as string[]).filter((s): s is string => typeof s === 'string').map(extractDescriptionFromMergeFormat)
      : undefined;
    if ((!imageDescriptions || imageDescriptions.length === 0) && Array.isArray(parsed.ports)) {
      const ordered = getConnectionsBySlotOrder(payload);
      const ports = parsed.ports as Array<{ portName?: string; description?: string }>;
      imageDescriptions = ordered.map((c, i) => {
        const slotTitle = ((c as { slotTitle?: string }).slotTitle || c.slotId).toLowerCase();
        const byIndex = ports[i]?.description;
        const raw = byIndex ?? ports.find((p) => p.portName && slotTitle && p.portName.toLowerCase().includes(slotTitle))?.description ?? '';
        return extractDescriptionFromMergeFormat(raw);
      });
    }
    if ((!imageDescriptions || imageDescriptions.length === 0) && parsed.imageDescriptions && typeof parsed.imageDescriptions === 'object' && !Array.isArray(parsed.imageDescriptions)) {
      const ordered = getConnectionsBySlotOrder(payload);
      const obj = parsed.imageDescriptions as Record<string, string>;
      imageDescriptions = ordered.map((c) => {
        const slotTitle = (c as { slotTitle?: string }).slotTitle || c.slotId;
        return obj[slotTitle] ?? obj[slotTitle.toLowerCase()] ?? '';
      }).filter((s) => typeof s === 'string' && s.length > 0);
    }
    const motionDescription = typeof parsed.motionDescription === 'string' ? parsed.motionDescription : undefined;
    const structured = parsed.structured && typeof parsed.structured === 'object'
      ? (parsed.structured as Record<string, unknown>)
      : undefined;
    let generatedPrompt = typeof parsed.generatedPrompt === 'string' ? parsed.generatedPrompt : undefined;
    if (!generatedPrompt && typeof (parsed as { prompt?: string }).prompt === 'string') {
      generatedPrompt = (parsed as { prompt: string }).prompt;
    }
    if (!generatedPrompt && content) {
      const m = content.match(/"generatedPrompt"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m) generatedPrompt = m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
    }
    if (!generatedPrompt && content) {
      const m = content.match(/"prompt"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m) generatedPrompt = m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
    }
    if (!generatedPrompt && content) {
      const m = content.match(/\*\*Generated Image Prompt\*\*[:\s]*([\s\S]*?)(?=\n\s*\*\*|\n\s*"|$)/i);
      if (m) generatedPrompt = m[1].trim();
    }
    if (!generatedPrompt && imageDescriptions?.length) {
      const ordered = getConnectionsBySlotOrder(payload);
      if (ordered.length > 0) {
        const mode = payload.mode ?? 'compile';
        if (mode === 'merge' && ordered.length >= 3) {
          const [char, mat, col] = [imageDescriptions[0] ?? '', imageDescriptions[1] ?? '', imageDescriptions[2] ?? ''];
          if (char && mat && col) {
            generatedPrompt = `${char} MADE OF ${mat} IN ${col}.`;
          } else {
            generatedPrompt = imageDescriptions.filter(Boolean).join('; ');
          }
        } else if (mode === 'merge') {
          generatedPrompt = imageDescriptions.filter(Boolean).join('; ');
        } else {
          const parts: string[] = [`Create an image of ${payload.prompt ?? ''}. Apply the following aspects from the reference images:`];
          ordered.forEach((c, i) => {
            const slotTitle = (c as { slotTitle?: string }).slotTitle || c.slotId;
            const desc = imageDescriptions[i] ?? '';
            if (desc) parts.push(`${slotTitle}: ${desc}`);
          });
          if (styleSignals?.length) parts.push(`Style: ${styleSignals.join(', ')}.`);
          generatedPrompt = parts.join('\n\n');
        }
      }
    }
    if (generatedPrompt && payload.mode === 'merge') {
      generatedPrompt = normalizeMergePrompt(generatedPrompt);
      const ordered = getConnectionsBySlotOrder(payload);
      const hasColorPort = ordered.some((c) => /color|colour|palette|цвет|палитра/i.test((c as { slotTitle?: string }).slotTitle || c.slotId || ''));
      const hasBackgroundPort = ordered.some((c) => /background|scene|фон|бэкграунд|setting|environment/i.test((c as { slotTitle?: string }).slotTitle || c.slotId || ''));
      if (hasColorPort) {
        generatedPrompt = sanitizePromptMaterialColors(generatedPrompt);
        if (imageDescriptions?.length && ordered.length) {
          imageDescriptions = imageDescriptions.map((desc, i) => {
            const slotTitle = ((ordered[i] as { slotTitle?: string })?.slotTitle || ordered[i]?.slotId || '').toString();
            if (/material|материал|texture|текстура/i.test(slotTitle)) return stripColorFromMaterial(desc);
            return desc;
          });
        }
      }
      if (!hasBackgroundPort) generatedPrompt = enforceWhiteBackground(generatedPrompt);
    }
    const baseResult: AssistantSendSuccessPayload['result'] = {
      summary,
      styleSignals,
      imageDescriptions,
      generatedPrompt,
      text: content,
    };
    if (motionDescription) baseResult.motionDescription = motionDescription;
    if (structured) baseResult.structured = structured;
    const selPhase = parsed.phase === 'selection';
    const selCandidates = Array.isArray(parsed.candidates)
      ? (parsed.candidates as Array<{ id?: string; label?: string; description?: string }>)
          .filter((c) => c && typeof c.id === 'string' && typeof c.label === 'string')
          .map((c) => ({ id: c.id!, label: c.label!, description: typeof c.description === 'string' ? c.description : undefined }))
      : undefined;
    if (selPhase && selCandidates?.length) {
      baseResult.motionPhase = 'selection';
      baseResult.motionCandidates = selCandidates;
      baseResult.motionQuestion = typeof parsed.question === 'string' ? parsed.question : 'Which element should I analyze?';
    }
    return baseResult;
  } catch {
    const fallback = payload.mode === 'motion' ? extractMotionFromText(content) : extractFromText(content);
    const result = fallback ?? { text: content };
    if (!result.generatedPrompt && result.imageDescriptions?.length) {
      const ordered = getConnectionsBySlotOrder(payload);
      const mode = payload.mode ?? 'compile';
      if (mode === 'merge' && ordered.length >= 3) {
        const [char, mat, col] = [result.imageDescriptions![0] ?? '', result.imageDescriptions![1] ?? '', result.imageDescriptions![2] ?? ''];
        if (char && mat && col) {
          result.generatedPrompt = `${char} MADE OF ${mat} IN ${col}.`;
        } else {
          result.generatedPrompt = result.imageDescriptions!.filter(Boolean).join('; ');
        }
      } else if (mode === 'merge') {
        result.generatedPrompt = result.imageDescriptions!.filter(Boolean).join('; ');
      } else {
        const parts: string[] = [`Create an image of ${payload.prompt ?? ''}. Apply the following aspects from the reference images:`];
        ordered.forEach((c, i) => {
          const slotTitle = (c as { slotTitle?: string }).slotTitle || c.slotId;
          const desc = result.imageDescriptions![i] ?? '';
          if (desc) parts.push(`${slotTitle}: ${desc}`);
        });
        if (result.styleSignals?.length) parts.push(`Style: ${result.styleSignals.join(', ')}.`);
        result.generatedPrompt = parts.join('\n\n');
      }
    }
    if (result.generatedPrompt && payload.mode === 'merge') {
      result.generatedPrompt = normalizeMergePrompt(result.generatedPrompt);
      const ordered = getConnectionsBySlotOrder(payload);
      const hasColorPort = ordered.some((c) => /color|colour|palette|цвет|палитра/i.test((c as { slotTitle?: string }).slotTitle || c.slotId || ''));
      const hasBackgroundPort = ordered.some((c) => /background|scene|фон|бэкграунд|setting|environment/i.test((c as { slotTitle?: string }).slotTitle || c.slotId || ''));
      if (hasColorPort) {
        result.generatedPrompt = sanitizePromptMaterialColors(result.generatedPrompt);
        if (result.imageDescriptions?.length && ordered.length) {
          result.imageDescriptions = result.imageDescriptions.map((desc, i) => {
            const slotTitle = ((ordered[i] as { slotTitle?: string })?.slotTitle || ordered[i]?.slotId || '').toString();
            if (/material|материал|texture|текстура/i.test(slotTitle)) return stripColorFromMaterial(desc);
            return desc;
          });
        }
      }
      if (!hasBackgroundPort) result.generatedPrompt = enforceWhiteBackground(result.generatedPrompt);
    }
    return result;
  }
}

function extractMotionFromText(text: string): AssistantSendSuccessPayload['result'] | null {
  if (!text?.trim()) return null;
  let motionDesc = text.match(/"motionDescription"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1]?.replace(/\\"/g, '"').replace(/\\n/g, '\n')
    ?? text.match(/(?:motionDescription|Motion Description)[:\s]*([^\n*"][^\n]*)/i)?.[1]?.trim();
  if (!motionDesc) motionDesc = text;
  let structured: Record<string, unknown> | undefined;
  const codeBlocks = text.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/g);
  for (const m of codeBlocks) {
    const block = m[1]?.trim();
    if (!block?.startsWith('{')) continue;
    try {
      const s = JSON.parse(block);
      if (s && typeof s === 'object' && ('animation_type' in s || 'timeline' in s || 'elements' in s)) {
        structured = s as Record<string, unknown>;
        break;
      }
    } catch {}
  }
  if (!structured) {
    const braceMatch = text.match(/\{\s*"animation_type"\s*:[\s\S]*\}/);
    if (braceMatch) {
      try {
        const s = JSON.parse(braceMatch[0]);
        if (s && typeof s === 'object') structured = s as Record<string, unknown>;
      } catch {}
    }
  }
  return { motionDescription: motionDesc, structured, text };
}

function extractFromText(text: string): AssistantSendSuccessPayload['result'] | null {
  if (!text?.trim()) return null;
  const summary = text.match(/(?:summary|Summary|\*\*Summary\*\*)[:\s]*([^\n*]+)/i)?.[1]?.trim();
  let prompt = text.match(/"generatedPrompt"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1]?.replace(/\\"/g, '"').replace(/\\n/g, '\n');
  if (!prompt) prompt = text.match(/(?:generatedPrompt|Generated Image Prompt|\*\*Generated Image Prompt\*\*)[:\s]*([^\n*]+)/i)?.[1]?.trim();
  const styleMatch = text.match(/(?:styleSignals|Style)[:\s]*\[([^\]]+)\]/i);
  const styleSignals = styleMatch
    ? styleMatch[1].split(',').map((s) => s.replace(/^["'\s]+|["'\s]+$/g, '').trim()).filter(Boolean)
    : undefined;
  const imageDescMatch = text.match(/(?:imageDescriptions)[:\s]*\[([\s\S]*?)\]/);
  const imageDescriptions = imageDescMatch
    ? imageDescMatch[1].split(/,(?=")/).map((s) => s.replace(/^["'\s]+|["'\s]+$/g, '').trim()).filter(Boolean)
    : undefined;
  if (summary || prompt || styleSignals?.length || imageDescriptions?.length) {
    return { summary, generatedPrompt: prompt, styleSignals, imageDescriptions, text };
  }
  return null;
}

async function callDallE(
  prompt: string,
  apiKey: string
): Promise<string | undefined> {
  const res = await fetch(OPENAI_IMAGES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt: prompt.slice(0, 1000),
      n: 1,
      size: '1024x1024',
      response_format: 'url',
      quality: 'standard',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }

  const data = (await res.json()) as { data?: Array<{ url?: string }> };
  return data.data?.[0]?.url;
}

async function callExpandPrompt(
  prompt: string,
  apiKey: string,
  provider: 'openai' | 'groq'
): Promise<string> {
  const url = provider === 'groq' ? GROQ_API_URL : OPENAI_API_URL;
  const model = provider === 'groq' ? 'llama-3.1-8b-instant' : 'gpt-4o-mini';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content:
            'Expand the prompt to 250+ words. Preserve structure. If prompt has "in X style" — keep and expand the style. CRITICAL: ENTIRE character = material (body, skin, face). NOT just clothes. ADD: character details, material texture, style description, color palette, composition, lighting. Output ONLY the expanded prompt, no JSON, no quotes.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 2048,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  return content ?? prompt;
}

function sendError(code: AssistantErrorCode, message: string): AssistantSendErrorPayload {
  return { ok: false, error: message, code };
}

chrome.runtime.onMessage.addListener(
  (
    msg: { type: string; payload?: AssistantSendRequestPayload },
    sender: chrome.runtime.MessageSender,
    sendResponse: (r: AssistantSendSuccessPayload | AssistantSendErrorPayload | { dataUrl: string }) => void
  ) => {
    if (msg.type === MESSAGE_TYPES.CAPTURE_VISIBLE_TAB) {
      chrome.tabs.captureVisibleTab(undefined, { format: 'jpeg', quality: 90 })
        .then((dataUrl) => sendResponse({ dataUrl }))
        .catch((err) => sendResponse({ ok: false, error: String(err), code: 'unknown' } as AssistantSendErrorPayload));
      return true;
    }
    if (msg.type !== MESSAGE_TYPES.ASSISTANT_SEND_REQUEST) return;
    const payload = msg.payload;
    if (!payload || !payload.page?.url) {
      sendResponse(sendError('invalid_payload', 'Missing page URL'));
      return true;
    }
    const mode = payload.mode ?? 'compile';
    if (mode === 'compile' && (typeof payload.prompt !== 'string' || !payload.prompt?.trim())) {
      sendResponse(sendError('invalid_payload', 'Compile mode requires a prompt'));
      return true;
    }
    if (mode === 'merge') {
      const imageUrls = getImageUrlsFromPayload(payload);
      if (imageUrls.length === 0) {
        sendResponse(sendError('invalid_payload', 'Merge mode requires at least one connected image'));
        return true;
      }
    }
    if (mode === 'motion') {
      const imageUrls = getImageUrlsFromPayload(payload);
      if (payload.connections.length === 0) {
        sendResponse(sendError('invalid_payload', 'Motion mode requires at least one connected video/GIF/canvas'));
        return true;
      }
      if (imageUrls.length === 0) {
        sendResponse(sendError('invalid_payload', 'Motion mode requires captured frames. Connect a video, GIF, or canvas and try again.'));
        return true;
      }
    }

    (async () => {
      const settings = await getSettings();
      const apiKey = settings.apiKey?.trim();
      const provider = settings.provider ?? 'groq';
      if (!apiKey) {
        sendResponse(sendError('auth', 'API key not set. Open extension options to add your API key.'));
        return;
      }
      try {
        let result = await callAPI(payload, apiKey, provider);
        if (
          mode === 'merge' &&
          result.generatedPrompt &&
          (settings.expandShortPrompts !== false) &&
          result.generatedPrompt.split(/\s+/).filter(Boolean).length < 200
        ) {
          try {
            const expanded = await callExpandPrompt(result.generatedPrompt, apiKey, provider);
            result = { ...result, generatedPrompt: normalizeMergePrompt(expanded) };
          } catch (expandErr) {
            result.text = (result.text ?? '') + '\n\n[Expand error: ' + String(expandErr) + ']';
          }
        }
        if (provider === 'openai' && result.generatedPrompt && apiKey && mode !== 'motion') {
          try {
            const imageUrl = await callDallE(result.generatedPrompt, apiKey);
            if (imageUrl) result.imageUrl = imageUrl;
          } catch (imgErr) {
            result.text = (result.text ?? '') + '\n\n[Image generation error: ' + String(imgErr) + ']';
          }
        }
        sendResponse({ ok: true, result, usage: { cached: false } });
      } catch (err: unknown) {
        const e = err as { code?: AssistantErrorCode; message?: string; debug?: string };
        const msg = (e.message ?? String(err)) + (e.debug ? '\n\n' + e.debug : '');
        sendResponse(sendError(e.code ?? 'unknown', msg));
      }
    })();

    return true;
  }
);
