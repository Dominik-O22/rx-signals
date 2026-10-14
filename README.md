# rx-signals (maintained fork)

A maintained fork of [gneu77/rx-signals](https://github.com/gneu77/rx-signals). Upstream stopped at 3.0.0-rc46 in 2023. This fork starts from 3.0.0-rc23, fixes its bugs, rebuilds the core, and ships a codemod for apps on rc23.

| Package                                                  | What it is                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| [`@rx-signals-next/store`](packages/store/README.md)     | The store: state, derived state, events, effects, signal factories |
| [`@rx-signals-next/angular`](packages/angular/README.md) | Angular providers and a signal bridge                              |
| [`codemod/`](codemod/MIGRATION.md)                       | A zero-dependency script that migrates an rc23 Angular app to v4   |

## Coming from rc23

Read [codemod/MIGRATION.md](codemod/MIGRATION.md). The script rewrites the code that changed shape, and marks every spot left for you with a `// TODO(rx-signals-v4)` comment. `--check` lists those spots until none are left.

## Development

```sh
pnpm install
pnpm build && pnpm test && pnpm lint && pnpm typecheck
node --test codemod/test/
node scripts/fixture-gate.mjs --migrate   # needs Chrome or Chromium
```

`fixtures/angular19-rc23` is an Angular 19 app written against rc23. The gate migrates a copy with the codemod, installs this checkout's packages, and requires typecheck, build, Karma, and a selftest report identical to the one recorded on rc23. CI runs every step above.

## Releases

Publishing a GitHub release with tag `vX.Y.Z` runs `.github/workflows/release.yml`. It checks that every package is at `X.Y.Z`, tests and builds, attests the tarballs, and publishes them to npm with provenance through trusted publishing. The very first publish of a new package needs a short-lived `NPM_TOKEN` secret on the `npm` environment. npm can only trust the workflow once the package exists.

## License

MIT. Copyright 2020 Gerd Neudert, 2026 Dominik Opwis.
