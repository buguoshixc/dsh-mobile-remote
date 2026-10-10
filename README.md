# dsh-mobile-remote

[![CI](https://github.com/buguoshixc/dsh-mobile-remote/actions/workflows/ci.yml/badge.svg)](https://github.com/buguoshixc/dsh-mobile-remote/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

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

Implemented and under test. Both halves are complete — the host half (pairing
routes, device registry, approval decisions, audit, hardening, agent tools), the
browser half (mobile panel, QR pairing card, narrow-screen stylesheet), and the
test bench that drives host code without touching a live DSH process.

Nine `node --test` suites cover the contract and the hardening model; the CI badge
above reports the current state on both supported Node lines.

**Implementation-complete is not the same as device-verified.** The plugin runs
against a real DSH Web composition, but several acceptance items can only be
closed on real hardware and are *not* claimed as verified:

| Not verified | Why |
|---|---|
| Terminal / plugin toggle / session switch / settings **on a phone** | The desktop-side run only reached the transport layer (with a session cookie, `POST /api` answers `404`, not `401` ⇒ the fence admitted it). The four interfaces themselves were never exercised on a device. |
| **Narrow-screen rendering** | Every layout reading comes from headless Chromium plus a synthetic DOM. Android WebView font scaling, `dvh`/`svh` behaviour and touch-hit testing are unmeasured. |
| **Push delivery** | `pushTopic` ships empty, which disables the push subsystem by choice, so there is no delivery to verify. |
| Revocation drill steps that need a restart / are destructive | Rotating the `browser-session` secret and the profile restore are documented but were never executed. |

[`docs/19-user-acceptance-sheet.md`](docs/19-user-acceptance-sheet.md) is the
runnable acceptance checklist and carries the authoritative verified / not-verified
split; it cites every number it quotes.

## Layout

| Path | Role |
|---|---|
| `src/index.ts` | Host half: `name` / `inject` / `Config` / `apply` |
| `src/routes.ts` | The five frozen routes (R1–R5) and their admission order |
| `src/pair.ts` · `src/tools.ts` | Pairing-URL issuance; the `mobile_pair_url` agent tool |
| `src/device.ts` · `src/decision.ts` · `src/approval.ts` | Device registry, approval decisions, phone-side approval flow |
| `src/audit.ts` · `src/hardening.ts` | Audit trail; forwarded-header reasoning and the local-vs-remote gate |
| `src/config.ts` | Frozen `schemastery` `Config` |
| `src/client/index.ts` | Browser half entry (`lib/client.js`), `inject = ['slots']` |
| `src/client/pair-card.ts` · `pair-state.ts` · `qr.ts` | Sidebar pairing card, its state machine, QR encoding |
| `src/client/mobile-css.ts` · `styles.ts` | Narrow-screen stylesheet and the `visualViewport` keyboard-avoidance route |
| `cordis.patch.yml` | Bundle patch layer: one `insert` row naming this package |
| `lib/index.js` | Built host artifact (ESM) |
| `lib/client.js` | Built browser artifact (`window.__ModuleLoader__.load({ id: "dsh-mobile-remote", … })`) |

### Tests

| Suite | Covers | Needs `lib/`? |
|---|---|---|
| `host-scaffold` | Identity, `Config` defaults, patch YAML shape, artifact handshake | yes |
| `host-pair` | R1 pairing URL and the admission fence | yes |
| `host-device` | R3/R4/R5 registration, revocation, rotation, the local-vs-remote gate | no |
| `host-decision` · `host-approval` | One-shot signed decision links; the approval flow | no |
| `client-pair` · `client-mobile-css` | Pairing card state machine; injected CSS and selector matching | yes |
| `acceptance-t6` · `acceptance-hardening` | Acceptance runs over the host surface and the hardening model | yes |

Suites marked **no** import `../src/*.ts` directly and use Node's type stripping,
so they exercise the code you edit with no build step. The rest read the built
`lib/` artifacts — some to assert 200-level behaviour against the real bundle,
others merely to pin the ESM/`__ModuleLoader__` handshake. So build first:
`pnpm test` alone fails on a fresh clone, while `pnpm verify` runs
typecheck → build → test in that order.

## Documentation

`docs/` is 31 files because it is a working record, not just a spec: the frozen
contract, the harness notes, and then a series of verification and review rounds
that cite raw evidence. To find your way in:

| Read | For |
|---|---|
| [`docs/00-contract.md`](docs/00-contract.md) | **Start here.** The frozen interface contract: assumptions, the five routes, the risk register, and every later wording correction with its evidence |
| [`docs/19-user-acceptance-sheet.md`](docs/19-user-acceptance-sheet.md) | What to run, what to expect, what to send back — and the verified / not-verified split |
| [`docs/04-install-and-transport.md`](docs/04-install-and-transport.md) | Installing into a profile, what needs a restart and what does not, teardown |
| [`docs/06-hardening-contract.md`](docs/06-hardening-contract.md) · [`docs/08-revocation-runbook.md`](docs/08-revocation-runbook.md) | The hardening model; what to do when a phone is lost, and the honest limits of plugin-side revocation |
| [`docs/02-harness.md`](docs/02-harness.md) | The bench that exercises host code without touching the live DSH process |
| `docs/03`, `07`, `09`–`28` | Verification and review records — each round's findings and how they were closed |

Documents mark unproven claims explicitly (`NOT-VERIFIED-LOCALLY`, "mechanism
inference, not measurement"). Treat those markers as load-bearing: they are the
reason the acceptance sheet can be trusted.

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
