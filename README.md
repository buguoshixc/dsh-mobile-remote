# dsh-mobile-remote

Reach the desktop DeepSeek Harness Web GUI from an **Android phone over Tailscale** — without copying an auth token by hand.

The plugin runs inside the existing DSH Web composition (`127.0.0.1:19387` keeps
binding loopback only; Tailscale `serve` is what exposes it to the tailnet):

- **pairing without manual token shipping** — the phone gets the authenticated
  launch URL (and a QR code) from the GUI, from the `mobile_pair_url` tool, or
  from `GET /mobile-remote/pair`;
- **mobile-ready panel** — a keyed `main` panel plus a `sidebar.panellist` entry
  and a narrow-screen stylesheet;
- **phone approvals** — approval prompts are pushed to the phone and answered
  through a one-shot signed link;
- **device-level revocation + audit** — `/mobile-remote/state` and
  `/mobile-remote/device/revoke` are self-authenticated through the shipped
  `client-connection` admission fence, and every hit/refusal is recorded.

## Status

T2 scaffold: package/build pipeline, identity, frozen `Config`, and a mountable
host plugin row. Business logic lands next (`src/config.ts`, `src/pair.ts`,
`src/routes.ts`, `src/tools.ts`, `src/client/**`).

The frozen interface contract lives in [`docs/00-contract.md`](docs/00-contract.md);
the isolated test bench used to exercise host code without touching the live DSH
process is documented in [`docs/02-harness.md`](docs/02-harness.md).

## Layout

| Path | Role |
|---|---|
| `src/index.ts` | Host half: `name` / `inject` / `Config` / `apply` |
| `src/client/index.ts` | Browser half entry (`lib/client.js`), `inject = ['slots']` |
| `cordis.patch.yml` | Bundle patch layer: one `insert` row naming this package |
| `test/host-scaffold.test.mjs` | `node --test`: identity, Config defaults, YAML shape, artifacts |
| `lib/index.js` | Built host artifact (ESM) |
| `lib/client.js` | Built browser artifact (`window.__ModuleLoader__.load({ id: "dsh-mobile-remote", … })`) |

## Commands

```sh
pnpm install        # installs devDependencies (and runs `prepare` -> tsdown)
pnpm run typecheck  # tsc --noEmit
pnpm run build      # tsdown: lib target first (clean), then the client target
pnpm test           # node --test "test/*.test.mjs"   (run after build)
pnpm run verify     # typecheck && build && test
```

Two build targets, in this order, and the order matters:

1. **lib** — `src/index.ts` → `lib/index.js` (ESM, node, `dts: true`, `clean: true`);
2. **client** — `src/client/index.ts` → `lib/client.js` (CJS, browser, `clean: false`).

`clean: false` on the client target is what keeps the two from deleting each
other's output. The client artifact must keep the `__ModuleLoader__.load`
handshake: `dsh-client-modules` keys the browser entry by the id inside it and
fetches `/plugins/<id>/client.js` with the same string, so the id, the patch
row's `name` and `package.json` `name` are one value in three places.

## Mounting into a profile

A profile composes its cordis tree from the bundles listed in its
`package.json` → `dsh.profile.bundles`, then its own `cordis.patch.yml`. Mount
this plugin by adding it to that list (installed as a `link:` dependency, exactly
like a local development plugin) — this bundle's own `cordis.patch.yml` then
contributes the plugin row. Adding a row is a *composition* change: it takes
effect after the DSH process restarts. Changing `lib/*.js` of an already-mounted
row only needs a restart too, because Node caches the module generation.

## License

MIT
