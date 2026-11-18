import { App } from '@renderer/App'
import { PerfWindow } from '@renderer/components/PerfMonitor'
import { PreferencesWindow } from '@renderer/components/PreferencesWindow'
import { perf } from '@renderer/lib/perf'
import '@renderer/styles.css'
import { Profiler, StrictMode } from 'react'
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

// Studio's windows on macOS are vibrancy: the page leaves its background clear so the system material shows.
if (navigator.userAgent.includes('Macintosh')) document.documentElement.dataset.vibrancy = ''

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        {window.location.hash === '#preferences' ? (
            <PreferencesWindow />
        ) : window.location.hash === '#perf' ? (
            <PerfWindow />
        ) : (
            // React's own render time, for the performance monitor (development builds report it).
            <Profiler id="app" onRender={(_id, _phase, milliseconds) => perf.cpu('React rendering', milliseconds)}>
                <App />
            </Profiler>
        )}
    </StrictMode>
)
