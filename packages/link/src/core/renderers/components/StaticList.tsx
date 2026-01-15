import { Box } from 'ink'
import React, { useMemo, useRef } from 'react'

export interface StaticListProps<T> {
    items: T[]
    children: (item: T, index: number) => React.ReactNode
}

export function StaticList<T extends { key: string }>(props: StaticListProps<T>) {
    const { items, children: render } = props
    const renderedItems = useRef<T[]>([])
    const seenKeys = useRef<Set<string>>(new Set())

    const itemsToRender = useMemo(() => {
        const newItems: T[] = []

        for (const item of items) {
            if (!seenKeys.current.has(item.key)) {
                seenKeys.current.add(item.key)
                renderedItems.current.push(item)
                newItems.push(item)
            }
        }

        return renderedItems.current
    }, [items])

    const children = itemsToRender.map((item, index) => {
        return render(item, index)
    })

    return <Box flexDirection="column">{children}</Box>
}
