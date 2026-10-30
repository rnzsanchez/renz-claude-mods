import type { EngineInterface, Register, RenderElement, RenderInputOf, ThemeKey, UiCopyArgs } from 'claude-code'

import type { ChatCalloutsPrefs, ChatCalloutsStyle } from '../types'
import { lastDraft, splitDrafts } from './drafts'
import type { DraftKind, Segment } from './drafts'

const STYLES: readonly ChatCalloutsStyle[] = ['label', 'box', 'bar']
const seenAt = { plugin: 'chat-callouts', key: 'seenAt' } as const

const DRAFT_COLORS: Record<DraftKind, ThemeKey> = {
  slack: 'autoAccept',
  email: 'planMode',
  pr: 'suggestion',
  ticket: 'permission',
  other: 'subtle',
}
const DRAFT_LABELS: Record<DraftKind, string> = { slack: 'Slack', email: 'Email', pr: 'PR', ticket: 'Ticket', other: 'Other' }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const DRAFT_PROMPT =
  'When the user asks you to draft a message for someone else (a Slack message, an email, a PR comment or a ticket), ' +
  'put only the draft text inside a fence of four backticks whose info string is `draft <kind>`, kind being slack, email, pr, ticket or other, ' +
  'and close it with four backticks. Keep any commentary outside the fence.'
const EIGHTHS = ['▏', '▎', '▍', '▌', '▋', '▊', '▉']
const barGlyphs = (width: number) => Array.from({ length: 200 }, () => EIGHTHS[width - 1]).join('\n')
const PROMPT_SKIP_TRAITS = ['teammate', 'print', 'bare']

const USAGE = ({ style, isOn, width }: ChatCalloutsPrefs) =>
  [
    `Reply style: ${style} (${isOn ? 'on' : 'off'}), bar width ${width}`,
    '/banners style label|box|bar  pick the reply frame',
    '/banners width 1-8                  bar thickness, 8 is a full cell',
    '/banners on | off                   turn the frames on or off',
    '/banners stats                      show draw timings',
  ].join('\n')

type Reply = RenderInputOf<'AssistantMessage', 'terminal'>
type DrawText = (text: string, isFirstOfReply: boolean) => Promise<RenderElement>

const stats = { draws: 0, totalMs: 0, maxMs: 0 }
const firstDrawn = new Map<string, number>()

const isWidth = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 8

function clockText(at: number, now: number): string {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return d.toDateString() === new Date(now).toDateString() ? hhmm : `${MONTHS[d.getMonth()]} ${d.getDate()} ${hhmm}`
}

async function timeOf($: EngineInterface, requestId: string, now: number): Promise<string> {
  const { value } = await $.state.get({ ...seenAt, id: requestId })
  if (value === undefined && !firstDrawn.has(requestId)) firstDrawn.set(requestId, now)
  return clockText(value ?? firstDrawn.get(requestId) ?? now, now)
}

async function copyDraft($: EngineInterface, text: string, surface?: UiCopyArgs['surface']): Promise<string> {
  const copied = await $.ui.copy({ text, surface })
  return copied.isCopied ? 'Draft copied.' : `Draft not copied: ${copied.reason}.`
}

async function drawSegments($: EngineInterface, e: Reply, segments: Segment[], drawText: DrawText): Promise<RenderElement[]> {
  const { Box, Button, Text } = $.ui.resolve(e)
  let isFirst = e.props.isFirstOfReply
  const drawn: RenderElement[] = []
  for (const [i, seg] of segments.entries()) {
    if (seg.type === 'text') {
      drawn.push(await drawText(seg.text, isFirst))
      isFirst = false
      continue
    }
    const color = DRAFT_COLORS[seg.kind]
    drawn.push(
      <Box flexDirection="column" borderStyle="double" borderColor={color} paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color={color}>
            Draft · {DRAFT_LABELS[seg.kind]}
            {seg.isOpen ? ' · writing…' : ''}
          </Text>
          {!seg.isOpen && (
            <Button
              key={`copy-${i}`}
              label="Copy"
              onPress={press => {
                void copyDraft($, seg.body, press.surface).then(text => $.ui.toast(text))
              }}
            />
          )}
        </Box>
        <Text>{seg.body}</Text>
      </Box>,
    )
  }
  return drawn
}

