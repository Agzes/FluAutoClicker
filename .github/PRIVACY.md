# Privacy

FluAutoClicker has no telemetry, analytics or accounts. All settings, profiles and macros are stored locally on your device.

## Network requests

| Endpoint                                                                                    | When                                | What is sent                          |
| ------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------- |
| `https://fonts.googleapis.com`, `https://fonts.gstatic.com`                                 | font preview/download (user action) | only the requested font family        |
| `https://raw.githubusercontent.com/Agzes/FluAutoClicker/next/docs/updates/latest-beta.json` | update check                        | nothing (GET with ETag/If-None-Match) |
| `https://github.com/Agzes/FluAutoClicker` and `.../releases`                                | opening the release page (on click) | nothing                               |
| links in the UI (e.g. Discord)                                                              | only on user click                  | nothing                               |

There are no other outbound connections. Input events are injected locally (enigo/uinput) and never leave the machine.

CI tooling (cargo-audit etc.) runs only in GitHub Actions and is not part of the app.
