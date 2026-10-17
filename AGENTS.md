# AGENTS.md — opencode notification plugin

## Purpose
Track work on the "desktop notification on question / waiting for prompt"
feature, including save policies between sessions.

## Goal
Desktop notification (via `notify-send`) every time opencode:
- finishes a turn                → `session.execution.succeeded` event
- finishes a turn in error       → `session.execution.failed` event
- asks for permission            → `permission.asked` event, and
- asks a question                → `ctx.tool.hook("execute.before")` for the
                                   `question` tool

## Current state
- **V2 plugin API** (opencode 2.0.31). Migrated 2026-10-17; the v1 entrypoint
  (`export const NoteOnIdle`) no longer loads — v2 requires a default export
  with `id` + `setup(ctx)` / `effect(ctx)`.
- **Active copy:** `.opencode/plugins/note-on-idle.js` (project scope).
  The global copy at `~/.config/opencode/plugins/note-on-idle.js` was removed;
  that folder is currently empty. User chose project-only for now.
- Source of truth for the file is the project copy; the global folder is the
  place to copy it to when the user wants it everywhere.
- Verified live end-to-end 2026-10-17: `opencode run` finishing pops a real
  desktop notification, and the `question` tool hook pops one mid-turn.

## Policies / conventions
- Plain JS plugin, **no external imports or deps** (no `package.json` needed).
  `Plugin.define` from `@opencode/plugin` is *not* required — v2 validates the
  default export shape at runtime (`{ id, setup }`), so skip the import.
  The stale V1 `@opencode-ai/plugin` installs were deleted from `.opencode/`
  and `~/.config/opencode/` (backups in `/tmp/opencode/removed-v1-deps/`).
- Notify command: `notify-send -a opencode "opencode" <body>` (Linux only),
  launched with `Bun.spawn([...], { stdout: "ignore", stderr: "ignore",
  stdin: "ignore" })`.
- **Never `await` subprocess/spawn/filesystem calls inside hooks.** In the
  opencode runtime the `await $`...`` / `.exited` promises can hang forever (the
  child finishes but the promise never settles), and hooks are dispatched
  fire-and-forget — so fire the notification without awaiting it.
- `setup(ctx)` stays **synchronous** and returns the cleanup function. An
  `async setup` returns a promise, not the cleanup function, so the returned
  abort would be lost. Fire hook/subscribe promises with `void ... .catch()`.
- **There is no logging API in v2.** `ctx.app` only has `version`; the
  `/api/log` route is gone and `console.log` is invisible when the server runs
  as a background service (stdout → `/dev/null`). Debug lines are appended to
  `~/.local/state/opencode/note-on-idle.log` with `appendFileSync` in a
  try/catch. Keep that pattern for any future debugging.
- Wrap `Bun.spawn`/log writes in try/catch so a missing notification daemon
  never errors.
- Keep the ~2.5s debounce (`DEBOUNCE_MS`) to avoid duplicate/spam flags.
- Event payloads are under **`event.data`** (v2), not `event.properties`.

## Event names — verify, don't assume
V2 renamed/reshaped events. `session.idle` **still exists as a schema but is
never published**; a finished turn is `session.execution.succeeded` (data:
`{ sessionID }`) or `session.execution.failed` (data: `{ sessionID, error }`).
A v1 plugin listening for `session.idle` loads cleanly and silently does
nothing. Observed live payloads:

| Event | `data` |
| --- | --- |
| `session.execution.succeeded` | `{ sessionID }` |
| `session.execution.failed` | `{ sessionID, error: { type, message } }` |
| `permission.asked` | `{ id, sessionID, action, resources, save, metadata, source, message }` |

Only pull safe fields (e.g. `action`) into messages; fall back to generic.
The `question` tool is a *form*, not a permission request, so it never fires
`permission.asked` — keep its own tool hook.

To check what a server really publishes, subscribe to the event stream
(auth = Basic `opencode:<password>`, password from
`~/.config/opencode/service.json`, host:port from `opencode service status`):

```sh
opencode service status                       # -> http://127.0.0.1:PORT
PW=$(node -pe 'JSON.parse(require("fs").readFileSync(process.env.HOME+"/.config/opencode/service.json","utf8")).password')
curl -sN -H "Authorization: Basic $(printf 'opencode:%s' "$PW" | base64 -w0)" \
  http://127.0.0.1:PORT/api/event
```

(`/api/plugin` takes `?location.directory=<dir>`, but `opencode api` ignores it
and reports the service's own cwd.)

## Reminders
- opencode watches plugin files and hot-reloads them (a `loading plugin` log
  line appears seconds after an edit), but the user may still need to restart
  their session before notifications appear.
- No `opencode.json` change required: files in `.opencode/plugins/` (and
  `~/.config/opencode/plugins/`) are auto-discovered.
- To check load status without a restart:
  `grep note-on-idle ~/.local/share/opencode/log/opencode.log` — a
  `loading plugin` line with no following `failed to load plugin` means OK.
- Verify a load failure before assuming the code is broken: the V2 loader
  message is `Plugin must export a default definition with an id and an effect
  or setup function.`
- To test end-to-end without a TUI: `opencode run --model opencode/<model>
  "reply with exactly: ok"` finishes a turn and should pop a notification.
  Model IDs are listed by `opencode models` (e.g. `opencode/space-bunny-free`).