function drawBar(
  { Box, Text }: ReturnType<EngineInterface['ui']['resolve']>,
  color: ThemeKey,
  width: number,
  label: RenderElement | false,
  body: RenderElement | RenderElement[],
): RenderElement {
  return (
    <Box flexDirection="row" marginTop={label ? 1 : 0}>
      {width === 8 ? (
        <Box position="absolute" top={0} bottom={0} left={0} width={1} backgroundColor={color} />
      ) : (
        <Box position="absolute" top={0} bottom={0} left={0} width={1} overflow="hidden">
          <Text color={color}>{barGlyphs(width)}</Text>
        </Box>
      )}
      <Box flexDirection="column" paddingLeft={2}>
        {label}
        {body}
      </Box>
    </Box>
  )
}

async function frameReply($: EngineInterface, e: Reply, { style, width }: ChatCalloutsPrefs, now: number, body: RenderElement[]): Promise<RenderElement> {
  const { Box, Text } = $.ui.resolve(e)
  const label = e.props.isFirstOfReply && (
    <Text>
      <Text bold color="claude">
        Claude
      </Text>
      <Text dimColor> · {await timeOf($, e.requestId, now)}</Text>
    </Text>
  )
  if (style === 'bar') return drawBar($.ui.resolve(e), 'claude', width, label, body)
  if (style === 'label') {
    if (!label && body.length === 1 && body[0]) return body[0]
    return (
      <Box flexDirection="column" marginTop={label ? 1 : 0}>
        {label}
        {body}
      </Box>
    )
  }
  return (
    <Box flexDirection="column" marginTop={label ? 1 : 0} borderStyle="round" borderColor="claude" paddingX={1}>
      {label}
      {body}
    </Box>
  )
}

const OPTION_FIELDS = ['style', 'width', 'isMineFramed', 'isDrafts'] as const

function normalise(value: unknown, base: ChatCalloutsPrefs): ChatCalloutsPrefs {
  const p = (value ?? {}) as Record<string, unknown>
  const style = p.style === 'quote' ? 'bar' : p.style
  return {
    style: STYLES.includes(style as ChatCalloutsStyle) ? (style as ChatCalloutsStyle) : base.style,
    isOn: typeof p.isOn === 'boolean' ? p.isOn : base.isOn,
    width: isWidth(p.width) ? p.width : base.width,
    isMineFramed: typeof p.isMineFramed === 'boolean' ? p.isMineFramed : base.isMineFramed,
    isDrafts: typeof p.isDrafts === 'boolean' ? p.isDrafts : base.isDrafts,
  }
}

let defaults: ChatCalloutsPrefs
let prefs: ChatCalloutsPrefs
let loading: Promise<void> | undefined

// Stored /banners choices win; an option the menu changed since the last load wins for that field only.
function ready($: EngineInterface): Promise<void> {
  return (loading ??= (async () => {
    const kept = normalise(await $.store.get('prefs'), defaults)
    const seen = (await $.store.get('defaults')) as Partial<ChatCalloutsPrefs> | undefined
    if (seen) for (const f of OPTION_FIELDS) if (seen[f] !== defaults[f]) Object.assign(kept, { [f]: defaults[f] })
    prefs = kept
    await $.store.set('prefs', prefs)
    await $.store.set('defaults', defaults)
  })())
}

async function save($: EngineInterface, change: Partial<ChatCalloutsPrefs>): Promise<void> {
  await ready($)
  prefs = { ...prefs, ...change }
  await $.store.set('prefs', prefs)
}

