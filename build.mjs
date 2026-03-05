import * as esbuild from 'esbuild';
import { readdirSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

async function build() {
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
