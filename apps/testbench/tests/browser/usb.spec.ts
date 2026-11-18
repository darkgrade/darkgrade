import { expect, test } from '@playwright/test'

test('USB UI drives the actual HTTP host: scan, connect, control, frame, photo and recording', async ({ page }, info) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('http://localhost:5232/')
    await expect(page.getByText('Build your bench.', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Connect cameras', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Scan USB cameras', exact: true }).click()
    await expect(page.getByText('USB host test fixture', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Connect cameras', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Record cameras', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Controls', exact: true }).first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('ISO', { exact: true }).selectOption('200')
    await expect(dialog.getByLabel('ISO', { exact: true })).toHaveValue('200')
    await expect(dialog.getByLabel('Aperture', { exact: true })).toBeDisabled()
    await dialog.getByRole('button', { name: 'Read live-view frame', exact: true }).click()
    await expect(dialog.getByAltText('Live-view frame from USB camera fixture')).toBeVisible()
    await expect.poll(() => dialog.locator('img').evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth === 16))).toBe(true)
    const download = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Capture and download photo', exact: true }).click()
    expect((await download).suggestedFilename()).toBe('FIXTURE.PNG')
    await page.screenshot({ path: info.outputPath('usb-console.png'), fullPage: true, animations: 'disabled' })
    await dialog.getByRole('button', { name: 'Close camera controls' }).click()
    await page.getByRole('button', { name: 'Connect cameras', exact: true }).click()
    await page.getByRole('button', { name: 'Record cameras', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop cameras', exact: true })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Disconnect cameras', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Stop cameras', exact: true }).click()
    await expect(page.getByText('Stopped take 1', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Disconnect cameras', exact: true }).click()
    expect(errors).toEqual([])
})

test('an ambiguous start remains stoppable and is never sent twice by the UI', async ({ page }) => {
    await page.goto('http://localhost:5232/')
    await page.getByRole('button', { name: 'Scan USB cameras', exact: true }).click()
    await page.getByRole('button', { name: 'Connect cameras', exact: true }).click()
    let starts = 0
    await page.route('**/api/cameras/*/action', async route => {
        const action = route.request().postDataJSON().action
        if (action !== 'start') return route.continue()
        starts++
        const response = await route.fetch()
        const state = await response.json()
        state.cameras[0].recording = 'uncertain'
        state.cameras[0].error = 'The recording start reply was lost; inspect before repeating'
        await route.fulfill({ status: 409, json: { error: state.cameras[0].error, state } })
    })
    await page.getByRole('button', { name: 'Record cameras', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop cameras', exact: true })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Disconnect cameras', exact: true })).toBeDisabled()
    expect(starts).toBe(1)
    await page.getByRole('button', { name: 'Stop cameras', exact: true }).click()
    await page.getByRole('button', { name: 'Disconnect cameras', exact: true }).click()
})
