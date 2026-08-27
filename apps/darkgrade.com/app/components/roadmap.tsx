import { FILAMENT, LABEL, MARK_NEXT, MARK_ON } from './site-links'

type Row =
    { kind: 'subhead'; text: string; full?: boolean; top?: boolean } | { kind: 'feat'; text: string; on?: boolean }

type Horizon = { num: string; title: string; lede: string; now?: boolean; rows: Row[] }

const feat = (text: string, on = false): Row => ({ kind: 'feat', text, on })

const HORIZONS: Horizon[] = [
    {
        num: '01',
        title: 'Control your camera from software',
        lede: 'The open-source engine that lets any app talk to your camera.',
        now: true,
        rows: [
            { kind: 'subhead', text: 'Control & capture', top: true },
            { kind: 'subhead', text: 'Connect & transfer', top: true },
            feat('Set ISO, shutter, aperture & more from code', true),
            feat('USB in the browser (WebUSB) & on a computer', true),
            feat('Capture photos', true),
            feat('Detects your camera automatically', true),
            feat('Live view streaming', true),
            feat('Pull photos & video off the camera', true),
            feat('Start / stop recording', true),
            feat('React to camera events in real time', true),
            { kind: 'subhead', text: 'Cameras', full: true },
            feat('Sony α — full support', true),
            feat('Wireless (Wi-Fi) control'),
            feat('Nikon Z — capture, settings, live view', true),
            feat('Nikon / Canon video & live view'),
            feat('Canon EOS R — control & events', true),
            feat('Fujifilm, Panasonic, Olympus & more'),
        ],
    },
    {
        num: '02',
        title: 'Upgrade your gear with software',
        lede: 'Features that used to need extra hardware, now a software toggle.',
        rows: [
            feat('Auto-capture on motion or sound'),
            feat('Recognize and follow your subject'),
            feat('Rack focus / follow focus, in software'),
            feat('Focus peaking & exposure scopes'),
            feat('Watch & tether every camera wirelessly'),
            feat('Turn your screen into a teleprompter'),
            feat('Drive sliders & gimbals'),
            feat('Use your camera as a great webcam'),
        ],
    },
    {
        num: '03',
        title: 'Start shooting in one click',
        lede: 'Studio sets up the room, rolls, and files everything for you.',
        rows: [
            feat('One tap to set lights, audio & exposure'),
            feat('Desktop & mobile app'),
            feat('Footage lands in your timeline automatically'),
            feat('Audio & video synced for you'),
            feat('See every camera live while you shoot'),
            feat('Loom-style creator recording'),
        ],
    },
    {
        num: '04',
        title: 'Talk to your studio',
        lede: 'Say what you want; AI sets up the shot — you stay in charge.',
        rows: [
            feat('Voice control for your whole studio'),
            feat('Let AI assistants run the camera (MCP)'),
            feat('Plain-language camera & studio commands'),
            feat('AI that understands what your camera sees'),
            feat('Runs local AI models, privately'),
            feat('Captures the context editing needs later'),
        ],
    },
    {
        num: '05',
        title: 'Skip editing altogether',
        lede: 'Hand off the tedious hours of post — keep every creative call.',
        rows: [
            feat('Auto-pick the best takes'),
            feat('Sync timecode, audio & multi-cam'),
            feat('Transcripts & captions'),
            feat('A first rough cut, assembled for you'),
            feat('Hand off to Premiere, DaVinci & Final Cut'),
            feat('Find & drop in B-roll'),
            feat('Match color & exposure across clips'),
            feat('Translate & dub into other languages'),
            feat('Vertical cutdowns & ready-to-post exports'),
            feat('Preview the whole piece before you shoot'),
        ],
    },
    {
        num: '06',
        title: 'Plug in the rest of your studio',
        lede: 'The hub your lights, sound, stream, and edit tools all talk to.',
        rows: [
            feat('OBS, Twitch & capture cards'),
            feat('DaVinci Resolve, Premiere & Final Cut'),
            feat('Home Assistant, Scrypted & HomeKit'),
            feat('Elgato Stream Deck & Prompter'),
            feat('Philips Hue & studio lighting'),
            feat('Audio interfaces, gimbals & sliders'),
            feat('Blackmagic Speed Editor / Console'),
            feat('Community templates & marketplace'),
        ],
    },
]

