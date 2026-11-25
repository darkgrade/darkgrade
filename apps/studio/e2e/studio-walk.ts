import type { CameraControls, CameraState, FileEntry } from '@shared/ipc'
import type { StudioProbe } from './studio-probe'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface WalkOptions {
    probe: StudioProbe
    /** Absent for the fake: every step after the connection needs Studio's window. */
    page: Page | undefined
    screenshotDirectory: string
    connectTimeoutMilliseconds: number
    /** Also flip the vision overlays (Depth Pro, SAM 3), which can download their models first. */
    includeVisionOverlays: boolean
}

const pollMilliseconds = 250

async function waitFor<T>(description: string, timeoutMilliseconds: number, read: () => Promise<T | undefined>): Promise<T> {
    const deadline = Date.now() + timeoutMilliseconds
    for (;;) {
        const value = await read()
        if (value !== undefined) return value
        if (Date.now() > deadline) throw new Error(`Timed out after ${timeoutMilliseconds / 1000} s waiting for ${description}`)
        await new Promise(resolve => setTimeout(resolve, pollMilliseconds))
    }
}

function changedControls(before: CameraControls | null, after: CameraControls | null): string[] {
    if (!before || !after) return []
    return Object.entries(after)
        .filter(([name, control]) => control?.value !== before[name as keyof CameraControls]?.value)
        .map(([name, control]) => `${name}=${control?.value}`)
}

/**
 * Studio's feature list in order. Each step acts through the UI, checks what the UI shows and what the
 * camera reports back through Studio's main process, and saves a screenshot. Settings it changes are
 * restored; files it downloads to this Mac are removed again; nothing on the card is deleted.
 */
