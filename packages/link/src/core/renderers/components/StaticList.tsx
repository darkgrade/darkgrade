import { Box } from 'ink'
import React from 'react'

export interface StaticListProps<T> {
    items: T[]
    children: (item: T, index: number) => React.ReactNode
}

export function StaticList<T extends { key: string }>(props: StaticListProps<T>) {
    const { items, children: render } = props
    // The logger owns retention; keeping a second history here defeats its memory bound.
    return <Box flexDirection="column">{items.map(render)}</Box>
}
