export const LINKS = {
    github: 'https://github.com/darkgrade/darkgrade',
    discord: 'https://discord.gg/fbDbdJv9dX',
    youtube: 'https://www.youtube.com/watch?v=tsNWxj-pmU4',
    docs: 'https://darkgrade.com/docs/slate',
    commits: 'https://github.com/darkgrade/darkgrade/commits/main',
    x: 'https://x.com/darkgradehq',
    linkedin: 'https://www.linkedin.com/company/darkgrade',
    careers: '/careers',
    privacy: '/privacy',
    changelog: '/changelog',
    blog: '/blog',
    pressKit: '/press-kit',
    yCombinator: 'https://www.ycombinator.com/companies/darkgrade',
} as const

export const NPM_INSTALL = 'npm i @darkgrade/slate'

/** The two pill buttons, shared by the hero and the closing CTA. */
export const BTN =
    'inline-flex items-center gap-3 rounded-full px-8 py-[17px] text-[15px] tracking-[.03em] transition-[background,border-color,color,box-shadow] duration-[350ms]'
export const BTN_SOLID = `${BTN} bg-ink text-obsidian hover:bg-gold hover:shadow-[0_0_26px_rgba(244,198,110,.16)]`
export const BTN_GHOST = `${BTN} panel border border-hair text-ink hover:border-gold hover:text-gold hover:shadow-[0_0_26px_rgba(244,198,110,.16)]`