export async function walkStudio(options: WalkOptions): Promise<void> {
    const { probe } = options
    mkdirSync(options.screenshotDirectory, { recursive: true })
    let shotNumber = 0
    const requirePage = (): Page => {
        if (!options.page) throw new Error(`${probe.description} has no window to drive`)
        return options.page
    }
    const screenshot = async (name: string): Promise<void> => {
        shotNumber++
        const path = join(options.screenshotDirectory, `${String(shotNumber).padStart(2, '0')}-${name}.png`)
        await requirePage().screenshot({ path })
    }
    const expectNoCameraErrors = async (step: string, errorsBefore: number): Promise<void> => {
        const errors = (await probe.cameraErrors()).slice(errorsBefore)
        expect(errors.map(entry => entry.message), `camera errors during ${step}`).toEqual([])
    }
    const errorCount = async (): Promise<number> => (await probe.cameraErrors()).length

    const connected = await test.step('wait for the camera', () =>
        waitFor(`${probe.description} to report a connected camera`, options.connectTimeoutMilliseconds, async () => {
            const state = await probe.state()
            return state.connected ? state : undefined
        }).catch(error => {
            throw new Error(
                `${probe.description} did not report a connected camera` +
                    `${process.env.DARKGRADE_CAMERA ? ` (DARKGRADE_CAMERA=${process.env.DARKGRADE_CAMERA})` : ''}: ` +
                    `${error instanceof Error ? error.message : String(error)}`
            )
        })
    )
    const page = requirePage()
    const sidebar = page.getByRole('complementary', { name: 'Camera controls' })
    await screenshot(`connected-${connected.model ?? 'camera'}`)

    await test.step('battery and card readouts', async () => {
        const state = await probe.state()
        await page.getByRole('button', { name: new RegExp(escapeRegularExpression(state.model ?? 'camera'), 'i') }).first().click()
        const detail = (term: string): Locator => page.locator('dt', { hasText: new RegExp(`^${term}$`) }).locator('xpath=following-sibling::dd[1]')
        if (state.battery?.percent != null) await expect(detail('Battery')).toContainText(String(state.battery.percent))
        else await expect(detail('Battery')).toBeVisible()
        const digits = (text: string): string => text.replace(/\D/g, '')
        if (state.card?.remainingPhotos != null && (await detail('Photos left').count()) > 0)
            expect(digits(await detail('Photos left').innerText())).toBe(String(state.card.remainingPhotos))
        if (state.card?.remainingVideoSeconds != null) await expect(detail('Video left')).toBeVisible()
        await screenshot('readouts')
        if (state.osdOverlay !== null) {
            const display = page.locator('label', { hasText: 'Show camera display' }).getByRole('switch')
            for (const wanted of [!state.osdOverlay, state.osdOverlay]) {
                await display.click()
                await waitFor(`camera display ${wanted ? 'on' : 'off'}`, 10000, async () =>
                    (await probe.state()).osdOverlay === wanted ? true : undefined
                )
                if (wanted !== state.osdOverlay) await screenshot('camera-display')
            }
        }
        await page.keyboard.press('Escape')
    })

    await test.step('each setting row', async () => {
        const triggers = sidebar.locator('button[aria-haspopup]')
        const labels = await triggers.evaluateAll(elements => elements.map(element => element.getAttribute('aria-label') ?? ''))
        expect(labels.length, 'setting rows in the sidebar (selector out of date?)').toBeGreaterThan(0)
        for (const [index, label] of labels.entries()) {
            const trigger = triggers.nth(index)
            if (!(await trigger.isVisible()) || (await trigger.isDisabled())) continue
            const original = (await trigger.innerText()).trim()
            const before = await probe.state()
            await trigger.click()
            const choices = (await page.getByRole('option').allInnerTexts()).map(text => text.trim())
            const choice = choices.find(text => text !== original)
            if (!choice) {
                await page.keyboard.press('Escape')
                continue
            }
            const errorsBefore = await errorCount()
            await page.getByRole('option', { name: choice, exact: true }).click()
            await expect(trigger, `${label} shows the confirmed value`).toHaveText(choice, { timeout: 15000 })
            const changes = await waitFor(`the camera to report a new ${label}`, 15000, async () => {
                const changed = changedControls(before.controls, (await probe.state()).controls)
                return changed.length > 0 ? changed : undefined
            })
            await screenshot(`setting-${label}`)
            await trigger.click()
            await page.getByRole('option', { name: original, exact: true }).click()
            await expect(trigger, `${label} restored`).toHaveText(original, { timeout: 15000 })
            await waitFor(`${label} to read back as before (changed: ${changes.join(', ')})`, 15000, async () =>
                changedControls(before.controls, (await probe.state()).controls).length === 0 ? true : undefined
            )
            await expectNoCameraErrors(`setting ${label}`, errorsBefore)
        }
    })

    await test.step('click to focus, then Focus', async () => {
        const state = await probe.state()
        const errorsBefore = await errorCount()
        if (state.clickToFocus) {
            await page.getByRole('img', { name: 'Live view from the camera' }).click({ position: { x: 40, y: 40 } })
            await page.waitForTimeout(1500)
            await screenshot('click-to-focus')
        } else test.info().annotations.push({ type: 'skipped', description: 'the camera cannot place a focus point now' })
        await page.getByRole('button', { name: 'Autofocus' }).click()
        await page.waitForTimeout(1500)
        await screenshot('focus')
        await expectNoCameraErrors('focus', errorsBefore)
    })

    const photo = await test.step('take photo', async () => {
        const before = new Set((await probe.files()).map(entry => entry.id))
        const errorsBefore = await errorCount()
        await page.getByRole('button', { name: 'Take photo' }).click()
        const added = await waitFor('a new photo on the card', 60000, async () =>
            (await probe.files()).find(entry => !before.has(entry.id) && entry.kind === 'photo')
        )
        await screenshot('photo')
        await expectNoCameraErrors('take photo', errorsBefore)
        return added
    })

    await test.step('record then stop', async () => {
        const before = new Set((await probe.files()).map(entry => entry.id))
        const errorsBefore = await errorCount()
        await page.getByRole('button', { name: 'Record video' }).click()
        try {
            await waitFor('the camera to report recording', 30000, async () =>
                (await probe.state()).recordingState === 'recording' ? true : undefined
            )
            await page.waitForTimeout(3000)
            await screenshot('recording')
        } finally {
            // Stop is never skipped: if anything above failed, the camera may still be recording.
            const stop = page.getByRole('button', { name: 'Stop recording' })
            if (await stop.isVisible()) await stop.click()
        }
        await waitFor('the camera to report idle', 60000, async () =>
            (await probe.state()).recordingState === 'idle' ? true : undefined
        )
        await waitFor('a new clip on the card', 60000, async () =>
            (await probe.files()).find(entry => !before.has(entry.id) && entry.kind === 'clip')
        )
        await screenshot('stopped')
        await expectNoCameraErrors('record then stop', errorsBefore)
    })

    await test.step('card browser: thumbnail, preview and download', async () => {
        await checkCardBrowser(page, await probe.state(), photo, screenshot)
    })

    await test.step('overlay switches', async () => {
        const switches = sidebar.getByRole('switch')
        const count = await switches.count()
        for (let index = 0; index < count; index++) {
            const overlaySwitch = switches.nth(index)
            const name = (await overlaySwitch.locator('xpath=ancestor::label[1]').innerText().catch(() => '')).trim() || `switch ${index + 1}`
            if (!options.includeVisionOverlays && /depth|sam/i.test(name)) continue
            if (!(await overlaySwitch.isVisible()) || (await overlaySwitch.isDisabled())) continue
            const original = await overlaySwitch.getAttribute('aria-checked')
            const errorsBefore = await errorCount()
            await overlaySwitch.click()
            await expect(overlaySwitch, `${name} flipped`).not.toHaveAttribute('aria-checked', original ?? '')
            await page.waitForTimeout(1000)
            await screenshot(`overlay-${name}`)
            await overlaySwitch.click()
            await expect(overlaySwitch, `${name} restored`).toHaveAttribute('aria-checked', original ?? '')
            await expectNoCameraErrors(`overlay ${name}`, errorsBefore)
        }
    })
}

