import type { EngineInterface, Register } from 'claude-code'

const POLL_MS = 30_000
const RETRY_MS = 5 * 60_000

type Lock = { pid: number; workspaceFolders?: string[]; ideName?: string }

let ideDir: string | undefined

type LiveIde = { name: string; port: string; folders: string[] }

async function liveIdes($: EngineInterface): Promise<LiveIde[]> {
  ideDir ??= `${(await $.process.run(['printenv', 'HOME'])).stdout.trim()}/.claude/ide`
  const dir = ideDir
  if (!(await $.fs.exists(dir))) return []
  const ides: LiveIde[] = []
  for (const entry of await $.fs.list(dir)) {
    if (!entry.name.endsWith('.lock')) continue
    let lock: Lock
    try {
      lock = JSON.parse(await $.fs.read(`${dir}/${entry.name}`))
    } catch {
      continue
    }
    const alive = (await $.process.run(['kill', '-0', String(lock.pid)])).exitCode === 0
    if (alive)
      ides.push({
        name: lock.ideName ?? entry.name,
        port: entry.name.slice(0, -'.lock'.length),
        folders: lock.workspaceFolders ?? [],
      })
  }
  return ides
}

// Undefined when this Claude process holds an open TCP connection to the IDE's port;
// otherwise why not. The child's parent is the Claude process the mod runs in.
async function probeIde($: EngineInterface, port: string): Promise<string | undefined> {
  const { exitCode, stdout } = await $.process.run([
    'sh',
    '-c',
    'lsof -nP -a -p "$PPID" -iTCP:"$1" -sTCP:ESTABLISHED -t',
    'probe',
    port,
  ])
  return exitCode === 0 && stdout.trim() ? undefined : `no open connection to port ${port}`
}

let lastTry = 0
let lastToast = ''

async function check($: EngineInterface, force: boolean): Promise<string> {
  const ides = await liveIdes($)
  // A cwd that drifts into a worktree with its own editor window must not
  // trigger /ide while this session is still connected to another editor.
  for (const live of ides) {
    if ((await probeIde($, live.port)) === undefined) {
      lastTry = 0
      return `${live.name} is connected.`
    }
  }
  const cwd = await $.session.cwd()
  const ide = ides.find(i => i.folders.some(f => cwd === f || cwd.startsWith(`${f}/`)))
  if (!ide) return 'No live editor is open on this folder.'
  const reason = `no open connection to port ${ide.port}`
  const now = await $.clock.now()
  if (!force && now - lastTry < RETRY_MS) return `${ide.name} is down; retry waits.`
  lastTry = now
  // Run /ide outside the calling hook: a command.run inside one would wait on itself.
  $.clock.after(0, () => {
    $.command.run({ command: 'ide' }).catch((err: unknown) => {
      $.ui.toast(`ide-reconnect: /ide failed: ${err instanceof Error ? err.message : String(err)}`)
    })
  })
  return `${ide.name} looked down (probe: ${reason}); reconnecting with /ide.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ide-reconnect',
      description: 'Check the IDE connection now and run /ide if it is down (no arguments)',
    })
    $.clock.every(POLL_MS, () => {
      check($, false).then(
        text => {
          if (text.includes('probe:') && text !== lastToast) $.ui.toast(`ide-reconnect: ${text}`)
          lastToast = text
        },
        (err: unknown) => $.ui.toast(`ide-reconnect: check failed: ${err instanceof Error ? err.message : String(err)}`),
      )
    })
    return next(e)
  })

  on('command.run', { command: 'ide-reconnect' }, async $ => ({ text: await check($, true) }))
}
