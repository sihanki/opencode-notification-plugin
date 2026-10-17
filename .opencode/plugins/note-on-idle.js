import { appendFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const DEBOUNCE_MS = 2500

// Never await Bun.spawn / filesystem / SDK calls from inside a hook or event
// handler: in the opencode runtime those promises can hang forever (the child
// runs to completion but the promise never settles), and hooks are dispatched
// fire-and-forget. So everything below runs without awaiting it.

const NOTIFY = ["notify-send", "-a", "opencode", "opencode"]

const notify = (body) => {
  Bun.spawn([...NOTIFY, body], {
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  })
}

// v2 dropped the `app.log` RPC (ctx.app only has `version`), and the server
// sends stdout to /dev/null when it runs as a background service, so
// console.log is invisible there. Debug lines go to a file instead.
const LOG_DIR = join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "opencode")
const LOG_FILE = join(LOG_DIR, "note-on-idle.log")

const debug = (reason, message, extra) => {
  try {
    mkdirSync(LOG_DIR, { recursive: true })
    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${message} ${JSON.stringify({ reason, ...extra })}\n`)
  } catch {}
}

export default {
  id: "note-on-idle",
  setup(ctx) {
    let lastNotified = 0

    const maybeNotify = (reason, body) => {
      const now = Date.now()
      if (now - lastNotified < DEBOUNCE_MS) {
        debug(reason, "skipped duplicate notification")
        return
      }
      lastNotified = now
      try {
        notify(body)
      } catch {
        debug(reason, "notify-send failed")
        return
      }
      debug(reason, "sent notification", { body })
    }

    // Desktop notification when opencode finishes a turn and waits for a prompt.
    const controller = new AbortController()
    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        // v2 has no session.idle; a finished turn is session.execution.succeeded.
        if (event.type === "session.execution.succeeded") {
          maybeNotify("session.execution.succeeded", "Waiting for your input")
        }
        if (event.type === "session.execution.failed") {
          maybeNotify("session.execution.failed", "opencode stopped with an error")
        }
        if (event.type === "permission.asked") {
          // v2 event payload: { id, sessionID, action, resources, message, ... }
          const action = event.data?.action
          maybeNotify(
            "permission.asked",
            typeof action === "string" && action.length > 0
              ? `Permission requested: ${action}`
              : "Permission requested",
          )
        }
      }
    })().catch(() => {})

    // The `question` tool is a form, not a permission request, so it needs its
    // own hook.
    void ctx.tool
      .hook("execute.before", (event) => {
        if (event.tool === "question") {
          maybeNotify("question.tool", "opencode is asking you a question")
        }
      })
      .catch(() => {})

    return () => controller.abort()
  },
}