async function checkCardBrowser(
    page: Page,
    state: CameraState,
    photo: FileEntry,
    screenshot: (name: string) => Promise<void>
): Promise<void> {
    const list = page.getByRole('list', { name: 'Files on the card' })
    await expect(list).toBeVisible()
    const row = list.getByRole('listitem').filter({ hasText: photo.filename })
    if (photo.previews.includes('thumbnail'))
        await expect
            .poll(() => row.locator('img').evaluateAll(images => images.some(image => image instanceof HTMLImageElement && image.naturalWidth > 0)), {
                message: `thumbnail of ${photo.filename}`,
                timeout: 20000,
            })
            .toBe(true)
    await screenshot('card-browser')

    await page.getByRole('button', { name: `Preview ${photo.filename}` }).click()
    const close = page.getByRole('button', { name: 'Close preview' })
    await expect(close).toBeVisible()
    await expect(page.locator('[role=dialog] img, [role=dialog] video').first()).toBeVisible({ timeout: 30000 })
    await screenshot('preview')
    await close.click()

    const downloadedPath = join(state.downloadDir, photo.filename)
    const existedBefore = existsSync(downloadedPath)
    // Studio also saves a capture here, so a download must rewrite the file, not just find it.
    const modifiedBeforeMilliseconds = existedBefore ? statSync(downloadedPath).mtimeMs : 0
    await page.getByRole('button', { name: `Download ${photo.filename}` }).click()
    await waitFor(`${downloadedPath} to be written with ${photo.sizeBytes} bytes`, 120000, async () => {
        if (!existsSync(downloadedPath)) return undefined
        const written = statSync(downloadedPath)
        return written.size === photo.sizeBytes && written.mtimeMs > modifiedBeforeMilliseconds ? true : undefined
    })
    await screenshot('downloaded')
    // Only this Mac's copy, and only when the walk made it; the file on the card stays.
    if (!existedBefore) rmSync(downloadedPath)
}

function escapeRegularExpression(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
