/**
 * dsh-worktable build:
 *   - lib/index.js: host-side ESM bundle
 *   - lib/client.js: client CJS bundle; native/worktable rendering is selected at startup
 */
import { build } from 'esbuild'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
mkdirSync(join(here, 'lib'), { recursive: true })
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'))
const pluginManifest = JSON.parse(readFileSync(join(here, 'dsh.plugin.json'), 'utf8'))
if (pluginManifest.version !== pkg.version) {
  throw new Error(
    'dsh-worktable build: package.json version (' +
      pkg.version +
      ') != dsh.plugin.json version (' +
      pluginManifest.version +
      ')'
  )
}

const clientBanner = {
  js: "window.__ModuleLoader__.load({ id: 'dsh-worktable', factory: (require) => { var module = { exports: {} }; var exports = module.exports;",
}
const clientFooter = { js: 'return module.exports; } });' }

await build({
  entryPoints: [join(here, 'src/index.ts')],
  outfile: 'lib/index.js',
  bundle: true,
  sourcemap: 'external',
  logLevel: 'info',
  platform: 'node',
  define: { __WT_VERSION__: JSON.stringify(pkg.version) },
  format: 'esm',
  target: ['node22'],
  external: ['@deepseek-ai/*', 'node:*', 'ws', 'node-pty'],
  loader: { '.css': 'text', '.html': 'text' },
})

await build({
  entryPoints: [join(here, 'src/client/index.tsx')],
  outfile: 'lib/client.js',
  bundle: true,
  sourcemap: 'external',
  logLevel: 'info',
  platform: 'browser',
  format: 'cjs',
  target: ['es2022'],
  jsx: 'automatic',
  external: ['@deepseek-ai/*', 'react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'scheduler'],
  loader: { '.css': 'text' },
  banner: clientBanner,
  footer: clientFooter,
  define: { __WT_VERSION__: JSON.stringify(pkg.version) },
})

console.log('[dsh-worktable build] done: lib/index.js, lib/client.js')
