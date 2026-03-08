/**
 * MERGE mode instructions — generated from merge.md at build time.
 * See build.mjs: generateMergeInstructions()
 * This file is a fallback when mergeInstructions.generated.ts doesn't exist yet.
 */

export const MERGE_INSTRUCTIONS = `# PORT_DESCRIBER — fallback (run npm run build to generate from merge.md)

Reply in JSON: ports, imageDescriptions, generatedPrompt.` + `

## JSON OUTPUT (required)
Reply in JSON: ports: [{ portName, description, negativeHints, trace }], imageDescriptions: [string per port], generatedPrompt: single merged line (ENGLISH, DALL-E ready), summary, styleSignals.
`;