import { MARK_NEXT, MARK_ON } from '@/app/components/site-links'

/* the one description of each product */

export type Feature = { text: string; on?: boolean }

export type Product = { name: string; kind: string; features: Feature[]; lit?: boolean }

const today = (text: string): Feature => ({ text, on: true })
const next = (text: string): Feature => ({ text })

export const STUDIO: Product = {
    name: 'Studio',
    kind: 'No-code desktop & mobile app',
    features: [
        today('Set up your lights and camera in one tap'),
        today('Works with the gear you already own'),
        today('Voice control for your whole studio'),
        next('A first cut ready when you stop recording'),
    ],
}

export const LINK: Product = {
    name: 'Link',
    kind: 'Open-source library',
    lit: true,
    features: [
        today('Control your camera from any app'),
        today('Works with Sony / Nikon / Canon'),
        today('Let local models control your camera with MCP'),
        next('More camera brands'),
    ],
}

function FeatureRow({ feature }: { feature: Feature }) {
    return (
        <li className={`flex items-start gap-[12px] py-[6px] text-body ${feature.on ? 'text-ink' : 'text-ink-66'}`}>
            {/* one line tall, so the dot centres on the first line however many lines the text wraps to */}
            <span className="flex h-[1lh] items-center">
                <i className={feature.on ? MARK_ON : MARK_NEXT} />
            </span>
            <span>
                <span className="sr-only">{feature.on ? 'Here today: ' : 'On the way: '}</span>
                {feature.text}
            </span>
        </li>
    )
}

/** Bullets marked here today (filled dot) or on the way (hollow dot). */
export function FeatureList({ features }: { features: Feature[] }) {
    return (
        <ul>
            {features.map(feature => (
                <FeatureRow key={feature.text} feature={feature} />
            ))}
        </ul>
    )
}
