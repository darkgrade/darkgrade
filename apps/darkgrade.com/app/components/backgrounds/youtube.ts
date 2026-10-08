/**
 * A YouTube video as a chromeless, muted, looping backdrop.
 *
 * YouTube offers no fully chromeless mode, so the chrome is removed three ways:
 *   - playerVars turn off controls, keyboard, fullscreen and annotations;
 *   - the iframe never receives a pointer (CSS on the frame), so hover chrome
 *     never appears;
 *   - the frame stays invisible until the video first plays, so the title
 *     card and big play button never show; the poster stands in until then.
 * The frame is also oversized vertically by the caller (see `#bgyt`), so the
 * title bar YouTube pins to the top edge of the player sits off-screen.
 *
 * Known gap: YouTube's player draws its own play/pause icon for about four
 * seconds on every start, including each pass of its loop, and nothing outside
 * the cross-origin frame can stop it. Accepted for now: once revealed, the
 * frame never hides again, so the motion is constant through the loop.
 */

type YouTubePlayer = {
    playVideo(): void
    pauseVideo(): void
    seekTo(seconds: number, allowSeekAhead: boolean): void
    getPlayerState(): number
    mute(): void
    destroy(): void
}

type YouTubeNamespace = {
    Player: new (
        element: HTMLElement,
        options: {
            host?: string
            videoId: string
            playerVars: Record<string, string | number>
            events: {
                onReady?: (event: { target: YouTubePlayer }) => void
                onStateChange?: (event: { data: number; target: YouTubePlayer }) => void
            }
        }
    ) => YouTubePlayer
    PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number; CUED: number }
}

declare global {
    interface Window {
        YT?: YouTubeNamespace
        onYouTubeIframeAPIReady?: () => void
    }
}

let apiPromise: Promise<YouTubeNamespace> | null = null

function loadIframeApi(): Promise<YouTubeNamespace> {
    if (window.YT?.Player) return Promise.resolve(window.YT)
    if (apiPromise) return apiPromise
    apiPromise = new Promise((resolve, reject) => {
        const previousReady = window.onYouTubeIframeAPIReady
        window.onYouTubeIframeAPIReady = () => {
            previousReady?.()
            if (window.YT) resolve(window.YT)
        }
        const script = document.createElement('script')
        script.src = 'https://www.youtube.com/iframe_api'
        script.async = true
        script.onerror = () => {
            apiPromise = null
            reject(new Error('YouTube iframe API failed to load'))
        }
        document.head.appendChild(script)
    })
    return apiPromise
}

/**
 * Mounts the player inside `mount` and reveals `frame` (an ancestor that
 * starts at opacity 0) the first time the video plays. Returns a teardown.
 */
export function createYouTubeBackdrop(mount: HTMLElement, frame: HTMLElement, videoId: string): () => void {
    /** Set once the player reports ready; until then its methods are missing. */
    let player: YouTubePlayer | null = null
    let created: YouTubePlayer | null = null
    let destroyed = false

    const onVisibility = () => {
        if (!player) return
        if (document.hidden) player.pauseVideo()
        else player.playVideo()
    }

    loadIframeApi()
        .then(YT => {
            if (destroyed) return
            created = new YT.Player(mount, {
                host: 'https://www.youtube-nocookie.com',
                videoId,
                playerVars: {
                    autoplay: 1,
                    mute: 1,
                    controls: 0,
                    disablekb: 1,
                    fs: 0,
                    iv_load_policy: 3,
                    playsinline: 1,
                    rel: 0,
                    cc_load_policy: 0,
                    // a one-video playlist is what makes `loop` work for a single embed
                    loop: 1,
                    playlist: videoId,
                    origin: location.origin,
                },
                events: {
                    // the player's methods only exist from here on
                    onReady: ({ target }) => {
                        if (destroyed) return
                        player = target
                        target.mute()
                        // autoplay has usually started it already; a second play() re-shows the controls
                        if (target.getPlayerState() !== window.YT?.PlayerState.PLAYING) target.playVideo()
                        document.addEventListener('visibilitychange', onVisibility)
                    },
                    onStateChange: ({ data, target }) => {
                        if (data === YT.PlayerState.PLAYING) frame.style.opacity = '1'
                        // the playlist loop normally restarts on its own; this covers a player that stops instead
                        if (data === YT.PlayerState.ENDED) {
                            target.seekTo(0, true)
                            target.playVideo()
                        }
                    },
                },
            })
        })
        .catch(() => {
            /* no YouTube: the poster stays up on its own */
        })

    return () => {
        destroyed = true
        document.removeEventListener('visibilitychange', onVisibility)
        created?.destroy()
        created = null
        player = null
    }
}
