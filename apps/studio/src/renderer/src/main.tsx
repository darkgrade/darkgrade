import { App } from '@renderer/App'
import '@renderer/styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

const SCROLL_PILL_LINGER_MS = 900
const scrollTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>()

/** Shows a view's scroll pill while it scrolls and hides it shortly after, like macOS overlay scrollbars. */
function watchScrolling(): void {
    document.addEventListener(
        'scroll',
        event => {
            const target = event.target instanceof Element ? event.target : document.scrollingElement
            if (!target) return
            target.classList.add('is-scrolling')
            const previous = scrollTimers.get(target)
            if (previous) clearTimeout(previous)
            scrollTimers.set(
                target,
                setTimeout(() => target.classList.remove('is-scrolling'), SCROLL_PILL_LINGER_MS)
            )
        },
        { capture: true, passive: true }
    )
}

watchScrolling()

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>
)
