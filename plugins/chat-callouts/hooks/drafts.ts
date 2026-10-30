export const DRAFT_KINDS = ['slack', 'email', 'pr', 'ticket', 'other'] as const

export type DraftKind = (typeof DRAFT_KINDS)[number]

export type Segment =
  | { type: 'text'; text: string }
  | { type: 'draft'; kind: DraftKind; body: string; isOpen: boolean }

const DRAFT_OPEN = /^````draft (slack|email|pr|ticket|other)[ \t]*$/
const DRAFT_CLOSE = /^ {0,3}`{4,}[ \t]*$/
const FENCE_OPEN = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/

// Undefined when the text holds no draft fence, so the caller draws it untouched.
export function splitDrafts(text: string): Segment[] | undefined {
  const segments: Segment[] = []
  let plain: string[] = []
  let draft: { kind: DraftKind; lines: string[] } | undefined
  let fence: string | undefined

  for (const line of text.split('\n')) {
    if (draft) {
      if (DRAFT_CLOSE.test(line)) {
        segments.push({ type: 'draft', kind: draft.kind, body: draft.lines.join('\n'), isOpen: false })
        draft = undefined
      } else {
        draft.lines.push(line)
      }
      continue
    }
    if (fence) {
      const bare = line.trim()
      if (bare.length >= fence.length && bare === fence[0]!.repeat(bare.length)) fence = undefined
      plain.push(line)
      continue
    }
    const opener = DRAFT_OPEN.exec(line)
    if (opener) {
      if (plain.join('').trim()) segments.push({ type: 'text', text: plain.join('\n') })
      plain = []
      draft = { kind: opener[1] as DraftKind, lines: [] }
      continue
    }
    fence = FENCE_OPEN.exec(line)?.[1]
    plain.push(line)
  }

  if (draft) segments.push({ type: 'draft', kind: draft.kind, body: draft.lines.join('\n'), isOpen: true })
  else if (plain.join('').trim()) segments.push({ type: 'text', text: plain.join('\n') })

  return segments.some(s => s.type === 'draft') ? segments : undefined
}

export function lastDraft(text: string): string | undefined {
  return splitDrafts(text)
    ?.flatMap(s => (s.type === 'draft' ? [s.body] : []))
    .at(-1)
}