const STATUS = 'inline-flex items-center gap-[10px] font-mono text-[10px] tracking-[.22em] uppercase whitespace-nowrap'
const SUBHEAD = 'font-mono text-[9.5px] tracking-[.26em] text-ink-35 uppercase'
/* a subhead in the top row of the grid has no rule above it to separate from */
const SUBHEAD_RULE = 'mt-[26px] border-t border-[rgba(234,230,220,.07)] pt-[14px]'

export function Roadmap() {
    return (
        <section id="roadmap" className="pt-[clamp(110px,15vh,190px)] pb-[clamp(90px,12vh,150px)]">
            <div className="shell">
                <div className="mb-[clamp(30px,4vh,44px)] flex flex-wrap items-start justify-between gap-[18px]">
                    <div>
                        <h2
                            className="max-w-[15ch] font-serif text-[clamp(40px,5vw,72px)] leading-[1.06] font-normal tracking-[-.01em]"
                            data-reveal-lines
                        >
                            From “let’s shoot” to <em className="glow-hot italic">“it’s live.”</em>
                        </h2>
                        <p className="mt-[18px] max-w-[46ch] text-[15.5px] text-ink-55" data-fade>
                            Link is here today. We&apos;re building a lot more.
                        </p>
                    </div>
                    <span className={`${LABEL} text-ink-55`} data-fade>
                        <span className="mr-[14px] text-gold">02</span>The road ahead
                    </span>
                </div>

                <div
                    className="flex flex-wrap items-center justify-end gap-7 pt-[28px] pb-[20px] font-mono text-[10.5px] tracking-[.2em] text-ink-35 uppercase"
                    data-fade
                >
                    <span className="inline-flex items-center gap-[11px]">
                        <i className={MARK_ON} />
                        Here today
                    </span>
                    <span className="inline-flex items-center gap-[11px]">
                        <i className={MARK_NEXT} />
                        On the way
                    </span>
                </div>

                {HORIZONS.map(h => (
                    <article
                        key={h.num}
                        data-fade
                        // `horizon` is a cursor-hover hook for <SiteEffects>
                        className="horizon group/h relative border-t border-hair px-[clamp(8px,1.5vw,26px)] py-[clamp(30px,4.4vh,46px)] transition-[background] duration-500 last-of-type:border-b before:pointer-events-none before:absolute before:inset-0 before:bg-[image:linear-gradient(90deg,rgba(244,198,110,.07),transparent_55%)] before:opacity-0 before:transition-opacity before:duration-[550ms] before:content-[''] hover:before:opacity-100"
                    >
                        <div className="flex flex-wrap items-baseline justify-between gap-5">
                            <h3 className="flex items-baseline gap-[18px] font-serif text-[clamp(26px,2.9vw,42px)] leading-[1.1] font-normal tracking-[-.005em] max-[820px]:text-[clamp(23px,6vw,30px)]">
                                <span className="font-serif text-[.62em] text-ink-35 italic transition-[color,text-shadow] duration-[450ms] group-hover/h:text-gold group-hover/h:[text-shadow:0_0_15px_rgba(244,198,110,.45)]">
                                    {h.num}
                                </span>
                                {h.title}
                            </h3>
                            {h.now ? (
                                <span className={`${STATUS} text-gold`}>
                                    <span className={FILAMENT} />
                                    Shipping today
                                </span>
                            ) : (
                                <span className={`${STATUS} text-ink-35`}>
                                    <span className={MARK_NEXT} />
                                    On the way
                                </span>
                            )}
                        </div>

                        <p className="mt-3 max-w-[58ch] text-[15px] text-ink-55">{h.lede}</p>

                        <div className="mt-[clamp(22px,3vh,32px)] grid grid-cols-2 gap-x-[clamp(28px,4vw,72px)] gap-y-[2px] max-[820px]:grid-cols-1">
                            {h.rows.map((row, i) =>
                                row.kind === 'subhead' ? (
                                    <div
                                        key={`${h.num}-${i}`}
                                        className={`${SUBHEAD} ${row.top ? '' : SUBHEAD_RULE} ${
                                            row.full ? 'col-span-full' : ''
                                        }`}
                                    >
                                        {row.text}
                                    </div>
                                ) : (
                                    <div
                                        key={`${h.num}-${i}`}
                                        className={`flex items-baseline gap-[14px] py-2 text-[14.5px] ${
                                            row.on ? 'text-ink' : 'text-ink-55'
                                        }`}
                                    >
                                        <i className={`${row.on ? MARK_ON : MARK_NEXT} self-center`} />
                                        <span>{row.text}</span>
                                    </div>
                                )
                            )}
                        </div>
                    </article>
                ))}
            </div>
        </section>
    )
}
