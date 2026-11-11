import type { FileEntry } from '@shared/ipc'
import { Film, Image } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const thumbnailUrls = new Map<string, string>()

function thumbnailKey(entry: FileEntry): string | null {
    const content = entry.sonyContent
    return content ? `${content.slot}:${content.contentId}:${content.fileId}` : null
}

/** The camera's own small JPEG of a card file, fetched once it scrolls into view. Falls back to an icon. */
export function CardThumbnail({ entry, video }: { entry: FileEntry; video: boolean }): React.JSX.Element {
    const key = thumbnailKey(entry)
    const [url, setUrl] = useState<string | null>(key ? (thumbnailUrls.get(key) ?? null) : null)
    const frameRef = useRef<HTMLSpanElement>(null)

    useEffect(() => {
        const frame = frameRef.current
        if (!key || url || !frame) return
        let cancelled = false
        const observer = new IntersectionObserver(observed => {
            if (!observed.some(item => item.isIntersecting)) return
            observer.disconnect()
            void window.studio.thumbnail(entry).then(result => {
                if (cancelled || !result.ok || !result.data) return
                const blobUrl = URL.createObjectURL(new Blob([new Uint8Array(result.data)], { type: 'image/jpeg' }))
                thumbnailUrls.set(key, blobUrl)
                setUrl(blobUrl)
            })
        })
        observer.observe(frame)
        return () => {
            cancelled = true
            observer.disconnect()
        }
    }, [key, url, entry])

    const Icon = video ? Film : Image
    return (
        <span
            ref={frameRef}
            className="flex h-9 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[4px] bg-foreground/6"
        >
            {url ? (
                <img src={url} alt="" className="size-full object-cover" draggable={false} />
            ) : (
                <Icon className="size-4 text-muted-foreground" aria-hidden />
            )}
        </span>
    )
}
