export const LINKS = {
    github: 'https://github.com/darkgrade/darkgrade',
    discord: 'https://discord.gg/fbDbdJv9dX',
    youtube: 'https://www.youtube.com/watch?v=tsNWxj-pmU4',
    docs: 'https://darkgrade.com/docs/link',
    careers: 'https://notion.darkgrade.com/',
} as const

export const NPM_INSTALL = 'npm i @darkgrade/link'

/** Section eyebrow: 11px, wide-tracked, uppercase. Colour is the caller's,
 *  so two text-* utilities never race for the same declaration. */
export const LABEL = 'text-[11px] font-medium tracking-[.32em] uppercase'

/** Status pill next to an act title. Border and text colour are the caller's. */
export const CHIP =
    'inline-flex -translate-y-[6px] items-center gap-[9px] rounded-full px-[14px] py-[7px] font-mono text-[10px] tracking-[.22em] uppercase'

/** The two pill buttons, shared by the hero and the closing CTA. */
export const BTN =
    'inline-flex items-center gap-3 rounded-full px-8 py-[17px] text-[14px] font-[480] tracking-[.04em] transition-[background,border-color,color,box-shadow] duration-[350ms]'
export const BTN_SOLID = `${BTN} bg-ink text-obsidian hover:bg-gold hover:shadow-[0_0_26px_rgba(244,198,110,.16)]`
export const BTN_GHOST = `${BTN} border border-hair text-ink hover:border-gold hover:text-gold hover:shadow-[0_0_26px_rgba(244,198,110,.16)]`

/** Roadmap / legend state dots: filled = here today, outlined = on the way. */
export const MARK = 'relative top-[.5px] inline-block size-[9px] shrink-0 rounded-full'
export const MARK_ON = `${MARK} bg-gold shadow-[0_0_calc(6px*var(--gI))_rgba(244,198,110,.42)]`
export const MARK_NEXT = `${MARK} border border-[rgba(234,230,220,.32)] bg-transparent`

/** A lit filament dot, at 6px. */
export const FILAMENT =
    'inline-block size-[6px] shrink-0 rounded-full bg-gold shadow-[0_0_calc(7px*var(--gI))_rgba(244,198,110,.5)]'
