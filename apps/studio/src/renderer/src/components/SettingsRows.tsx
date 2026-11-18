import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@kevinschaich/components'
import { Check, Copy } from 'lucide-react'
import { useState } from 'react'

/** A titled group of settings: the title above, its rows in one card with no rules between rows, as Raycast and System Settings group them. */
export function SettingsGroup(props: {
    title: string
    footer?: React.ReactNode
    children: React.ReactNode
}): React.JSX.Element {
    return (
        <section className="flex flex-col gap-2">
            <h2 className="px-1 text-[14px] font-semibold text-foreground">{props.title}</h2>
            <div className="flex flex-col rounded-xl bg-(--card-surface) py-1">{props.children}</div>
            {props.footer && <div className="px-1 text-xs text-muted-foreground">{props.footer}</div>}
        </section>
    )
}

/** One setting: its title and a line on what it does on the left, its control on the right, anything more beneath. */
export function SettingRow(props: {
    title: React.ReactNode
    description?: React.ReactNode
    control?: React.ReactNode
    htmlFor?: string
    children?: React.ReactNode
}): React.JSX.Element {
    return (
        <div className="flex flex-col gap-2 px-4 py-3">
            <div className="flex items-center justify-between gap-6">
                <div className="flex min-w-0 flex-col gap-0.5">
                    <label htmlFor={props.htmlFor} className="text-[13px] text-foreground">
                        {props.title}
                    </label>
                    {props.description && <p className="text-xs text-muted-foreground">{props.description}</p>}
                </div>
                {props.control && <div className="flex shrink-0 items-center gap-1.5">{props.control}</div>}
            </div>
            {props.children}
        </div>
    )
}

/** A row's own action: a filled button that reads as one on the card's dark surface. */
export const SETTING_BUTTON_CLASS = 'bg-foreground/8 hover:bg-foreground/12'

/** A value with a copy button that confirms with a check for a moment. */
export function CopyableValue({ label, value }: { label: string; value: string }): React.JSX.Element {
    const [copied, setCopied] = useState(false)
    return (
        <div className="flex min-w-0 items-center gap-2 rounded-md bg-foreground/5 py-1 pr-1 pl-3">
            <code className="selectable min-w-0 flex-1 truncate font-mono text-xs text-foreground/85">{value}</code>
            <Tooltip>
                <TooltipTrigger
                    render={
                        <Button
                            size="icon-xs"
                            variant="ghost"
                            aria-label={`Copy ${label}`}
                            onClick={() => {
                                void navigator.clipboard.writeText(value).then(() => {
                                    setCopied(true)
                                    setTimeout(() => setCopied(false), 1400)
                                })
                            }}
                        />
                    }
                >
                    {copied ? <Check className="text-live" /> : <Copy />}
                </TooltipTrigger>
                <TooltipContent>{copied ? 'Copied' : `Copy ${label}`}</TooltipContent>
            </Tooltip>
        </div>
    )
}
