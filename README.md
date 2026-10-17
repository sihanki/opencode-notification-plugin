# note-on-idle

A tiny [opencode](https://opencode.ai) plugin that pops a **desktop notification** whenever opencode stops and needs you — so you can alt-tab away while it works and still know the moment it's your turn.

## What it does

It watches for four things and sends a notification for each:

| When | Notification |
| --- | --- |
| opencode finishes a turn and is waiting for your prompt | *Waiting for your input* |
| opencode's turn ends in an error | *opencode stopped with an error* |
| opencode asks for permission to do something | *Permission requested: …* |
| opencode asks you a direct question | *opencode is asking you a question* |

Notifications are sent with the standard Linux `notify-send` command, under the app name **opencode**. Rapid-fire events are collapsed with a 2.5-second debounce so you don't get spammed.

Headless runs count too — `opencode run "…"` finishing in your terminal pops a notification just like the TUI does.

That's it — no configuration, no dependencies to install, one small JavaScript file.

## Requirements

- **opencode v2** (the plugin API changed in v2; this file targets the v2 API — see [How it works](#how-it-works-the-short-version)).
- **Linux** with a working `notify-send` (comes with [libnotify](https://gitlab.gnome.org/GNOME/libnotify); usually preinstalled on desktop distros).
- A running notification daemon (GNOME, KDE, Dunst, etc. — if other desktop notifications work, you're fine).
- opencode itself, obviously.

Quick check:

```sh
notify-send -a opencode "opencode" "hello"
```

If a banner appears, you're good.

## Manual installation

opencode picks up plugins automatically — no `opencode.json` edits needed. Just drop the file in one of these folders:

### Install for everything (recommended)

```sh
mkdir -p ~/.config/opencode/plugins
cp note-on-idle.js ~/.config/opencode/plugins/
```

### Install for a single project only

```sh
mkdir -p .opencode/plugins
cp note-on-idle.js .opencode/plugins/
```

Any `*.js` file in `.opencode/plugins/` (project) or `~/.config/opencode/plugins/` (global) is loaded automatically.

### Activate it

opencode watches plugin files and reloads them automatically, so the change usually applies right away. Restart opencode (or your session) if the notifications don't show up.

> Running opencode v1? The v1 and v2 plugin APIs are incompatible — a v1 plugin file will not load in v2. Use this file with v2.

## Uninstall

Delete the file and restart opencode:

```sh
rm ~/.config/opencode/plugins/note-on-idle.js   # global
# or
rm .opencode/plugins/note-on-idle.js            # project
```

## Troubleshooting

**No notifications appear?**

1. Test `notify-send` directly from a shell (see *Requirements*). If that fails, the problem is your desktop setup, not the plugin.
2. Make sure the file actually landed in one of the plugin folders, and that opencode reloaded it (it watches plugin files; restarting opencode also works).
3. Check the plugin's debug log:

   ```sh
   cat ~/.local/state/opencode/note-on-idle.log
   ```

   - `sent notification` — the plugin fired; `notify-send` itself is the problem.
   - `skipped duplicate notification` — the debounce kicked in (working as intended).
   - nothing at all — the plugin isn't loaded. Check
     `grep note-on-idle ~/.local/share/opencode/log/opencode.log` for
     `loading plugin` vs `failed to load plugin`.

**opencode hangs on startup?** You're probably running an old copy of the plugin that `await`s subprocesses. This version never awaits anything — make sure you're using the current file.

## How it works (the short version)

The plugin default-exports a v2 plugin definition — an `id` plus a `setup(ctx)` function — and registers two things:

- `ctx.event.subscribe()` — an async subscription to the server event stream, watching for `session.execution.succeeded` / `session.execution.failed` (turn finished), and `permission.asked`. The subscription is aborted by the cleanup function returned from `setup`.
- `ctx.tool.hook("execute.before", …)` — catches the built-in `question` tool just before it runs.

> v1 had a `session.idle` event. **v2 never publishes it** — a finished turn is `session.execution.succeeded`. A plugin that still listens for `session.idle` loads fine and silently notifies for nothing.

When one of those fires, it spawns `notify-send` **without awaiting it** and returns immediately. That fire-and-forget design matters: awaiting subprocesses from inside a plugin hook can hang the whole process, and hooks are dispatched fire-and-forget. Debug lines go to `~/.local/state/opencode/note-on-idle.log` (v2 removed the `app.log` RPC, and the background service sends stdout to `/dev/null`, so `console.log` is not an option). Every call is wrapped in `try/catch` so a missing notification daemon can never break your session.

Everything else — `notify-send` is spawned via `Bun.spawn`, the 2.5s debounce, the fire-and-forget rule — is unchanged from the v1 version.

## License

Do whatever you like with it.
