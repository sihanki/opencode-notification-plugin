# AGENTS.md — opencode notification plugin

## Purpose
Track work on the "desktop notification on question / waiting for prompt"
feature, including save policies between sessions.

## Goal
Desktop notification (via `notify-send`) every time opencode:
- starts waiting for a prompt  → `session.idle` event
- asks a question             → `permission.asked` event, and
                               `tool.execute.before` for the `question` tool

## Current state
- **Global plugin (active):** `~/.config/opencode/plugins/note-on-idle.js`
  (migrated from the project copy on 2026-09-23; project copy deleted).

## Policies / conventions
- Plain JS plugin, **no external imports or deps** (no `package.json` needed).
- Notify command: `notify-send -a opencode "opencode" <body>` (Linux only),
  launched with `Bun.spawn([...], { stdout: "ignore", stderr: "ignore",
  stdin: "ignore" })`.
- **Never `await` subprocess/spawn calls inside hooks.** In the opencode 1.18.x
  runtime the `await $`...`` / `.exited` promises can hang forever (the child
  finishes but the promise never settles), and event hooks are dispatched
  fire-and-forget — so fire the notification without awaiting it.
- Use `client.app.log()` for logging, never `console.log`, and call it
  fire-and-forget (`.catch(() => {})`, no `await`) to avoid re-entrant
  in-process HTTP calls deadlocking at startup.
- Wrap `Bun.spawn`/`app.log` in try/catch so a missing notification daemon
  never errors.
- Keep the ~2.5s debounce (`DEBOUNCE_MS`) to avoid duplicate/spam flags.
- Only pull safe fields from `event.properties` (e.g. `permission`) into
  messages; fall back to a generic message.

## Reminders
- Config/plugins load only at opencode startup — after any plugin change, the
  user must restart opencode for it to take effect.
- No `opencode.json` change required: files in `.opencode/plugins/` (and
  `~/.config/opencode/plugins/`) are auto-discovered.