import * as esbuild from 'esbuild';
import { readdirSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

function generateMergeInstructions() {
  const mergePath = join(__dirname, 'merge.md');
  const outPath = join(__dirname, 'src/background/mergeInstructions.generated.ts');
  let content = '';
  try {
    content = readFileSync(mergePath, 'utf-8')
      .replace(/^`{3,}markdown?\n?/, '')
      .replace(/\n?`{3,}\s*$/, '')
      .trim();
  } catch {
    content = '# PORT_DESCRIBER — fallback (merge.md not found)';
  }
  const escaped = content.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  const out = `/** Auto-generated from merge.md — do not edit */\nexport const MERGE_INSTRUCTIONS = \`${escaped}\` + \`

## MERGE RULES (infer intent from port NAME — merge.md §8)
EACH port: extract ONLY its aspect. Character from Character image. Material from Material image ONLY (not from Color image!). Color from Color image ONLY (not from Material image!). Strict 1:1 mapping. Do NOT add source objects.

## MATERIAL PORT — zero color words
Material imageDescriptions: texture/surface ONLY. ZERO color words. WRONG: "red rubber", "smooth glossy red rubber surface", "bright red". CORRECT: "smooth glossy rubber surface, textured, flexible". Never use red, blue, yellow, black, etc. in Material.

## BACKGROUND (independent of Color)
If no Background/Scene port: background = pure white. MANDATORY: include "plain white background" or "on pure white background" in generatedPrompt. NEVER invent dark, dim, fiery, black, or dramatic background — only white.

## COLOR RULE (CRITICAL — for subject only, NOT background)
**If Color port exists:** colors (of subject) = ONLY from Color image. Character and Material give NO colors.
**If Color port does NOT exist:** colors = all visible colors from connected images.

## COLOR PORT — when connected
Extract colors ONLY from the Color image. All dominant colors from that image. Teal bear → "teal, black, yellow, pink, green". Dog → "yellow, black, red". No character names, only color names.

## CHARACTER / MATERIAL — color depends on Color port
**When Color port exists:** Character and Material = NO color. Character: form, pose only. Material: texture only.
**When Color port does NOT exist:** Character and Material may include visible colors (for prompt).

## COLOR SOURCE
**If Color port exists:** colors in generatedPrompt = ONLY from Color (desc[2]). NEVER from Character or Material.
**If Color port does NOT exist:** colors = all visible/noticeable colors from connected images (Character, Material, etc.).

## generatedPrompt FORMAT (CRITICAL — ADAPT TO PORTS)
MANDATORY: Every connected port MUST appear in generatedPrompt. Character, Material, Color, Style, Shape, Light, Background — ALL that are in the request. No exceptions. Never omit a port. MIN 250 words.

**If ports = Character, Material, Color:** [character] MADE OF [material] IN [colors]. Subject = EXACTLY from Image 1 (Character). If Image 1 = suitcase → "suitcase MADE OF...". If Image 1 = dog → "dog...". If Image 1 = controller → "controller...". NEVER "man" when Character image is an object (suitcase, box, machine).
**If ports include Style:** APPLY the style from the Style image TO the character. Style = transformation, not copy. Character is RENDERED in that style. "In [style from Style image], [character]..." — use Style image's style, NOT Character image's style. NEVER omit. Character: NO text (speech bubbles, captions, inscriptions).
**Character + Style + Color:** [character] in [style] style IN [colors]. Open with style: "In [style], [character]..."
**Character + Style (no Material):** "In [style], [character]..." — style FIRST.
**If ports include material:** "MADE OF [material]".
**If ports include color:** "IN [colors]".

- Material = ENTIRE character body. NOT clothing, NOT armor. Figure = sculpture. Material port: SURFACE only. Color port: ONLY color names. NEVER "blue bear" or "cartoon character" — only "blue, white, yellow". If image has a character, output its COLORS, not the character.
- Style/Shape = visual style. MUST be embedded. Never skip.
- If no Background/Scene port: background = pure white. MUST say "plain white background" or "on pure white background". Do NOT describe dim, fiery, black, or dramatic background.
- Character: NO text from image. Material: ONLY texture. Color: ONLY color names.

## generatedPrompt = expansion of imageDescriptions
generatedPrompt = expand desc[0], desc[1], desc[2], desc[Style] into a rich, detailed prompt (250+ words). Expand by elaborating what is in the descriptions — add detail, texture, nuance. Do NOT add elements that are NOT in the descriptions (no "inspired by Dali", no invented artists). Expansion = deepening, not inventing.

**Character source:** Subject = EXACTLY from Character image (Image 1, desc[0]). Character can be person, animal, object, machine, suitcase, box. If Image 1 = suitcase → subject is "suitcase", NOT "man". If Image 1 = dog → "dog". If Image 1 = controller → "controller". NEVER substitute with "man"/"human"/"person" when Character image shows an object. Use desc[0] verbatim.

## JSON OUTPUT (required)
Reply in JSON: ports, imageDescriptions, generatedPrompt, summary, styleSignals.
\`;\n`;
  writeFileSync(outPath, out);
}

async function build() {
  generateMergeInstructions();
  const outDir = join(__dirname, 'dist');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const common = {
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome100'],
    sourcemap: true,
    define: { 'process.env.NODE_ENV': '"production"' },
  };
  await Promise.all([
    esbuild.build({ ...common, entryPoints: ['src/background/index.ts'], outfile: join(outDir, 'background.js') }),
    esbuild.build({ ...common, entryPoints: ['src/content/index.ts'], outfile: join(outDir, 'content.js') }),
    esbuild.build({ ...common, entryPoints: ['src/options/index.ts'], outfile: join(outDir, 'options.js') }),
  ]);
}

if (watch) {
  generateMergeInstructions();
  const common = {
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome100'],
    sourcemap: true,
  };
  const ctx1 = await esbuild.context({ ...common, entryPoints: ['src/background/index.ts'], outfile: join(__dirname, 'dist', 'background.js') });
  const ctx2 = await esbuild.context({ ...common, entryPoints: ['src/content/index.ts'], outfile: join(__dirname, 'dist', 'content.js') });
  const ctx3 = await esbuild.context({ ...common, entryPoints: ['src/options/index.ts'], outfile: join(__dirname, 'dist', 'options.js') });
  await Promise.all([ctx1.watch(), ctx2.watch(), ctx3.watch()]);
  console.log('Watching...');
} else {
  build().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
