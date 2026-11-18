import { Demo, choices, type Setting, type Scenario } from './demo'
import { enhanceCameraConsole, setupConsoleExperience, consoleActionFeedback } from './web/camera-console-experience'
import { searchConsole } from './web/console-search'

const demo = new Demo()
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
    return `<figure class="demo-preview demo-scene-${index % 3}" aria-label="Generated preview for ${escape(name)}">
        <div class="demo-scene"><div class="demo-scene-light"></div><div class="demo-scene-subject"></div><div class="demo-focus-box"></div></div>
        <figcaption>Generated scene · simulated preview</figcaption></figure>`
}
function render() {
    const busy = demo.checking || demo.recording
    element('shoot-cameras').innerHTML = demo.cameras.map((camera, index) => `<article class="panel demo-shoot-camera">
        <div class="demo-card-header"><label><input type="checkbox" data-select="${camera.label}" ${camera.selected ? 'checked' : ''} ${busy ? 'disabled' : ''} />
        <strong>${escape(camera.displayName)}</strong></label><span class="status-chip ${camera.health.status === 'ready' && camera.battery >= 10 ? 'ready' : 'unknown'}"><i></i>${camera.battery < 10 ? 'Low battery' : camera.health.status === 'missing' ? 'Offline' : camera.health.status === 'busy' ? 'Busy' : 'Ready'}</span></div>
        ${preview(camera.displayName, index)}
        <div class="demo-camera-footer"><span class="subtle">${camera.settings.iso === 'auto' ? 'Auto ISO' : `ISO ${escape(camera.settings.iso)}`} · ${escape(camera.settings.aperture)} · ${escape(camera.settings.shutterSpeed)}</span>
        <button class="button secondary" data-controls="${camera.label}" type="button">Controls</button></div></article>`).join('')
    element('camera-groups').innerHTML = demo.cameras.map(camera => `<article class="camera-card"><div class="card-top"><div><span class="eyebrow">Simulated camera</span><h3>${escape(camera.displayName)}</h3></div><span class="status-chip ${camera.health.status === 'ready' ? 'ready' : 'unknown'}"><i></i>${escape(camera.health.status)}</span></div><div class="camera-facts"><div class="fact"><span>Battery</span><strong>${camera.battery}%</strong></div><div class="fact"><span>Firmware</span><strong>Demo</strong></div><div class="fact"><span>Control</span><strong>Simulated</strong></div></div><div class="camera-actions"><button class="button secondary" type="button" data-controls="${camera.label}">Controls</button></div></article>`).join('')
    const selected = demo.cameras.filter(camera => camera.selected)
    element('mode-title').textContent = selected.every(camera => camera.health.status === 'ready' && camera.battery >= 10) && selected.length ? 'Ready to explore.' : 'Needs your attention.'
    element('mode-reason').textContent = `${selected.length} selected simulated cameras. Use Demo setup to explore unavailable and busy cameras.`
    element('shoot-status').textContent = demo.recording ? 'Recording a simulated take' : demo.checking ? 'Checking simulated cameras…' : demo.checked ? 'Selected cameras checked' : 'Ready to check your cameras'
    element('shoot-detail').textContent = demo.recording ? 'Stop to keep the simulated take in this session.' : 'Camera checks and take results here are simulated.'
    element<HTMLButtonElement>('check-cameras').disabled = busy || !selected.length
    element<HTMLButtonElement>('record-take').disabled = demo.checking || (!demo.recording && !demo.checked)
    element('record-take').textContent = demo.recording ? 'Stop simulated take' : 'Record simulated take'
    element<HTMLSelectElement>('scenario').value = demo.scenario
    element<HTMLSelectElement>('scenario').disabled = busy
    element('takes').innerHTML = demo.takes.length ? demo.takes.map(take => `<article class="demo-take"><strong>Simulated take ${take.id}</strong><span>${take.seconds.toFixed(1)} seconds · ${take.cameras.map(escape).join(', ')}</span><small>Simulated result · no camera media was recorded</small></article>`).join('') : '<p class="subtle">Your simulated takes will appear here.</p>'
    if (dialog.open && activeCamera) renderControls()
}
function renderControls() {
    const camera = demo.camera(activeCamera!)
    const disabled = demo.checking || demo.recording || camera.health.status !== 'ready'
    element('controls-title').textContent = camera.displayName
    element('canon-controls-body').innerHTML = `<div class="camera-control-workspace">
        <section class="camera-console-camera">${preview(camera.displayName, demo.cameras.indexOf(camera))}</section>
        <aside class="camera-console-sidebar"><label class="field"><span>Find a setting</span><input type="search" data-console-search aria-label="Find a camera setting" /></label><p id="demo-search-results" class="subtle" role="status"></p><div class="camera-console-quick-controls"><div class="camera-quick-exposure">
        ${Object.entries(choices).map(([setting, values]) => `<div class="canon-control-card"><label class="field"><span>${labels[setting as Setting]}</span><select data-setting="${setting}" ${disabled ? 'disabled' : ''}>${values.map(value => `<option value="${value}" ${camera.settings[setting as Setting] === value ? 'selected' : ''}>${value === 'auto' ? 'Auto' : value}</option>`).join('')}</select></label></div>`).join('')}
        </div></div><label class="field demo-name"><span>Camera name</span><input data-camera-name maxlength="80" value="${escape(camera.displayName)}" ${disabled ? 'disabled' : ''} /></label>
        <p class="subtle">All changes apply to simulated session data.</p></aside></div>`
    enhanceCameraConsole(element('canon-controls-body'), camera, demo.cameras)
    const connection = element('canon-controls-body').querySelector<HTMLElement>('.console-connection')
    if (connection) connection.textContent = 'Simulated control'
}
function openControls(label: string) {
    activeCamera = label
    renderControls()
    if (!dialog.open) dialog.showModal()
}
document.addEventListener('click', event => {
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
    if (target.dataset.setting && activeCamera) void action(() => {
        demo.setting(activeCamera!, target.dataset.setting as Setting, target.value)
        consoleActionFeedback('Simulated setting applied', 'success')
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
    if (demo.checked) feedback('Selected simulated cameras checked')
}))
element('record-take').addEventListener('click', () => void action(() => demo.recording ? demo.stop() : demo.start()))
element('reset-demo').addEventListener('click', () => {
    dialog.close()
    activeCamera = undefined
    demo.reset()
    feedback('Demo reset')
})
element('scenario').addEventListener('change', event => void action(() => demo.setScenario((event.target as HTMLSelectElement).value as Scenario)))
element('close-controls').addEventListener('click', () => dialog.close())
setupConsoleExperience(async label => { openControls(label) })
demo.subscribe(render)
render()
