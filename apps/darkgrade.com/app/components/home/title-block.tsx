import { BACKED_BY, TESTED_ON } from '@/app/components/home/content'
import { RollBoard } from '@/app/components/roll-board'

const CELL = 'flex min-w-0 flex-col justify-between gap-[6px] border-l border-hair px-[18px] py-[13px] first:border-l-0'
const CELL_NAME = 'text-ink-52'
/** A printer's crop mark at one corner, drawn just outside the box it marks. */
const CROP = 'pointer-events-none absolute size-[14px] border-ink/40'

function Cell({ name, children }: { name: string; children: React.ReactNode }) {
    return (
        <div className={CELL}>
            <span className={CELL_NAME}>{name}</span>
            <span className="text-ink">{children}</span>
        </div>
    )
}

/** One cell that rolls through a list of names, one at a time. */
function RollingCell({ name, names, direction }: { name: string; names: readonly string[]; direction: 'up' | 'down' }) {
    return (
        <div className={`${CELL} justify-center`}>
            <RollBoard
                label={name}
                items={names.map(item => ({ key: item, node: item }))}
                spoken={names.join(', ')}
                direction={direction}
                className="!text-[11px] !tracking-[.18em] !text-ink-52"
            />
        </div>
    )
}

/**
 * The title block of a drawing sheet: the product's status, the
 * document and edition, who the product is tested on and backed by (each rolling through its
 * list), and the sheet number. Not shown on a phone.
 */
export function TitleBlock({ document, sheet, sheets }: { document: string; sheet: number; sheets: number }) {
    return (
        <div className="panel relative grid grid-cols-[1.35fr_.7fr_.8fr_1.2fr_1.2fr_.6fr] border border-hair font-mono text-[11px] leading-[1.5] tracking-[.18em] uppercase max-[900px]:hidden">
            <span className={`${CROP} top-[-7px] left-[-7px] border-t border-l`} />
            <span className={`${CROP} top-[-7px] right-[-7px] border-t border-r`} />
            <span className={`${CROP} bottom-[-7px] left-[-7px] border-b border-l`} />
            <span className={`${CROP} right-[-7px] bottom-[-7px] border-r border-b`} />
            <Cell name="Status">
                <span className="inline-flex items-center gap-2">
                    <i className="size-[6px] rounded-full bg-rec shadow-[0_0_8px_rgba(224,72,62,.6)]" />
                    Currently in alpha
                </span>
            </Cell>
            <Cell name="Document">{document}</Cell>
            <Cell name="Edition">MMXXVI</Cell>
            <RollingCell name="Tested on" names={TESTED_ON} direction="up" />
            <RollingCell name="Backed by" names={BACKED_BY} direction="down" />
            <Cell name="Sheet">
                {sheet} of {sheets}
            </Cell>
        </div>
    )
}
