import type { ClipListItem } from '@/lib/clipboard/types'

export type Selection = {
  /** Selected ids (unordered; act on them in display order). */
  ids: string[]
  /** The card that has the focus ring / is previewed by Quick Look. */
  activeId: string | null
  /** Where ⇧-extension started. */
  anchorId: string | null
}

export const emptySelection: Selection = { ids: [], activeId: null, anchorId: null }

export const singleSelection = (id: string): Selection => ({ ids: [id], activeId: id, anchorId: id })

const indexOfId = (items: ClipListItem[], id: string | null) => (id ? items.findIndex((item) => item.id === id) : -1)

export const moveSelection = (
  items: ClipListItem[],
  selection: Selection,
  target: 'next' | 'prev' | 'first' | 'last',
  extend: boolean
): Selection => {
  if (items.length === 0) {
    return emptySelection
  }

  const current = indexOfId(items, selection.activeId)
  let next = current

  if (target === 'first') {
    next = 0
  } else if (target === 'last') {
    next = items.length - 1
  } else if (target === 'next') {
    next = current < 0 ? 0 : Math.min(items.length - 1, current + 1)
  } else {
    next = current < 0 ? 0 : Math.max(0, current - 1)
  }

  const nextId = items[next].id

  if (!extend) {
    return singleSelection(nextId)
  }

  const anchorId = selection.anchorId && indexOfId(items, selection.anchorId) >= 0 ? selection.anchorId : nextId
  const anchor = indexOfId(items, anchorId)
  const [from, to] = anchor <= next ? [anchor, next] : [next, anchor]

  return { ids: items.slice(from, to + 1).map((item) => item.id), activeId: nextId, anchorId }
}

export const clickSelection = (
  items: ClipListItem[],
  selection: Selection,
  id: string,
  modifiers: { meta: boolean; shift: boolean }
): Selection => {
  if (modifiers.shift) {
    const anchorId = selection.anchorId && indexOfId(items, selection.anchorId) >= 0 ? selection.anchorId : id
    const anchor = indexOfId(items, anchorId)
    const clicked = indexOfId(items, id)
    const [from, to] = anchor <= clicked ? [anchor, clicked] : [clicked, anchor]

    return { ids: items.slice(from, to + 1).map((item) => item.id), activeId: id, anchorId }
  }

  if (modifiers.meta) {
    const selected = new Set(selection.ids)

    if (selected.has(id)) {
      selected.delete(id)
      const remaining = [...selected]
      return {
        ids: remaining,
        activeId: selection.activeId === id ? (remaining[remaining.length - 1] ?? null) : selection.activeId,
        anchorId: selection.anchorId === id ? (remaining[0] ?? null) : selection.anchorId,
      }
    }

    selected.add(id)
    return { ids: [...selected], activeId: id, anchorId: id }
  }

  return singleSelection(id)
}

export const selectAllItems = (items: ClipListItem[], selection: Selection): Selection => {
  if (items.length === 0) {
    return emptySelection
  }

  return {
    ids: items.map((item) => item.id),
    activeId: selection.activeId ?? items[0].id,
    anchorId: items[0].id,
  }
}

/** Keep the selection valid after the list changed without disturbing it more than necessary. */
export const reconcileSelection = (
  items: ClipListItem[],
  selection: Selection,
  previousItems: ClipListItem[]
): Selection => {
  if (items.length === 0) {
    return emptySelection
  }

  const present = new Set(items.map((item) => item.id))
  let activeId = selection.activeId && present.has(selection.activeId) ? selection.activeId : null

  if (!activeId) {
    const previousIndex = indexOfId(previousItems, selection.activeId)
    activeId = items[Math.min(items.length - 1, Math.max(0, previousIndex))].id
  }

  let ids = selection.ids.filter((id) => present.has(id))

  if (ids.length === 0 || !ids.includes(activeId)) {
    ids = ids.length === 0 ? [activeId] : ids.concat(activeId)
  }

  const anchorId = selection.anchorId && present.has(selection.anchorId) ? selection.anchorId : activeId

  return { ids, activeId, anchorId }
}
