const DEBOUNCE_MS = 2500

// In the opencode 1.18.x runtime, awaiting Bun.$ / Bun.spawn (and some in-process
// SDK calls) from inside a plugin hook can hang the process: the child runs to
// completion but the promise never settles. So we fire-and-forget everything:
// spawn notify-send without awaiting, and let app.log resolves on its own.

const notify = (body) => {
  Bun.spawn(["notify-send", "-a", "opencode", "opencode", body], {
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  })
}

const maybeLog = (client, reason, message, extra) => {
  try {
    client.app
      .log({
        body: {
          service: "note-on-idle",
          level: "debug",
          message,
          extra: { reason, ...extra },
        },
      })
      .catch(() => {})
  } catch {}
}

export const NoteOnIdle = async ({ client }) => {
  let lastNotified = 0

  const maybeNotify = (reason, body) => {
    const now = Date.now()
    if (now - lastNotified < DEBOUNCE_MS) {
      maybeLog(client, reason, "skipped duplicate notification")
      return
    }
    lastNotified = now
    try {
      notify(body)
    } catch {
      return
    }
    maybeLog(client, reason, "sent notification", { body })
  }

  return {
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        maybeNotify("session.idle", "Waiting for your input")
      }
      if (event.type === "permission.asked") {
        const detail = event.properties?.permission
        maybeNotify(
          "permission.asked",
          detail ? `Permission requested: ${detail}` : "Permission requested",
        )
      }
    },
    "tool.execute.before": (input) => {
      if (input.tool === "question") {
        maybeNotify("question.tool", "opencode is asking you a question")
      }
    },
  }
}