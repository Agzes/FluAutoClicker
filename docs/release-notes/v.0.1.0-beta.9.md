# FluAutoClicker v0.1.0-beta.9

Release date: 22.09.2026

## Overview

Global hotkeys on Hyprland, new click types with X1/X2 mouse buttons, an automatic nightly build channel, and a major quality push: strict CI gates (clippy, linters, security audits) and fully automated dependency management.

## Enhancements

- Added global hotkeys on Hyprland through the hyprland-global-shortcuts-v1 protocol.
- Added click types: single, double and triple clicks, plus X1/X2 mouse buttons.
- The CPS test page now supports middle and right mouse buttons.
- Introduced a nightly channel: a rolling `nightly` prerelease is published automatically from the `next` branch after every successful build.
- Added PRIVACY.md listing every network endpoint the app can reach (no telemetry).

## Under the hood

- CI now enforces clippy `-D warnings`, ESLint, Stylelint, taplo (TOML), a 200 KB gzip bundle budget, version sync between package.json/Cargo.toml/tauri.conf.json, and Rust build caching. All GitHub Actions are pinned by commit SHA.
- Added automated dependency checks: cargo-audit, cargo-machete and Dependabot for cargo, npm and GitHub Actions.
- Updated to Tauri 2.11 in lockstep (Rust crate 2.11.6, API 2.11.1, CLI 2.11.4).
- Fixed security advisories in the dependency tree (quick-xml) and removed unused dependencies (once_cell, duplicated plugin entry).
- Cleaned up dead code, duplicated CSS rules and Windows-only clippy warnings.

## Bug Fixes

- Fixed text selection behavior.
- Fixed duplicated CSS rules that could override profile and number-input styles.

## Notes

- Nightly builds are automated and may be broken at any time — use beta releases for daily use.
- Global hotkeys on Wayland are currently supported on Hyprland only; other compositors still fall back to tray/CLI.
- Linux input automation still requires writable `/dev/uinput`. Use the in-app permission prompt or install the persistent udev rule.
