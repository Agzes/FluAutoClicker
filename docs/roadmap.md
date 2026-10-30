# Roadmap

Major directions for FluAutoClicker...

## Next

- Pause and resume macro playback.
- Guaranteed stop that releases every held key and button.
- Window targeting.
- Engine failures recover.

## Macros

- Conditions, branches, loops, and variables.
- Named macros, import, and export.
- Undo/redo, multi-select, run selected fragment.
- Timeline and cleanup of recorded movement and pauses.
- Parallel branches, speed multiplier, dry run.

## Interface

- Command palette.
- Onboarding and hotkey overview with conflict detection.
- Status bar with progress, mini mode, overlay.
- Region picker, panic button, themes, zoom, transparency.
- Full keyboard navigation and accessibility.

## System and input

- Wayland: recording, hotkeys, input. ([ref 1: (AntiAFK-RBX-Sober docs)](https://github.com/Agzes/AntiAFK-RBX-Sober/blob/main/docs/README.md), [ref 2: (AntiAFK-RBX-Sober code)](https://github.com/Agzes/AntiAFK-RBX-Sober/tree/main/src/inputs))
- Input backend selection with automatic fallback.
- Arbitrary key combinations, keyboard recording, text typing.
- Profiles: folders, favorites, per-profile hotkeys, focus trigger.

## Localization and updates

- OS language detection, translated errors, RTL, community translations.
- Stable / beta / nightly channels and full auto-update (security-first, only with manual approve).
- Flatpak, Winget, maybe other...

## Quality

- Diagnostics, file logs, crash handling.
- Tests for UI, macros, and migrations; CPS accuracy checks.
- Performance with large macros; strict security policy.
