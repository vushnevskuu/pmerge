/**
 * Parsing utilities for merge mode — testable.
 */

/** Color words to strip from Material when Color port exists */
const MATERIAL_COLOR_WORDS = /\b(red|blue|yellow|green|pink|black|white|teal|orange|bright\s+red)\b/gi;

/** Strip color words from Material description (when Color port exists) */
export function stripColorFromMaterial(text: string): string {
  if (!text || typeof text !== 'string') return '';
  const s = text.replace(MATERIAL_COLOR_WORDS, ' ').replace(/\s+/g, ' ').trim();
  const cleaned = s.replace(/\s*,\s*,/g, ',').replace(/^[\s,]+|[\s,]+$/g, '').trim();
  return cleaned || text;
}

/** Replace Material color leakage in prompt: "red rubber" → "rubber", etc. */
export function sanitizePromptMaterialColors(prompt: string): string {
  if (!prompt || typeof prompt !== 'string') return prompt;
  return prompt
    .replace(/\b(?:bright\s+)?(?:glossy\s+)?(?:smooth\s+)?(?:matte\s+)?red\s+rubber\b/gi, 'smooth rubber')
    .replace(/\b(?:bright\s+)?red\s+rubber\b/gi, 'rubber')
    .replace(/\bred\s+rubber\b/gi, 'rubber')
    .replace(/\b(?:smooth|glossy)\s+red\s+rubber/gi, 'smooth rubber')
    .replace(/\byellow\s+cartoon\s+dog\b/gi, 'cartoon dog')
    .replace(/\b(bright\s+)?(glossy\s+)?red\s+surface\b/gi, 'glossy surface')
    .replace(/\s{2,}/g, ' ');
}

/** When no Background port: ensure white background in prompt. Replace invented dark/dramatic background. */
export function enforceWhiteBackground(prompt: string): string {
  if (!prompt || typeof prompt !== 'string') return prompt;
  const hasWhiteBg = /\b(plain\s+)?white\s+background\b|\bon\s+white\s+background\b/i.test(prompt);
  if (hasWhiteBg) return prompt;
  let s = prompt
    .replace(/\b(dim|fiery|dark|dramatic)\s+(and\s+)?(fiery|dramatic)?\s*lighting\s+of\s+the\s+scene\b/gi, 'even lighting on plain white background')
    .replace(/\b(black|dark)\s+background\b/gi, 'plain white background')
    .replace(/\bdramatic\s+background\b/gi, 'plain white background');
  if (!/\b(plain\s+)?white\s+background\b/i.test(s)) s = s.trimEnd() + (s.endsWith('.') ? ' ' : '. ') + 'Plain white background.';
  return s.replace(/\s{2,}/g, ' ');
}

export function extractDescriptionFromMergeFormat(s: string): string {
  if (!s || typeof s !== 'string') return '';
  const d = s.match(/DESCRIPTION:\s*(.+?)(?=\s*(?:NEGATIVE[_\s]?HINTS|TRACE):|$)/is);
  if (d) return d[1].trim();
  if (/^(NEGATIVE[_\s]?HINTS|TRACE):/i.test(s.trim())) return '';
  return s.trim();
}

export function normalizeMergePrompt(p: string): string {
  let s = p.replace(/\bTN\b/gi, 'IN');
  const fixes: [RegExp, string][] = [
    [/captats'?s?/gi, "captain's"],
    [/bouing/gi, 'boxing'],
    [/glace/gi, 'glass'],
    [/\bgrus\b/gi, 'green'],
    [/\bdate\b/gi, 'dark'],
    [/\bemoner\b/gi, 'smooth'],
    [/\bdect\b/gi, 'deck'],
  ];
  for (const [re, rep] of fixes) s = s.replace(re, rep);
  return s;
}
