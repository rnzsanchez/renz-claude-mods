import type { EngineInterface, Register } from 'claude-code'

const POLL_MS = 30_000
const RETRY_MS = 5 * 60_000

type Lock = { pid: number; workspaceFolders?: string[]; ideName?: string }

let ideDir: string | undefined

async function liveIdeFor($: EngineInterface, cwd: string): Promise<string | undefined> {
  ideDir ??= `${(await $.process.run(['printenv', 'HOME'])).stdout.trim()}/.claude/ide`
  const dir = ideDir
  if (!(await $.fs.exists(dir))) return undefined
  for (const entry of await $.fs.list(dir)) {
    if (!entry.name.endsWith('.lock')) continue
    let lock: Lock
    try {
      lock = JSON.parse(await $.fs.read(`${dir}/${entry.name}`))
    } catch {
      continue
    }
    const matches = (lock.workspaceFolders ?? []).some(f => cwd === f || cwd.startsWith(`${f}/`))
    if (!matches) continue
    const alive = (await $.process.run(['kill', '-0', String(lock.pid)])).exitCode === 0
    if (alive) return lock.ideName ?? entry.name
  }
  return undefined
}

// A rejected call means the engine has no live connection to the ide server;
// any answer, even an error result, means it is connected.
async function ideConnected($: EngineInterface): Promise<boolean> {
  try {
    await $.mcp.call('ide', 'getDiagnostics', {})
    return true
  } catch {
    return false
  }
}

let lastTry = 0

async function check($: EngineInterface, force: boolean): Promise<string> {
  const ide = await liveIdeFor($, await $.session.cwd())
  if (!ide) return 'No live editor is open on this folder.'
  if (await ideConnected($)) {
    lastTry = 0
    return `${ide} is connected.`
  }
  const now = await $.clock.now()
  if (!force && now - lastTry < RETRY_MS) return `${ide} is down; retry waits.`
  lastTry = now
  // Run /ide outside the calling hook: a command.run inside one would wait on itself.
  $.clock.after(0, () => {
    $.command.run({ command: 'ide' }).catch((err: unknown) => {
      $.ui.toast(`ide-reconnect: /ide failed: ${err instanceof Error ? err.message : String(err)}`)
    })
  })
  return `${ide} was down; reconnecting with /ide.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ide-reconnect',
      description: 'Check the IDE connection and run /ide if it is down',
    })
    $.clock.every(POLL_MS, () => {
      check($, false).then(
        text => text.endsWith('/ide.') && $.ui.toast(`ide-reconnect: ${text}`),
        (err: unknown) => $.ui.toast(`ide-reconnect: check failed: ${err instanceof Error ? err.message : String(err)}`),
      )
    })
    return next(e)
  })

  on('command.run', { command: 'ide-reconnect' }, async $ => ({ text: await check($, true) }))
}
