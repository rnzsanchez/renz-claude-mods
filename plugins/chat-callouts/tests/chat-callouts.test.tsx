import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PLUGIN = 'chat-callouts'
const FENCE = '````'

function engine(on: On, stored: Record<string, unknown> = {}): Record<string, unknown>[] {
  mock.store(on, stored)
  const seen: Record<string, unknown>[] = []
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    const props = e.props as Record<string, unknown>
    seen.push(props)
    return <Text>engine:{String(props.text)}</Text>
  })
  return seen
}

function userRow(kind: 'composer' | 'task-notification') {
  return { component: 'UserMessage', requestId: 'u1', props: { text: 'hello', origin: { kind }, isExpanded: false } } as const
}

const bar = (color: string) => ({ type: 'Box', props: { position: 'absolute', width: 1, backgroundColor: color } })

function banners(args: string) {
  return { command: 'banners', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
}

function replyRow(text: string, extra: { isSummary?: true } = {}) {
  return { component: 'AssistantMessage', requestId: 'a1', props: { text, isFirstOfReply: true, ...extra } } as const
}

test('the bar style draws a 1-column background bar for You and Claude', async ($, on) => {
  mock.clock(on)
  engine(on)

  const prompt = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...userRow('composer') })
  expect(await prompt.find(bar('suggestion'))).toBeDefined()
  expect(await prompt.find({ type: 'Text', text: /^You · / })).toBeDefined()
  await prompt.unmount()

  const reply = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...replyRow('Hi') })
  expect(await reply.find(bar('claude'))).toBeDefined()
  expect(await reply.find({ type: 'Text', text: /^Claude · / })).toBeDefined()
  expect(await reply.drawn()).toMatchObject({ type: 'Box', props: { marginTop: 1 } })
  await reply.unmount()

  const more = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AssistantMessage', requestId: 'a1', props: { text: 'Again', isFirstOfReply: false } })
  expect(await more.find(bar('claude'))).toBeDefined()
  expect(await more.find({ type: 'Text', text: /^Claude/ })).toBeUndefined()
  expect(await more.drawn()).toMatchObject({ type: 'Box', props: { marginTop: 0 } })
  await more.unmount()
})

test('the You box draws (box style) on terminal prompts only', { options: { replyStyle: 'box' } }, async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 30, 12, 0) })
  engine(on)
  on('command.register', () => ({ value: { command: 'banners' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const prompt = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...userRow('composer') })
  expect((await prompt.find({ type: 'Text', text: /^You/ }))?.text).toMatch(/^You · \d\d:\d\d$/)
  expect(await prompt.drawn()).toMatchObject({ type: 'Box', props: { borderStyle: 'round', borderColor: 'suggestion' } })
  await prompt.unmount()

  const notice = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...userRow('task-notification') })
  expect(await notice.find({ type: 'Text', text: /^You/ })).toBeUndefined()
  await notice.unmount()

  const desktop = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...userRow('composer') })
  expect(await desktop.find({ type: 'Text', text: /^You/ })).toBeUndefined()
  await desktop.unmount()
})

test('replies get the Claude label on terminal, not on desktop or summaries', async ($, on) => {
  mock.clock(on)
  engine(on)

  const reply = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...replyRow('Hi there') })
  expect(await reply.find({ type: 'Text', text: /^Claude · / })).toBeDefined()
  expect(await reply.find({ type: 'Text', text: 'engine:Hi there' })).toBeDefined()
  await reply.unmount()

  const desktop = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...replyRow('Hi there') })
  expect(await desktop.find({ type: 'Text', text: /^Claude/ })).toBeUndefined()
  await desktop.unmount()

  const summary = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...replyRow('Read 3 files', { isSummary: true }) })
  expect(await summary.drawn()).toMatchObject({ type: 'Text' })
  expect(await summary.find({ type: 'Text', text: /^Claude/ })).toBeUndefined()
  await summary.unmount()
})

test('a closed draft is boxed and copies its text', async ($, on) => {
  mock.clock(on)
  const seen = engine(on)
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.toast', () => ({ value: undefined }))

  const text = `Here it is:\n${FENCE}draft slack\nShip it today.\n${FENCE}\nWant changes?`
  const reply = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...replyRow(text) })
  expect(await reply.find({ type: 'Text', text: 'Draft · Slack' })).toBeDefined()
  expect(await reply.find({ type: 'Text', text: 'Ship it today.' })).toBeDefined()
  expect(seen.map(p => [p.text, p.isFirstOfReply])).toEqual([
    ['Here it is:', true],
    ['Want changes?', false],
  ])
  await reply.press({ key: 'copy-1' })
  expect(copied).toEqual(['Ship it today.'])
  await reply.unmount()
})

test('an unclosed draft draws as in progress, with no Copy yet', async ($, on) => {
  mock.clock(on)
  engine(on)

  const reply = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...replyRow(`${FENCE}draft email\nHi Sam,\nThe rep`) })
  expect(await reply.find({ type: 'Text', text: 'Draft · Email · writing…' })).toBeDefined()
  expect(await reply.find({ type: 'Text', text: 'Hi Sam,\nThe rep' })).toBeDefined()
  expect(await reply.findAll({ type: 'Button' })).toHaveLength(0)
  await reply.unmount()
})

