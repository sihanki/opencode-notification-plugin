# note-on-idle

A tiny [opencode](https://opencode.ai) plugin that pops a **desktop notification** whenever opencode stops and needs you — so you can alt-tab away while it works and still know the moment it's your turn.

## What it does

It watches for three things and sends a notification for each:

| When | Notification |
| --- | --- |
| opencode finishes a turn and is waiting for your prompt | *Waiting for your input* |
| opencode asks for permission to do something | *Permission requested: …* |
| opencode asks you a direct question | *opencode is asking you a question* |

Notifications are sent with the standard Linux `notify-send` command, under the app name **opencode**. Rapid-fire events are collapsed with a 2.5-second debounce so you don't get spammed.

That's it — no configuration, no dependencies to install, one small JavaScript file.

## Requirements

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

**Restart opencode.** Plugins are only read at startup, so the change won't apply to an already-running session.

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
2. Make sure the file actually landed in one of the plugin folders and that opencode was restarted afterwards.
3. Check the opencode log for the plugin's debug lines (`service: note-on-idle`):

   ```sh
   grep note-on-idle ~/.local/share/opencode/log/opencode.log
   ```

   - `sent notification` — the plugin fired; `notify-send` itself is the problem.
   - `skipped duplicate notification` — the debounce kicked in (working as intended).

**opencode hangs on startup?** You're probably running an old copy of the plugin that `await`s subprocesses. This version never awaits anything — make sure you're using the current file.

## How it works (the short version)

The plugin exports a single function that registers two hooks:

- `event` — listens for `session.idle` (waiting for input) and `permission.asked`.
- `tool.execute.before` — catches the built-in `question` tool just before it runs.

When one of those fires, it spawns `notify-send` **without awaiting it** and returns immediately. That fire-and-forget design matters: in opencode 1.18.x, awaiting subprocesses from inside a plugin hook can hang the whole process. Debug logging goes through `client.app.log()` (also not awaited), and every call is wrapped in `try/catch` so a missing notification daemon can never break your session.

## License

Do whatever you like with it.
