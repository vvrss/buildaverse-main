// Bundles the server into dist-server/main.js. sharp stays outside the
// bundle: it loads a native library for the platform it is installed on.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: ['server/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist-server/main.js',
  external: ['sharp'],
  define: { __APP_VERSION__: JSON.stringify(version) },
  // Some bundled dependencies still call require().
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'warning',
});
console.log(`dist-server/main.js (Storyteller ${version})`);