test('a code block inside a draft stays in the draft', async ($, on) => {
  mock.clock(on)
  const seen = engine(on)

  const body = 'Run this:\n```sh\nmake plan\n```\nThanks'
  const reply = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...replyRow(`${FENCE}draft pr\n${body}\n${FENCE}\nDone.`) })
  expect(await reply.find({ type: 'Text', text: body })).toBeDefined()
  expect(seen.map(p => p.text)).toEqual(['Done.'])
  await reply.unmount()
})

test('/banners switches the style over the menu default', { options: { replyStyle: 'label' } }, async ($, on) => {
  mock.clock(on)
  engine(on)
  on('command.register', () => ({ value: { command: 'banners' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const menuDefault = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...replyRow('Hi') })
  expect(JSON.stringify(await menuDefault.drawn())).not.toContain('backgroundColor')
  expect(await menuDefault.find({ type: 'Text', text: /^Claude · / })).toBeDefined()
  await menuDefault.unmount()

  expect((await $.command.run(banners('style box'))).text).toBe('Reply style: box.')
  const reply = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...replyRow('Hi') })
  expect(await reply.drawn()).toMatchObject({ type: 'Box', props: { borderStyle: 'round', borderColor: 'claude' } })
  await reply.unmount()

  const usage = (await $.command.run(banners(''))).text
  expect(usage).toMatch(/^Reply style: box \(on\), bar width 8\n\/banners style /)
  expect((await $.command.run(banners('nope'))).text).toBe(usage)

  await $.command.run(banners('off'))
  const plain = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...replyRow('Hi') })
  expect(await plain.drawn()).toMatchObject({ type: 'Text' })
  await plain.unmount()
})

test('/banners width draws eighth-block glyphs below 8 and a background bar at 8', async ($, on) => {
  mock.clock(on)
  engine(on)
  on('command.register', () => ({ value: { command: 'banners' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect((await $.command.run(banners('width 2'))).text).toBe('Bar width: 2.')
  const thin = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...replyRow('Hi') })
  const glyphs = { type: 'Text', props: { color: 'claude' }, text: /^▎(\n▎)+$/ }
  expect(await thin.find(glyphs)).toBeDefined()
  await thin.unmount()

  await $.command.run(banners('width 8'))
  const full = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...replyRow('Hi') })
  expect(await full.find(bar('claude'))).toBeDefined()
  expect(await full.find(glyphs)).toBeUndefined()
  await full.unmount()

  expect((await $.command.run(banners('width 9'))).text).toMatch(/bar width 8/)
})

test('barOnMyMessages off leaves your messages with just the label', { options: { barOnMyMessages: false } }, async ($, on) => {
  mock.clock(on)
  engine(on)

  const prompt = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...userRow('composer') })
  expect(await prompt.find({ type: 'Text', text: /^You · / })).toBeDefined()
  expect(JSON.stringify(await prompt.drawn())).not.toContain('backgroundColor')
  await prompt.unmount()

  const reply = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...replyRow('Hi') })
  expect(await reply.find(bar('claude'))).toBeDefined()
  await reply.unmount()
})

test('barWidth sets the starting width', { options: { barWidth: 3 } }, async ($, on) => {
  mock.clock(on)
  engine(on)

  const reply = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...replyRow('Hi') })
  const glyphs = { type: 'Text', text: /^▍(\n▍)+$/ }
  expect(await reply.find(glyphs)).toBeDefined()
  await reply.unmount()
})

test('draftBoxes off draws drafts as plain text and adds no prompt section', { options: { draftBoxes: false } }, async ($, on) => {
  mock.clock(on)
  on('prompt.compose', () => ({ sections: [] }))
  const seen = engine(on)

  const text = `${FENCE}draft slack\nShip it.\n${FENCE}`
  const reply = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...replyRow(text) })
  expect(await reply.find({ type: 'Text', text: 'Draft · Slack' })).toBeUndefined()
  expect(seen.map(p => p.text)).toEqual([text])
  await reply.unmount()

  const composed = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] })
  expect(composed.sections.some(section => section.id === 'chat-callouts:drafts')).toBe(false)
})

const glyphsAt = (glyph: string) => ({ type: 'Text', text: new RegExp(`^${glyph}(\\n${glyph})+$`) })

test('a width stored with /banners survives a reload with the default option and keeps its other fields', async ($, on) => {
  mock.clock(on)
  engine(on, { prefs: { style: 'bar', width: 2 }, defaults: { style: 'bar', isOn: true, width: 8, isMineFramed: true, isDrafts: true } })

  const reply = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...replyRow('Hi') })
  expect(await reply.find(glyphsAt('▎'))).toBeDefined()
  await reply.unmount()

  const prompt = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...userRow('composer') })
  expect(await prompt.find(glyphsAt('▎'))).toBeDefined()
  await prompt.unmount()
})

test('an option changed in the menu since the last load beats the stored value for that field only', { options: { barWidth: 5 } }, async ($, on) => {
  mock.clock(on)
  engine(on, { prefs: { style: 'bar', width: 2 }, defaults: { style: 'bar', isOn: true, width: 8, isMineFramed: true, isDrafts: true } })

  const reply = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...replyRow('Hi') })
  expect(await reply.find(glyphsAt('▋'))).toBeDefined()
  expect(await reply.find(glyphsAt('▎'))).toBeUndefined()
  await reply.unmount()
})
