/**
 * A Mux video as a muted, looping backdrop.
 *
 * The stream plays in a bare <video> with no controls attribute, so there is no
 * player chrome to hide. hls.js feeds the HLS stream through Media Source
 * Extensions; where those are missing (iOS Safari) the video plays it natively. `frame` (an ancestor that starts at
 * opacity 0) is revealed the first time the video plays; the poster stands in
 * until then, and if the stream never loads.
 */

export const MUX_STREAM_ORIGIN = 'https://stream.mux.com'

export function createMuxBackdrop(video: HTMLVideoElement, frame: HTMLElement, playbackId: string): () => void {
    const streamUrl = `${MUX_STREAM_ORIGIN}/${playbackId}.m3u8`
    let destroyed = false
    let destroyStream: (() => void) | null = null

    const reveal = () => {
        frame.style.opacity = '1'
    }
    const onVisibility = () => {
        if (document.hidden) video.pause()
        else void video.play().catch(() => {})
    }

    video.addEventListener('playing', reveal, { once: true })
    document.addEventListener('visibilitychange', onVisibility)

    void import('hls.js').then(({ default: Hls }) => {
        if (destroyed) return
        if (!Hls.isSupported()) {
            video.src = streamUrl
            void video.play().catch(() => {})
            return
        }
        const hls = new Hls({ capLevelToPlayerSize: true })
        hls.loadSource(streamUrl)
        hls.attachMedia(video)
        hls.on(Hls.Events.MANIFEST_PARSED, () => void video.play().catch(() => {}))
        destroyStream = () => hls.destroy()
    })

    return () => {
        destroyed = true
        video.removeEventListener('playing', reveal)
        document.removeEventListener('visibilitychange', onVisibility)
        destroyStream?.()
        video.removeAttribute('src')
        video.load()
    }
}
