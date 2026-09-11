import { LABEL } from './site-links'

const LINE = 'max-w-[19ch] font-serif text-[clamp(38px,5.6vw,88px)] leading-[1.14] font-normal tracking-[-.01em]'
const DIM = 'text-[rgba(234,230,220,.46)]'

export function Manifesto() {
    return (
        <section className="py-[clamp(120px,18vh,220px)]">
            <div className="shell">
                <p className={`${LINE} ${DIM}`} data-reveal-lines>
                    Making videos is ten percent fun.
                </p>
                <p className={`${LINE} ${DIM} mt-[.4em]`} data-reveal-lines>
                    The rest is menus and an edit that never ends.
                </p>
                <p className={`${LINE} mt-[.8em]`} data-reveal-lines>
                    We’re deleting <em className="glow-hot italic">the rest.</em>
                </p>
                <div className="mt-[46px] flex items-center gap-[18px]" data-fade>
                    <span className="lit-rule h-px w-[72px]" />
                    <span className={`${LABEL} text-ink-55`}>Our thesis</span>
                </div>
            </div>
        </section>
    )
}