export const register: Register = (on, options) => {
  defaults = {
    style: STYLES.includes(options.replyStyle as ChatCalloutsStyle) ? (options.replyStyle as ChatCalloutsStyle) : 'bar',
    isOn: true,
    width: isWidth(options.barWidth) ? options.barWidth : 8,
    isMineFramed: options.barOnMyMessages !== false,
    isDrafts: options.draftBoxes !== false,
  }
  prefs = { ...defaults }
  loading = undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'banners',
      description: 'Mark who said what (bar, box or label). Run with no argument for help.',
      argumentHint: '[style label|box|bar] [width 1-8] [on|off] [stats]',
    })
    await $.command.register({ name: 'draftcopy', description: 'Copy the last draft Claude wrote (no arguments)' })
    return next(e)
  })

  on('session.append', { door: ['prompt', 'response'] }, async ($, e, next) => {
    if (e.agentId === undefined) await $.state.set({ ...seenAt, id: e.uuid }, await $.clock.now())
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    await ready($)
    if (!prefs.isDrafts || !e.surfaces.includes('terminal') || e.traits.some(t => PROMPT_SKIP_TRAITS.includes(t))) return composed
    return { sections: [...composed.sections, { id: 'chat-callouts:drafts', text: DRAFT_PROMPT, scope: 'session' }] }
  })

  on(
    'ui.render',
    { component: 'UserMessage', surface: 'terminal', props: { origin: { kind: /^(composer|bridge)$/ } } },
    async ($, e, next) => {
      await ready($)
      const { style, isOn, width, isMineFramed } = prefs
      if (!isOn) return next(e)
      const { Box, Text } = $.ui.resolve(e)
      const time = await timeOf($, e.requestId, await $.clock.now())
      const label = (
        <Text>
          <Text bold color="suggestion">
            You
          </Text>
          <Text dimColor> · {time}</Text>
        </Text>
      )
      if (!isMineFramed) {
        return (
          <Box flexDirection="column" marginTop={1}>
            {label}
            {await next(e)}
          </Box>
        )
      }
      if (style === 'bar') return drawBar($.ui.resolve(e), 'suggestion', width, label, await next(e))
      return (
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="suggestion" paddingX={1}>
          {label}
          {await next(e)}
        </Box>
      )
    },
  )

  on('ui.render', { component: 'AssistantMessage', surface: 'terminal' }, async ($, e, next) => {
    const started = await $.clock.now()
    await ready($)
    const { isOn, isDrafts } = prefs
    let tree: RenderElement
    if (!isOn || e.props.isSummary) {
      tree = await next(e)
    } else {
      const segments = isDrafts ? splitDrafts(e.props.text) : undefined
      const body = segments
        ? await drawSegments($, e, segments, (text, isFirstOfReply) => next({ ...e, props: { ...e.props, text, isFirstOfReply } }))
        : [await next(e)]
      tree = await frameReply($, e, prefs, started, body)
    }
    const ms = (await $.clock.now()) - started
    stats.draws += 1
    stats.totalMs += ms
    stats.maxMs = Math.max(stats.maxMs, ms)
    return tree
  })

  on('command.run', { command: 'banners' }, async ($, e) => {
    const [verb = '', arg = ''] = e.args.trim().split(/\s+/)
    if (verb === 'stats') {
      const mean = stats.draws ? (stats.totalMs / stats.draws).toFixed(1) : '0'
      return { text: `AssistantMessage hook: ${stats.draws} draws, mean ${mean} ms, max ${stats.maxMs} ms (since the last load).` }
    }
    if (verb === 'on' || verb === 'off') {
      await save($, { isOn: verb === 'on' })
      return { text: `Chat callouts ${verb}.` }
    }
    if (verb === 'width' && isWidth(Number(arg))) {
      await save($, { width: Number(arg), isOn: true })
      return { text: `Bar width: ${arg}.` }
    }
    if (verb === 'style' && STYLES.includes(arg as ChatCalloutsStyle)) {
      await save($, { style: arg as ChatCalloutsStyle, isOn: true })
      return { text: `Reply style: ${arg}.` }
    }
    await ready($)
    return { text: USAGE(prefs) }
  })

  on('command.run', { command: 'draftcopy' }, async $ => {
    const messages = await $.session.messages()
    for (const message of [...messages].reverse()) {
      const draft = message.role === 'assistant' ? lastDraft(message.text) : undefined
      if (draft !== undefined) return { text: await copyDraft($, draft) }
    }
    return { text: 'No draft found in this conversation.' }
  })
}
