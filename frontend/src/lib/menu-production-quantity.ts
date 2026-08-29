type GroupedPortionItem = {
  group?: string
  portion: number
}

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
