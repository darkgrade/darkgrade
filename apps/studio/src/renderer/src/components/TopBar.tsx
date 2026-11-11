import {
    Button,
    Popover,
    PopoverContent,
    PopoverDescription,
    PopoverHeader,
    PopoverTitle,
    PopoverTrigger,
    Spinner,
    Switch,
} from '@kevinschaich/components'
import brandMark from '@renderer/assets/darkgrade_icon_dark.svg'
import { formatFocalLength } from '@renderer/components/LensPanel'
import type { CameraBattery, CameraState } from '@shared/ipc'
import { BatteryFull, BatteryLow, BatteryMedium, BatteryWarning, CardSim, Mic, PlugZap } from 'lucide-react'

interface TopBarProps {
    cameraState: CameraState
    busy: boolean
    voiceListening: boolean
    onConnect: () => void
    onDisconnect: () => void
    onOsdOverlayChange: (enabled: boolean) => void
}

/** "3 h 20 min", "45 min", "under a minute". */
function formatDuration(totalMinutes: number): string {
    if (totalMinutes < 1) return 'under a minute'
    const hours = Math.floor(totalMinutes / 60)
    const minutes = Math.round(totalMinutes % 60)
    if (hours === 0) return `${minutes} min`
    return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`
}

/** Decimal gigabytes, as macOS and the camera both count them. */
function formatGigabytes(bytes: number): string {
    const gigabytes = bytes / 1e9
    return `${gigabytes >= 100 ? Math.round(gigabytes) : gigabytes.toFixed(1)} GB`
}

function batteryLabel(battery: CameraBattery): string {
    if (battery.percent !== null) return `${battery.percent}%`
    return battery.level ? battery.level[0].toUpperCase() + battery.level.slice(1) : 'Unknown'
}

function BatteryIcon({ battery }: { battery: CameraBattery }): React.JSX.Element {
    const percent = battery.percent
    if (battery.powerSource === 'dc' || battery.powerSource === 'usb') return <PlugZap aria-hidden />
    if (percent === null) return <BatteryMedium aria-hidden />
    if (percent <= 10) return <BatteryWarning aria-hidden className="text-destructive" />
    if (percent <= 35) return <BatteryLow aria-hidden />
    if (percent <= 70) return <BatteryMedium aria-hidden />
    return <BatteryFull aria-hidden />
}

function cameraName(cameraState: CameraState): string {
    const vendor = cameraState.vendor ?? ''
    const model = cameraState.model
    if (!model) return vendor || 'Camera'
    return model.startsWith(vendor) ? model : `${vendor} ${model}`.trim()
}

function StatusDot({ cameraState }: { cameraState: CameraState }): React.JSX.Element {
    if (cameraState.phase === 'connecting' || cameraState.phase === 'recovering') return <Spinner className="size-3" />
    const color = cameraState.recording
        ? 'bg-rec animate-pulse'
        : cameraState.connected
          ? 'bg-live'
          : 'bg-muted-foreground/40'
    return <span className={`size-2 rounded-full ${color}`} aria-hidden />
}

function statusText(cameraState: CameraState): string {
    if (cameraState.phase === 'connecting') return 'Connecting…'
    if (cameraState.phase === 'recovering') return 'Reconnecting…'
    if (!cameraState.connected) return 'No camera'
    return cameraName(cameraState)
}

/**
 * Space left on the card, as the camera states it: gigabytes when it reports bytes, otherwise its
 * own count of shots left (Sony reports no byte count over USB).
 */
function cardSpaceLabel(cameraState: CameraState): string | null {
    const card = cameraState.card
    if (!card) return null
    if (card.freeBytes !== null) return formatGigabytes(card.freeBytes)
    // In movie mode the camera counts recording time left and reports 0 photos.
    if (inMovieMode(cameraState) && card.remainingVideoSeconds !== null)
        return formatDuration(Math.floor(card.remainingVideoSeconds / 60))
    if (card.remainingPhotos !== null) return `${card.remainingPhotos.toLocaleString()} shots`
    return null
}

function inMovieMode(cameraState: CameraState): boolean {
    return /^Movie /i.test(cameraState.controls?.exposureProgram?.value ?? '')
}

type DetailRow = [label: string, value: string]

/** The camera clock always follows this computer; say when it was last set, or why it wasn't. */
function clockRow(cameraState: CameraState): DetailRow | null {
    const clock = cameraState.clock
    if (!clock) return null
    if (clock.error) return ['Clock', `Not set: ${clock.error}`]
    if (clock.syncedAtMs === null) return ['Clock', 'Setting…']
    const time = new Date(clock.syncedAtMs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    return ['Clock', `Set from this Mac at ${time}`]
}

function DetailGroup({ rows }: { rows: DetailRow[] }): React.JSX.Element | null {
    if (rows.length === 0) return null
    return (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
            {rows.map(([term, value]) => (
                <div key={term} className="contents">
                    <dt className="text-muted-foreground">{term}</dt>
                    <dd className="truncate text-right tabular-nums" title={value}>
                        {value}
                    </dd>
                </div>
            ))}
        </dl>
    )
}

function CameraDetails({ cameraState }: { cameraState: CameraState }): React.JSX.Element | null {
    if (!cameraState.connected) return null
    const { battery, card } = cameraState
    const present = (rows: Array<DetailRow | null>): DetailRow[] => rows.filter((row): row is DetailRow => row !== null)
    return (
        <div className="flex flex-col gap-4">
            <DetailGroup rows={[['Connection', 'USB']]} />
            <DetailGroup
                rows={present([
                    ['Battery', battery ? batteryLabel(battery) : 'Unknown'],
                    battery?.remainingMinutes != null ? ['Time left', formatDuration(battery.remainingMinutes)] : null,
                ])}
            />
            <DetailGroup
                rows={present([
                    card?.freeBytes != null ? ['Card space', `${formatGigabytes(card.freeBytes)} free`] : null,
                    card?.remainingPhotos != null && !inMovieMode(cameraState)
                        ? ['Photos left', card.remainingPhotos.toLocaleString()]
                        : null,
                    card?.remainingVideoSeconds != null
                        ? ['Video left', formatDuration(Math.floor(card.remainingVideoSeconds / 60))]
                        : null,
                ])}
            />
            <DetailGroup rows={present([clockRow(cameraState)])} />
            <DetailGroup
                rows={[
                    ['Live view', cameraState.liveView ? 'On' : 'Paused'],
                    ['Recording', cameraState.recording ? 'Yes' : 'No'],
                ]}
            />
        </div>
    )
}

export function TopBar({
    cameraState,
    busy,
    voiceListening,
    onConnect,
    onDisconnect,
    onOsdOverlayChange,
}: TopBarProps): React.JSX.Element {
    const isMac = cameraState.platform === 'darwin'
    const connecting = cameraState.phase === 'connecting' || cameraState.phase === 'recovering'
    return (
        <header
            className={`titlebar-drag grid h-13 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 bg-black/55 pr-3 ${isMac ? 'pl-[110px]' : 'pl-4'}`}
        >
            <div className="flex min-w-0 items-center gap-2">
                <img className="h-3.5 w-auto" src={brandMark} alt="Darkgrade" draggable={false} />
                <span className="text-[15px] font-semibold tracking-tight">Studio</span>
            </div>

            <Popover>
                <PopoverTrigger
                    render={
                        <Button
                            variant="secondary"
                            size="sm"
                            className="gap-3.5 rounded-full bg-foreground/8 px-3.5 font-normal hover:bg-foreground/12"
                        />
                    }
                >
                    <span className="flex items-center gap-2">
                        <StatusDot cameraState={cameraState} />
                        <span className="font-medium">{statusText(cameraState)}</span>
                    </span>
                    {cameraState.connected && cameraState.lens?.name && (
                        <span className="text-muted-foreground">
                            {cameraState.lens.name}
                            {cameraState.lens.focalLengthMillimetres != null &&
                                ` · ${formatFocalLength(cameraState.lens.focalLengthMillimetres)}`}
                        </span>
                    )}
                    {cameraState.connected && cameraState.battery && (
                        <span className="flex items-center gap-1 text-muted-foreground tabular-nums [&_svg]:size-4">
                            <BatteryIcon battery={cameraState.battery} />
                            {batteryLabel(cameraState.battery)}
                        </span>
                    )}
                    {cameraState.connected && cardSpaceLabel(cameraState) && (
                        <span className="flex items-center gap-1 text-muted-foreground tabular-nums [&_svg]:size-4">
                            <CardSim aria-hidden />
                            {cardSpaceLabel(cameraState)}
                        </span>
                    )}
                    {cameraState.recording && <span className="font-semibold text-rec">REC</span>}
                    {voiceListening && <Mic aria-label="Listening" className="text-muted-foreground" />}
                </PopoverTrigger>
                <PopoverContent className="w-80 gap-4 p-4">
                    <PopoverHeader>
                        <PopoverTitle>
                            {cameraState.connected ? cameraName(cameraState) : 'No camera connected'}
                        </PopoverTitle>
                        {!cameraState.connected && (
                            <PopoverDescription>
                                Connect the camera over USB and set it to PC Remote. Studio connects on its own.
                            </PopoverDescription>
                        )}
                    </PopoverHeader>
                    <CameraDetails cameraState={cameraState} />
                    {cameraState.osdOverlay !== null && (
                        <label className="flex items-center justify-between gap-4 text-sm">
                            <span className="text-muted-foreground">Show camera display</span>
                            <Switch checked={cameraState.osdOverlay} onCheckedChange={onOsdOverlayChange} />
                        </label>
                    )}
                </PopoverContent>
            </Popover>

            <div className="flex items-center justify-end">
                {cameraState.connected ? (
                    <Button variant="ghost" size="sm" disabled={busy} onClick={onDisconnect}>
                        Disconnect
                    </Button>
                ) : (
                    <Button variant="secondary" size="sm" disabled={busy || connecting} onClick={onConnect}>
                        Connect
                    </Button>
                )}
            </div>
        </header>
    )
}
