/* the one description of each product */

export type Feature = { text: string; on?: boolean }

export type Product = {
    name: string
    kind: string
    /** The one line that says it, set large. */
    tagline: string
    /** What it is and does, in a sentence. */
    does: string
    features: Feature[]
    lit?: boolean
}

const today = (text: string): Feature => ({ text, on: true })
const next = (text: string): Feature => ({ text })

export const STUDIO: Product = {
    name: 'Studio',
    kind: 'Desktop and mobile app',
    tagline: 'One tap & we’re rolling.',
    does: 'An app that sets your lights and camera, takes orders by voice and, soon, hands you a first cut.',
    features: [
        today('Lights and camera, set in one tap'),
        today('Works with the gear you already own'),
        today('Voice control for the whole studio'),
        next('A first cut the moment you stop recording'),
    ],
}

export const LINK: Product = {
    name: 'Link',
    kind: 'Open-source library',
    tagline: 'Your camera takes requests now.',
    does: 'A library that lets any app, script or local model run your camera.',
    lit: true,
    features: [
        today('Control your camera from any app'),
        today('Sony, Nikon and Canon through one API'),
        today('Local models drive it over MCP'),
        next('More camera brands'),
    ],
}

function FeatureRow({ feature }: { feature: Feature }) {
    return (
        <li
            className={`flex items-baseline justify-between gap-5 border-t border-hair py-[clamp(7px,1.2vh,11px)] text-body ${feature.on ? 'text-ink' : 'text-ink-62'}`}
        >
            <span>{feature.text}</span>
            <span
                className={`shrink-0 font-mono text-[10.5px] tracking-[.08em] uppercase ${feature.on ? 'text-gold' : 'text-ink-52'}`}
            >
                {feature.on ? 'Today' : 'Next'}
            </span>
        </li>
    )
}

/** A product's features as ruled rows, each marked as here today or next. */
export function FeatureList({ features }: { features: Feature[] }) {
    return (
        <ul className="border-b border-hair">
            {features.map(feature => (
                <FeatureRow key={feature.text} feature={feature} />
            ))}
        </ul>
    )
}
