import { RollBoard } from './roll-board'

const INVESTORS = [
    'Y COMBINATOR',
    'ORANGE COLLECTIVE',
    'FORWARD DEPLOYED VC',
    'COUGHDROP CAPITAL',
    'TANGO.VC',
    'DTX VENTURES',
    'TRANSPOSE PLATFORM',
    'IMAGINATION CAPITAL',
    'GOOD AI CAPITAL',
    '5X5 STUDIO',
    'NEWALPHA VC',
]

/** "Backed by", a rolling board of investor names. */
export function BackedBy({ className }: { className?: string }) {
    return (
        <RollBoard
            label="BACKED BY"
            align="right"
            direction="down"
            items={INVESTORS.map(investor => ({ key: investor, node: investor }))}
            spoken={INVESTORS.join(', ')}
            className={className}
        />
    )
}
