import { RollBoard } from './roll-board'

/* Ordered so the same brand never sits next to itself, including across the
   wrap from the last name back to the first. Five of the nine are Sony, and a
   loop of nine can only keep four of one brand apart, so exactly one pair
   (A7III -> A7V) has to touch. */
const CAMERAS = [
    'SONY A7 IV',
    'CANON EOS 80D',
    'SONY A7III',
    'SONY A7V',
    'CANON R6 MK III',
    'SONY FX2',
    'NIKON Z6 III',
    'SONY A6700',
    'OLYMPUS E-PL5',
]

/** "Tested on", a rolling board of camera names. */
export function TestedOn({ className }: { className?: string }) {
    return (
        <RollBoard
            label="TESTED ON"
            items={CAMERAS.map(camera => ({ key: camera, node: camera }))}
            spoken={CAMERAS.join(', ')}
            className={className}
        />
    )
}
