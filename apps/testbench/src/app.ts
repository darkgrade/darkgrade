import { Demo, choices, type Setting, type Scenario } from './demo'
import { USBBench } from './live'
import { enhanceCameraConsole, setupConsoleExperience, consoleActionFeedback } from './web/camera-console-experience'
import { searchConsole } from './web/console-search'

let demo: Demo | USBBench = new URLSearchParams(location.search).get('mode') === 'demo' ? new Demo() : new USBBench()
const hardware = () => demo instanceof USBBench
const element = <T extends HTMLElement = HTMLElement>(id: string) => {
    const found = document.getElementById(id)
    if (!found) throw Error(`Missing demo element ${id}`)
    return found as T
}
const escape = (value: string) => value.replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))
const labels: Record<Setting, string> = { iso: 'ISO', aperture: 'Aperture', shutterSpeed: 'Shutter', whiteBalance: 'White balance' }
let activeCamera: string | undefined
const dialog = element<HTMLDialogElement>('canon-controls-dialog')

function feedback(message: string, failed = false) {
    const target = element('demo-feedback')
    target.textContent = message
    target.dataset.failed = String(failed)
}
async function action(work: () => void | Promise<void>) {
    try { await work() } catch (error) {
        render()
        feedback(error instanceof Error ? error.message : 'Demo action failed', true)
    }
}
function preview(name: string, index: number) {
    if (hardware()) {
        const camera = demo.cameras[index]
        return `<figure class="demo-preview" aria-label="Camera preview for ${escape(name)}">${camera?.previewUrl
            ? `<img class="usb-preview" alt="Live-view frame from ${escape(name)}" src="${escape(camera.previewUrl)}" />`
            : '<div class="usb-preview-empty">Read a live-view frame from your camera</div>'}<figcaption>Camera live view · frames are requested explicitly</figcaption></figure>`
    }
    return `<figure class="demo-preview demo-scene-${index % 3}" aria-label="Generated preview for ${escape(name)}">
        <div class="demo-scene"><div class="demo-scene-light"></div><div class="demo-scene-subject"></div><div class="demo-focus-box"></div></div>
        <figcaption>Generated scene · simulated preview</figcaption></figure>`
}
function render() {
    const busy = demo.checking || demo.recording
    element('environment-label').textContent = hardware() ? (demo as USBBench).source === 'fixture' ? 'USB host test fixture' : 'Your USB cameras' : 'Simulated cameras'
    element('environment-detail').textContent = hardware()
        ? 'Local USB Test Bench · actions control your connected cameras. No smart plugs or separate access point needed.'
        : 'Test Bench demo · all previews, controls and recordings are simulated.'
    element('reset-demo').textContent = hardware() ? 'Disconnect cameras' : 'Reset demo'
    element<HTMLButtonElement>('reset-demo').disabled = hardware() && busy
    element('scan-cameras').hidden = !hardware()
    element<HTMLButtonElement>('scan-cameras').disabled = busy
    element('tab-setup').textContent = hardware() ? 'Setup' : 'Demo setup'
    element<HTMLSelectElement>('bench-mode').value = hardware() ? 'usb' : 'demo'
    element<HTMLSelectElement>('bench-mode').disabled = busy
    element('scenario-field').hidden = hardware()
    element('setup-detail').textContent = hardware()
        ? 'Plug in your camera, choose its USB remote/PTP mode, then scan and connect. Exposure choices come from the camera. Close other apps that own it. Simulation is available below for exploring the UI.'
        : 'Simulated cameras use generated scenes and temporary browser memory. Switching to USB requires the local Test Bench host.'
    element('shoot-cameras').innerHTML = demo.cameras.map((camera, index) => `<article class="panel demo-shoot-camera">
        <div class="demo-card-header"><label><input type="checkbox" data-select="${camera.label}" ${camera.selected ? 'checked' : ''} ${busy ? 'disabled' : ''} />
        <strong>${escape(camera.displayName)}</strong></label><span class="status-chip ${camera.health.status === 'ready' && camera.battery >= 10 ? 'ready' : 'unknown'}"><i></i>${hardware() ? camera.error ? 'Needs attention' : camera.connected ? 'Connected' : 'Available' : camera.battery < 10 ? 'Low battery' : camera.health.status === 'missing' ? 'Offline' : camera.health.status === 'busy' ? 'Busy' : 'Ready'}</span></div>
        ${preview(camera.displayName, index)}
        <div class="demo-camera-footer"><span class="subtle">${camera.settings.iso ? `${escape(camera.settings.iso)} · ${escape(camera.settings.aperture)} · ${escape(camera.settings.shutterSpeed)}` : 'Connect to read camera settings'}</span>
        <button class="button secondary" data-controls="${camera.label}" type="button">Controls</button></div>${camera.error ? `<p class="usb-error">${escape(camera.error)}</p>` : ''}</article>`).join('') ||
        '<div class="panel usb-empty"><h2>Build your bench.</h2><p>Plug a camera into USB, set its USB mode to remote/PTP, then scan. Camera sessions open only when you choose Connect cameras.</p></div>'
    element('camera-groups').innerHTML = demo.cameras.map(camera => `<article class="camera-card"><div class="card-top"><div><span class="eyebrow">${hardware() ? 'USB camera' : 'Simulated camera'}</span><h3>${escape(camera.displayName)}</h3></div><span class="status-chip ${camera.health.status === 'ready' ? 'ready' : 'unknown'}"><i></i>${escape(camera.health.status)}</span></div><div class="camera-facts">${hardware() ? `<div class="fact"><span>Session</span><strong>${camera.connected ? 'Connected' : 'Not connected'}</strong></div>` : `<div class="fact"><span>Battery</span><strong>${camera.battery}%</strong></div><div class="fact"><span>Firmware</span><strong>Demo</strong></div>`}<div class="fact"><span>Control</span><strong>${hardware() ? 'USB' : 'Simulated'}</strong></div></div><div class="camera-actions"><button class="button secondary" type="button" data-controls="${camera.label}">Controls</button></div></article>`).join('')
    const selected = demo.cameras.filter(camera => camera.selected)
    element('mode-title').textContent = selected.every(camera => camera.health.status === 'ready' && camera.battery >= 10) && selected.length ? 'Ready to explore.' : 'Needs your attention.'
    element('mode-reason').textContent = `${selected.length} selected ${hardware() ? 'USB' : 'simulated'} cameras.`
    element('shoot-status').textContent = demo.recording ? hardware() ? 'Recording or stop confirmation pending' : 'Recording a simulated take' : demo.checking ? 'Working with selected cameras…' : demo.checked ? 'Selected cameras checked' : 'Ready to connect your cameras'
    element('shoot-detail').textContent = hardware() ? 'Recording writes to the camera card. Stop before disconnecting; inspect the card to confirm the saved take.' : 'Camera checks and take results here are simulated.'
    element('shoot-intro').textContent = hardware() ? 'Connect your USB cameras, read their controls, then capture a frame, photo or take.' : 'Choose your cameras, check the shot, then roll a simulated take.'
    element<HTMLButtonElement>('check-cameras').disabled = busy || !selected.length
    element('check-cameras').textContent = hardware() ? 'Connect cameras' : 'Check cameras'
    element<HTMLButtonElement>('record-take').disabled = demo.checking ||
        (!demo.recording && (!demo.checked || hardware() && selected.some(camera => camera.canRecord === false)))
    element('record-take').textContent = demo.recording ? hardware() ? 'Stop cameras' : 'Stop simulated take' : hardware() ? 'Record cameras' : 'Record simulated take'
    element<HTMLSelectElement>('scenario').value = demo.scenario
    element<HTMLSelectElement>('scenario').disabled = busy
    element('takes-title').textContent = hardware() ? 'Session takes' : 'Simulated takes'
    element('takes').innerHTML = demo.takes.length ? demo.takes.map(take => `<article class="demo-take"><strong>${take.simulated ? 'Simulated take' : 'Stopped take'} ${take.id}</strong><span>${take.seconds === undefined ? 'Duration unavailable after page refresh' : `${take.seconds.toFixed(1)} host elapsed seconds`} · ${take.cameras.map(escape).join(', ')}</span><small>${take.simulated ? 'Simulated result · no camera media was recorded' : 'Stop acknowledged · confirm the saved media on the camera card'}</small></article>`).join('') : '<p class="subtle">Stopped takes will appear here.</p>'
    if (dialog.open && activeCamera) renderControls()
}
function renderControls() {
    const camera = demo.camera(activeCamera!)
    const disabled = demo.checking || demo.recording || camera.health.status !== 'ready'
    element('controls-source-label').textContent = hardware() ? 'Your USB camera' : 'Simulated camera'
    element('controls-title').textContent = camera.displayName
    element('canon-controls-body').innerHTML = `<div class="camera-control-workspace">
        <section class="camera-console-camera">${preview(camera.displayName, demo.cameras.indexOf(camera))}</section>
        <aside class="camera-console-sidebar"><label class="field"><span>Find a setting</span><input type="search" data-console-search aria-label="Find a camera setting" /></label><p id="demo-search-results" class="subtle" role="status"></p><div class="camera-console-quick-controls"><div class="camera-quick-exposure">
        ${Object.entries(choices).map(([setting, simulatedValues]) => {
            const control = camera.controls?.[setting as Setting]
            const values = hardware() ? control?.choices.length ? control.choices : [control?.value || 'Unavailable'] : simulatedValues
            return `<div class="canon-control-card"><label class="field"><span>${labels[setting as Setting]}</span><select data-setting="${setting}" ${disabled || hardware() && !control?.enabled ? 'disabled' : ''}>${values.map(value => `<option value="${escape(value)}" ${camera.settings[setting as Setting] === value ? 'selected' : ''}>${escape(value)}</option>`).join('')}</select></label></div>`
        }).join('')}
        </div></div><label class="field demo-name"><span>Camera name</span><input data-camera-name maxlength="80" value="${escape(camera.displayName)}" ${disabled ? 'disabled' : ''} /></label>
        ${hardware() ? `<div class="button-row usb-actions"><button class="button secondary" data-media="frame" ${disabled ? 'disabled' : ''}>Read live-view frame</button><button class="button secondary" data-media="photo" ${disabled ? 'disabled' : ''}>Capture and download photo</button><button class="button ghost" data-refresh ${demo.checking ? 'disabled' : ''}>Refresh controls</button><button class="button ghost" data-recover ${demo.checking || demo.recording || !camera.connected ? 'disabled' : ''}>Recover session</button></div>` : ''}
        <p class="subtle">${hardware() ? 'These controls operate your camera. Available values depend on its current mode.' : 'All changes apply to simulated session data.'}</p></aside></div>`
    enhanceCameraConsole(element('canon-controls-body'), camera, demo.cameras)
    const connection = element('canon-controls-body').querySelector<HTMLElement>('.console-connection')
    if (connection) connection.textContent = hardware() ? 'Local USB control' : 'Simulated control'
}
function openControls(label: string) {
    activeCamera = label
    renderControls()
    if (!dialog.open) dialog.showModal()
}
document.addEventListener('click', event => {
    const media = (event.target as Element).closest<HTMLElement>('[data-media],[data-refresh],[data-recover]')
    if (media && demo instanceof USBBench && activeCamera) {
        const host = demo, id = activeCamera
        void action(() => media.dataset.media ? host.media(id, media.dataset.media as 'frame' | 'photo')
            : media.hasAttribute('data-refresh') ? host.refresh(id) : host.recover(id))
    }
    const target = (event.target as Element).closest<HTMLElement>('[data-controls],[data-tab]')
    if (target?.dataset.controls) openControls(target.dataset.controls)
    if (target?.dataset.tab) {
        for (const tab of document.querySelectorAll<HTMLElement>('[data-tab]')) {
            const active = tab === target
            tab.classList.toggle('active', active)
            tab.setAttribute('aria-selected', String(active))
            tab.tabIndex = active ? 0 : -1
        }
        for (const panel of document.querySelectorAll<HTMLElement>('[data-panel]')) {
            const active = panel.dataset.panel === target.dataset.tab
            panel.hidden = !active
            panel.classList.toggle('active', active)
        }
    }
})
document.querySelector('.nav')?.addEventListener('keydown', event => {
    const keyboard = event as KeyboardEvent
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-tab]')]
    const current = tabs.indexOf(event.target as HTMLButtonElement)
    if (current < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(keyboard.key)) return
    keyboard.preventDefault()
    const next = keyboard.key === 'Home' ? 0 : keyboard.key === 'End' ? tabs.length - 1 :
        (current + (keyboard.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    tabs[next].focus()
    tabs[next].click()
})
document.addEventListener('change', event => {
    const target = event.target as HTMLInputElement | HTMLSelectElement
    if (target.dataset.select) void action(() => demo.select(target.dataset.select!, (target as HTMLInputElement).checked))
    if (target.dataset.setting && activeCamera) void action(async () => {
        await demo.setting(activeCamera!, target.dataset.setting as Setting, target.value)
        consoleActionFeedback(hardware() ? 'Camera setting applied and read back' : 'Simulated setting applied', 'success')
    })
    if (target.hasAttribute('data-camera-name') && activeCamera) void action(() => demo.rename(activeCamera!, target.value))
})
element('canon-controls-body').addEventListener('input', event => {
    const input = event.target as HTMLInputElement
    if (!input.hasAttribute('data-console-search')) return
    const hits = searchConsole(Object.entries(labels).map(([id, title]) => ({
        id, title, group: 'Camera settings', description: title,
    })), input.value)
    element('demo-search-results').textContent = input.value ? hits.length ? hits.map(hit => hit.title).join(' · ') : 'No matching setting' : ''
    for (const card of element('canon-controls-body').querySelectorAll<HTMLElement>('.canon-control-card')) {
        const setting = card.querySelector<HTMLElement>('[data-setting]')?.dataset.setting
        card.hidden = Boolean(input.value) && !hits.some(hit => hit.id === setting)
    }
})
element('check-cameras').addEventListener('click', () => void action(async () => {
    await demo.check()
    if (demo.checked) feedback(hardware() ? 'Selected USB cameras connected' : 'Selected simulated cameras checked')
}))
element('record-take').addEventListener('click', () => void action(() => demo.recording ? demo.stop() : demo.start()))
element('reset-demo').addEventListener('click', () => void action(async () => {
    dialog.close()
    activeCamera = undefined
    await demo.reset()
    feedback(hardware() ? 'Camera sessions disconnected' : 'Demo reset')
}))
element('scan-cameras').addEventListener('click', () => void action(() => (demo as USBBench).scan()))
element('bench-mode').addEventListener('change', event => void action(async () => {
    await demo.reset()
    unsubscribe()
    demo = (event.target as HTMLSelectElement).value === 'demo' ? new Demo() : new USBBench()
    unsubscribe = demo.subscribe(render)
    render()
    if (hardware()) await (demo as USBBench).restoreHostState()
}))
element('scenario').addEventListener('change', event => void action(() => demo.setScenario((event.target as HTMLSelectElement).value as Scenario)))
element('close-controls').addEventListener('click', () => dialog.close())
setupConsoleExperience(async label => { openControls(label) })
let unsubscribe = demo.subscribe(render)
render()
if (hardware()) void action(() => (demo as USBBench).restoreHostState())
