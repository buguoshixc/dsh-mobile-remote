import { defineConfig, type UserConfig } from 'tsdown'

// tsdown transpiles and bundles only; types are checked by `pnpm typecheck`.
// The `prepare` script runs after a git install, so the build must be
// self-contained and must not depend on any monorepo layout.

/**
 * Host half: a Node library in lib/, loaded by the profile's cordis tree through
 * the plugin row in cordis.patch.yml (resolved by package name from the profile
 * directory's node_modules).
 */
const lib: UserConfig = {
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: true,
  clean: true,
  fixedExtension: false,
}

// Client half: a browser bundle served by dsh's client-modules.
// The artifact must use the __ModuleLoader__.load handshake (banner/footer) and
// emit CJS: the factory resolves externals through the injected `require`,
// which reads the browser module table. Only `react` is available there, so
// everything else is inlined.
const CLIENT_EXTERNALS = ['react']

/** Client half: the mobile panel bundle, emitted as lib/client.js. */
const client: UserConfig = {
  name: 'dsh-mobile-remote/client',
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  clean: false,
  sourcemap: true,
  external: CLIENT_EXTERNALS,
  noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  outputOptions: {
    // Fixed artifact name lib/client.js, matching package.json exports["./client"].
    // The id in the banner must stay byte-identical to package.json `name`:
    // dsh-client-modules keys the client entry by that id and fetches
    // /plugins/<id>/client.js with the same string.
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-mobile-remote", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

// Array form: the Node library first (clean), then the client bundle with
// clean disabled so the two do not delete each other's output.
export default defineConfig([lib, client])
