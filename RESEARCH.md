# Research: opencode TUI hangs when the notification plugin is loaded

**Date:** 2026-09-23
**Environment:** opencode 1.18.29 (single-file compiled binary `/usr/bin/opencode`), Linux, Bun shell available to plugins.
**Scope:** `.opencode/plugins/note-on-idle.js` — the "desktop notification on question / waiting for prompt" plugin.

---

## 1. TL;DR

The project's notification plugin caused opencode to hang at startup. Root cause:
**`await`ing a subprocess (`Bun.$` / `Bun.spawn`) or the in-process SDK call
(`client.app.log`) from inside a plugin event hook is unreliable in the opencode
1.18.x runtime.** When the child process actually runs for any real time, the
spawn/exit promise can never settle, leaving the hook's async fiber stranded.
Because the plugin fires `notify-send` on the very first `session.idle` at
startup, the TUI freezes.

Fix: make the plugin fully non-blocking — fire `notify-send` and `client.app.log`
without awaiting. Verified: `opencode run` completes in ~5 s (previously the
subprocess await never returned).

---

## 2. Symptom and report

- User restarted opencode (to load the freshly written plugin) and it hung.
- Renaming `.opencode/` to `_.opencode/` made startup work immediately,
  isolating the plugin directory as the trigger.
- Config/plugins load only at startup, so a restart was required even after the
  fix.

---

## 3. Investigation method

### 3.1 Process and log review

- `ls -laR . _.opencode` — confirmed the only file in `.opencode/` was the plugin
  (plus an auto-generated `.gitignore`).
- Read the plugin: `event`/`tool.execute.before` hooks matching
  `session.idle`, `permission.asked`, and the `question` tool; body posted via
  `notify-send`; `client.app.log()` for debug logging; 2.5 s debounce.
- `~/.local/share/opencode/log/opencode.log` — startup logs exist for healthy
  runs; the hung startup produced no log lines at all.

### 3.2 Reproduction attempts

| Scenario | Result |
| --- | --- |
| `opencode run "say ok"` (headless, plugin active) | completes, exit 0 |
| TUI under a pty via `script` | renders and waits (inconclusive) |
| `opencode run` with traced plugin | **freeze point captured** |

### 3.3 Tracing

The plugin was instrumented with a synchronous `appendFileSync` trace
(`node:fs`) to `/tmp/opencode/trace.log` at each interesting step.

Freeze captured during a headless run:

```
14:43:56.886 event: session.idle
14:43:56.886 maybeNotify(session.idle): start
14:43:56.886 notify: before spawn: Waiting for your input
(…nothing after — the spawn await never returns)
```

The trace stops at the `await` and never logs `notify: after spawn`, even though:

- direct `notify-send` from a shell returns in ~50–75 ms, exit 0, every time;
- the child processes are gone after the run exits (they do exit);
- the rest of the event loop keeps working (later events are still logged).

---

## 4. Root cause analysis

Three pieces combine to cause the hang.

### 4.1 `await $` subprocess promises can never settle

Tested different commands from inside the opencode process (all via
`$` cmd ``.quiet().nothrow()``):

| Command | Inside opencode | Outside (bun / shell) |
| --- | --- | --- |
| `true` | resolves (~20 ms) | resolves |
| `echo probe` | resolves (~2 ms) | resolves |
| `sleep 1` | **never resolves** | resolves |
| `timeout 3 notify-send …` | **never resolves** | resolves (124/0) |
| `notify-send …` | **never resolves** | resolves (~50 ms) |
| `Bun.spawn(["true"]).exited` | resolves | resolves |
| `Bun.spawn(["notify-send", …]).exited` | **never resolves** | resolves |

The child runs to completion; the exit notification back to the plugin's
promise is lost. This is context-dependent inside the opencode binary (a pty
TUI run resolved a `$ notify-send` in ~58 ms), so it is a robustness hazard
rather than a deterministic bug — exactly the kind of behaviour that must not
be introduced at startup.

