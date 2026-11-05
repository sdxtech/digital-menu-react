type GroupedPortionItem = {
  group?: string
  portion: number
}

type GroupedMenuItem = {
  group?: string
  menuName: string
}

export const sortMenuItemsByGroup = <T extends GroupedMenuItem>(items: T[]) =>
  [...items].sort((left, right) => {
    const groupComparison = (left.group?.trim() || '-').localeCompare(
      right.group?.trim() || '-',
      'en',
      { numeric: true, sensitivity: 'base' },
    )
    if (groupComparison !== 0) return groupComparison

    return left.menuName.localeCompare(right.menuName, 'en', {
      numeric: true,
      sensitivity: 'base',
    })
  })

export const summarizePortionsByGroup = (items: GroupedPortionItem[]) => {
  const groups = Array.from(
    items.reduce((portions, item) => {
      const groupName = item.group?.trim() || '-'
      const portion = Number(item.portion)
      if (!Number.isFinite(portion)) return portions

      portions.set(
        groupName,
        Math.max(portions.get(groupName) ?? 0, portion),
      )
      return portions
    }, new Map<string, number>()),
    ([name, portion]) => ({ name, portion }),
  )

  return {
    groups,
    total: groups.reduce((total, item) => total + item.portion, 0),
  }
}
