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
import { VISUAL_ANALYSIS_INSTRUCTIONS } from './visualInstructions';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const STORAGE_KEY = 'ai_assistant_settings';

interface StoredSettings {
  apiKey?: string;
  provider?: 'openai' | 'groq';
}

async function getSettings(): Promise<StoredSettings> {
  const raw = await chrome.storage.local.get(STORAGE_KEY);
  return (raw[STORAGE_KEY] as StoredSettings) ?? {};
}

const MAX_IMAGES = 5;

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
  const ordered = getConnectionsBySlotOrder(payload);
  for (const c of ordered) {
    const src = c.meta?.src;
    if (typeof src === 'string' && /^https?:\/\//i.test(src) && !seen.has(src)) {
      seen.add(src);
      urls.push(src);
      if (urls.length >= MAX_IMAGES) break;
    }
  }
  if (payload.images?.length) {
    for (const img of payload.images) {
      if (typeof img === 'string' && (img.startsWith('data:image') || /^https?:\/\//i.test(img))) {
        if (!seen.has(img)) {
          seen.add(img);
          urls.push(img);
          if (urls.length >= MAX_IMAGES) break;
        }
      }
    }
  }
  return urls;
}

type MessageContent = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;

function buildMessages(payload: AssistantSendRequestPayload): Array<{ role: 'system' | 'user'; content: MessageContent }> {
  const ordered = getConnectionsBySlotOrder(payload);
  const imageUrls = getImageUrlsFromPayload(payload);
  const hasImages = imageUrls.length > 0;

  const textParts: string[] = [];
  textParts.push(`Page: ${payload.page.title} (${payload.page.url})\n`);
  textParts.push(`USER PROMPT (MAIN SUBJECT — the image MUST depict this): "${payload.prompt}"\n`);
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
  const userText = textParts.join('\n');

  const slotTitlesList = ordered.map((c) => (c as { slotTitle?: string }).slotTitle || c.slotId).join(', ');
  const systemPrompt = hasImages
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

  let userContent: MessageContent = userText;
  if (hasImages) {
    userContent = [
      { type: 'text' as const, text: userText },
      ...imageUrls.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
    ];
  }

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];
}

async function callAPI(
  payload: AssistantSendRequestPayload,
  apiKey: string,
  provider: 'openai' | 'groq'
): Promise<AssistantSendSuccessPayload['result']> {
  const messages = buildMessages(payload);
  const hasImages = getImageUrlsFromPayload(payload).length > 0;
  const url = provider === 'groq' ? GROQ_API_URL : OPENAI_API_URL;
  const model =
    provider === 'groq'
      ? hasImages
        ? 'meta-llama/llama-4-scout-17b-16e-instruct'
        : 'llama-3.1-8b-instant'
      : 'gpt-4o-mini';
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: 4096,
    response_format: { type: 'json_object' },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
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
    if (res.status === 401) throw { code: 'auth' as AssistantErrorCode, message: 'Invalid or missing API key' };
    if (res.status === 429) throw { code: 'rate_limit' as AssistantErrorCode, message: 'Rate limit exceeded' };
    throw { code: 'network' as AssistantErrorCode, message: text || res.statusText };
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw { code: 'invalid_payload' as AssistantErrorCode, message: 'Empty response from API' };

  try {
    let parsed = JSON.parse(content) as Record<string, unknown>;
    const summary = typeof parsed.summary === 'string' ? parsed.summary : undefined;
    const styleSignals = Array.isArray(parsed.styleSignals)
      ? (parsed.styleSignals as string[])
      : undefined;
    const imageDescriptions = Array.isArray(parsed.imageDescriptions)
      ? (parsed.imageDescriptions as string[]).filter((s): s is string => typeof s === 'string')
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
        const parts: string[] = [`Create an image of ${payload.prompt}. Apply the following aspects from the reference images:`];
        ordered.forEach((c, i) => {
          const slotTitle = (c as { slotTitle?: string }).slotTitle || c.slotId;
          const desc = imageDescriptions[i] ?? '';
          if (desc) parts.push(`${slotTitle}: ${desc}`);
        });
        if (styleSignals?.length) parts.push(`Style: ${styleSignals.join(', ')}.`);
        generatedPrompt = parts.join('\n\n');
      }
    }
    return {
      summary,
      styleSignals,
      imageDescriptions,
      generatedPrompt,
      text: content,
    };
  } catch {
    const fallback = extractFromText(content);
    const result = fallback ?? { text: content };
    if (!result.generatedPrompt && result.imageDescriptions?.length) {
      const ordered = getConnectionsBySlotOrder(payload);
      const parts: string[] = [`Create an image of ${payload.prompt}. Apply the following aspects from the reference images:`];
      ordered.forEach((c, i) => {
        const slotTitle = (c as { slotTitle?: string }).slotTitle || c.slotId;
        const desc = result.imageDescriptions![i] ?? '';
        if (desc) parts.push(`${slotTitle}: ${desc}`);
      });
      if (result.styleSignals?.length) parts.push(`Style: ${result.styleSignals.join(', ')}.`);
      result.generatedPrompt = parts.join('\n\n');
    }
    return result;
  }
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

function sendError(code: AssistantErrorCode, message: string): AssistantSendErrorPayload {
  return { ok: false, error: message, code };
}

chrome.runtime.onMessage.addListener(
  (
    msg: { type: string; payload?: AssistantSendRequestPayload },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (r: AssistantSendSuccessPayload | AssistantSendErrorPayload) => void
  ) => {
    if (msg.type !== MESSAGE_TYPES.ASSISTANT_SEND_REQUEST) return;
    const payload = msg.payload;
    if (!payload || typeof payload.prompt !== 'string' || !payload.page?.url) {
      sendResponse(sendError('invalid_payload', 'Missing prompt or page URL'));
      return true;
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
        const result = await callAPI(payload, apiKey, provider);
        if (provider === 'openai' && result.generatedPrompt && apiKey) {
          try {
            const imageUrl = await callDallE(result.generatedPrompt, apiKey);
            if (imageUrl) result.imageUrl = imageUrl;
          } catch (imgErr) {
            result.text = (result.text ?? '') + '\n\n[Image generation error: ' + String(imgErr) + ']';
          }
        }
        sendResponse({ ok: true, result, usage: { cached: false } });
      } catch (err: unknown) {
        const e = err as { code?: AssistantErrorCode; message?: string };
        sendResponse(sendError(e.code ?? 'unknown', e.message ?? String(err)));
      }
    })();

    return true;
  }
);