### 4.2 `client.app.log` re-enters the server in-process

The plugin SDK client is built with an in-process `fetch`
(`packages/opencode/src/plugin/index.ts:146`):

```ts
// serverUrl is unset inside the embedded TUI/server, so app.log goes straight
// back into the running HTTP app instead of over a real socket:
...(serverUrl ? {} : { fetch: async (...args) => Server.Default().app.fetch(...args) })
```

Any `await client.app.log(...)` from a hook is a re-entrant HTTP round-trip into
the same event loop that is busy dispatching events at startup.

### 4.3 Hooks run on every event, fire-and-forget

```ts
// packages/opencode/src/plugin/index.ts:259
void hook["event"]?.({ event: { id, type: event.type, properties: event.data } })
```

There is a burst of events at startup (`plugin.added`, `catalog.updated`,
`integration.updated`, `reference.updated`, …) and `session.idle` fires as soon
as the session goes idle. Each starts a detached async fiber; a fiber stuck on
a never-settling `await` holds resources instead of returning.

---

## 5. The fix

Rewrite the plugin so no hook ever awaits a subprocess or SDK call.

| Before | After |
| --- | --- |
| `await $`notify-send …`.quiet().nothrow()` | `Bun.spawn(["notify-send", …], { stdout:"ignore", stderr:"ignore", stdin:"ignore" })` — no await |
| `await client.app.log({…})` | `client.app.log({…}).catch(() => {})` — no await |
| nothing around them | every call wrapped in `try/catch` |

The full fixed plugin is in `.opencode/plugins/note-on-idle.js`. Behaviour is
unchanged externally: same `notify-send -a opencode "opencode <body>"` command,
same debounce (2.5 s), same events watched, same debug logging.

Verified with the fixed plugin:

```
$ opencode run "say ok"
exit=0 (elapsed ≈ 5 s)
ok
```

---

## 6. Side effects observed during testing

- opencode auto-bootstrapped `.opencode/package.json` +
  `.opencode/node_modules` (containing `@opencode-ai/plugin@1.18.29`) when
  running with local plugins. Both are gitignored and harmless.
- The plugin dir was temporarily renamed during diagnosis
  (`.opencode/` → `_.opencode/`) and is restored as the active `./.opencode`.

---

## 7. Rules going forward (codified in AGENTS.md)

1. Plain JS, no external deps.
2. Spawn notifications with `Bun.spawn([...], { stdio ignore })`.
3. **Never `await` subprocess/spawn calls inside hooks** — fire and forget.
4. Use `client.app.log()` (not `console.log`), also fire-and-forget with
   `.catch(() => {})`.
5. Wrap spawn/log in try/catch so a missing notification daemon never errors.
6. Keep the 2.5 s debounce.
7. Restart opencode after any plugin change.
8. Pending migration: move the plugin to `~/.config/opencode/plugins/` once
   verified, then delete the project copy.

---

## 8. Open questions / caveats

- The TUI freeze itself could not be reproduced faithfully from a scripted pty
  (no real terminal, no real idle transition). The deterministic reproduction
  is headless `opencode run`. The connection between the two is the same
  never-settling `await` path being hit by the startup `session.idle`.
- Whether this is a bug in the compiled Bun runtime bundled into opencode
  1.18.29, or in opencode's plugin dispatch, is not resolved here.
- The in-process `Server.Default().app.fetch` pattern for the plugin SDK client
  (plugin/index.ts:146) is worth revisiting upstream: it compiles in the case
  where the server is embedded.

## 9. Reference

- Plugin as debugged: `.opencode/plugins/note-on-idle.js`
- Plugin logic: original at `/tmp/opencode/note-on-idle.orig.js`
- opencode source (tag `v1.18.29`): `packages/opencode/src/plugin/index.ts`
  (event dispatch at line 259, in-process client at line 146)
- Trace log captured during the hang: (see Investigation method)