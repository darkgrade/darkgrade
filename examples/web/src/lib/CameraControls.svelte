<script lang="ts">
    import type { Camera } from '@camera/index'
    import { store } from './store.svelte'
    import { cameraQueue } from './queue'

    interface Props {
        camera: Camera
    }

    const { camera }: Props = $props()

    // Predefined camera setting values
    const apertureValues = [
        'f/1.4',
        'f/1.6',
        'f/1.8',
        'f/2',
        'f/2.2',
        'f/2.5',
        'f/2.8',
        'f/3.2',
        'f/3.5',
        'f/4',
        'f/4.5',
        'f/5',
        'f/5.6',
        'f/6.3',
        'f/7.1',
        'f/8',
        'f/9',
        'f/10',
        'f/11',
        'f/13',
        'f/14',
        'f/16',
        'f/18',
        'f/20',
        'f/22',
    ]

    const shutterSpeedValues = [
        '1/4000',
        '1/3200',
        '1/2500',
        '1/2000',
        '1/1600',
        '1/1250',
        '1/1000',
        '1/800',
        '1/640',
        '1/500',
        '1/400',
        '1/320',
        '1/250',
        '1/200',
        '1/160',
        '1/125',
        '1/100',
        '1/80',
        '1/60',
        '1/50',
        '1/40',
        '1/30',
        '1/25',
        '1/20',
        '1/15',
        '1/13',
        '1/10',
        '1/8',
        '1/6',
        '1/5',
        '1/4',
        '1/3',
        '0.4"',
        '0.5"',
        '0.6"',
        '0.8"',
        '1"',
        '1.3"',
        '1.6"',
        '2"',
        '2.5"',
        '3.2"',
        '4"',
        '5"',
        '6"',
        '8"',
        '10"',
        '13"',
        '15"',
        '20"',
        '25"',
        '30"',
        'BULB',
    ]

    const isoValues = [
        'ISO AUTO',
        'ISO 100',
        'ISO 125',
        'ISO 160',
        'ISO 200',
        'ISO 250',
        'ISO 320',
        'ISO 400',
        'ISO 500',
        'ISO 640',
        'ISO 800',
        'ISO 1000',
        'ISO 1250',
        'ISO 1600',
        'ISO 2000',
        'ISO 2500',
        'ISO 3200',
        'ISO 4000',
        'ISO 5000',
        'ISO 6400',
        'ISO 8000',
        'ISO 10000',
        'ISO 12800',
        'ISO 16000',
        'ISO 20000',
        'ISO 25600',
        'ISO 32000',
    ]

    const onApertureChange = async (event: Event) => {
        const target = event.target as HTMLSelectElement
        await cameraQueue.push(async () => await camera.setAperture(target.value))
    }

    const onShutterSpeedChange = async (event: Event) => {
        const target = event.target as HTMLSelectElement
        await cameraQueue.push(async () => await camera.setShutterSpeed(target.value))
    }

    const onISOChange = async (event: Event) => {
        const target = event.target as HTMLSelectElement
        await cameraQueue.push(async () => await camera.setIso(target.value))
    }
</script>

<div class="flex flex-row gap-4">
    <!-- Aperture Control -->
    <select
        disabled={!store.connected}
        value={store.settings?.aperture || ''}
        onchange={onApertureChange}
        class="text-xs font-mono cursor-pointer transition-colors duration-300 border-none outline-none"
        style="color: {store.changedProps.has('aperture') ? '#4ade80' : '#ffffff4c'};"
    >
        <option value="" disabled>--</option>
        {#each apertureValues as aperture}
            <option value={aperture} class="bg-black text-white">{aperture}</option>
        {/each}
    </select>

    <!-- Shutter Speed Control -->
    <select
        disabled={!store.connected}
        value={store.settings?.shutterSpeed || ''}
        onchange={onShutterSpeedChange}
        class="text-xs font-mono cursor-pointer transition-colors duration-300 border-none outline-none"
        style="color: {store.changedProps.has('shutterSpeed') ? '#4ade80' : '#ffffff4c'};"
    >
        <option value="" disabled>--</option>
        {#each shutterSpeedValues as speed}
            <option value={speed} class="bg-black text-white">{speed}</option>
        {/each}
    </select>

    <!-- ISO Control -->
    <select
        disabled={!store.connected}
        value={store.settings?.iso || ''}
        onchange={onISOChange}
        class="text-xs font-mono cursor-pointer transition-colors duration-300 border-none outline-none"
        style="color: {store.changedProps.has('iso') ? '#4ade80' : '#ffffff4c'};"
    >
        <option value="" disabled>--</option>
        {#each isoValues as iso}
            <option value={iso} class="bg-black text-white">{iso}</option>
        {/each}
    </select>
</div>
