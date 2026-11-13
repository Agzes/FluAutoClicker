<div align="center">

# FluAutoClicker Scripts

_**Build, verification, and maintenance scripts for [FluAutoClicker](https://github.com/Agzes/FluAutoClicker).**_

</div>

## What is this?

This folder contains Node.js utility scripts used for smoke testing, i18n validation, bundle size checks, and version synchronization across the repository.

## Scripts

- `check-bundle-budget.mjs` - calculates gzipped `.js` and `.css` sizes in `dist/` and checks them against the 200 KB budget.
- `smoke-i18n.mjs` - validates JSON syntax and key parity across all translation files in `src/lang/`.
- `smoke-static.mjs` - verifies required DOM IDs, hotkey actions, and metadata consistency across `src/index.html`, `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.
- `sync-version.mjs` - syncs `package.json` version to `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` (supports `--check`).

## Usage

Run any script from the repository root with Node.js:

```bash
node scripts/smoke-static.mjs
node scripts/smoke-i18n.mjs
node scripts/sync-version.mjs --check
node scripts/check-bundle-budget.mjs
```

## License

MIT License - see [LICENSE](../LICENSE).
