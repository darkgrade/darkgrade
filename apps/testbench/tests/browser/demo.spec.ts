import { expect, test } from '@playwright/test'

test('runs the simulated shoot and never calls a controller', async ({ page }, info) => {
    const apiCalls: string[] = []
    const pageErrors: string[] = []
    page.on('request', request => {
        if (new URL(request.url()).pathname.startsWith('/api/')) apiCalls.push(request.url())
    })
    page.on('pageerror', error => pageErrors.push(error.message))
    const response = await page.goto('/?mode=demo')
    expect(response?.headers()['content-security-policy']).toContain("connect-src 'self'")
    await expect(page.getByText('Simulated cameras', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Record simulated take', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Check cameras', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Record simulated take', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Record simulated take', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop simulated take', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Check cameras', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Stop simulated take', exact: true }).click()
    await expect(page.getByText('Simulated take 1', { exact: true })).toBeVisible()
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await page.screenshot({ path: info.outputPath('desktop.png'), fullPage: true, animations: 'disabled' })
    expect(apiCalls).toEqual([])
    expect(pageErrors).toEqual([])
})

test('control changes use the existing console, escape names, and support search', async ({ page }) => {
    await page.goto('/?mode=demo')
    await page.getByRole('button', { name: 'Controls', exact: true }).first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('ISO', { exact: true }).selectOption('800')
    await expect(dialog.getByLabel('ISO', { exact: true })).toHaveValue('800')
    await dialog.getByLabel('Find a camera setting').fill('gain')
    await expect(dialog.getByLabel('ISO', { exact: true })).toBeVisible()
    await expect(dialog.getByLabel('Aperture', { exact: true })).toBeHidden()
    await dialog.getByLabel('Find a camera setting').fill('')
    await dialog.getByLabel('Camera name', { exact: true }).fill('<img src=x onerror=alert(1)>')
    await dialog.getByLabel('Camera name', { exact: true }).press('Tab')
    await expect(dialog.getByRole('heading', { name: '<img src=x onerror=alert(1)>', exact: true })).toBeVisible()
    expect(await page.locator('img').count()).toBe(0)
    await dialog.getByRole('button', { name: 'Close camera controls' }).click()
    await expect(page.getByText('<img src=x onerror=alert(1)>', { exact: true }).first()).toBeVisible()
})

test('offline/busy scenarios block selected cameras and reset clears session state', async ({ page }) => {
    await page.goto('/?mode=demo')
    await page.getByRole('tab', { name: 'Demo setup', exact: true }).click()
    await page.getByLabel('Scenario', { exact: true }).selectOption('offline')
    await page.getByRole('tab', { name: 'Your shoot', exact: true }).click()
    await page.getByRole('button', { name: 'Check cameras', exact: true }).click()
    await expect(page.getByRole('status').last()).toContainText('offline')
    await expect(page.getByRole('button', { name: 'Record simulated take', exact: true })).toBeDisabled()
    await page.getByRole('checkbox', { name: 'Mirrorless camera', exact: true }).uncheck()
    await page.getByRole('button', { name: 'Check cameras', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Record simulated take', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Reset demo', exact: true }).click()
    await expect(page.getByRole('checkbox', { name: 'Mirrorless camera', exact: true })).toBeChecked()
    await expect(page.getByRole('button', { name: 'Record simulated take', exact: true })).toBeDisabled()
})

test('network access is denied and the phone layout remains usable', async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/?mode=demo')
    const blocked = await page.evaluate(async () => {
        try { await fetch('https://example.invalid/blocked'); return false }
        catch { return true }
    })
    expect(blocked).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('tab', { name: 'Your shoot', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('tab', { name: 'Cameras', exact: true })).toHaveAttribute('aria-selected', 'true')
    await page.screenshot({ path: info.outputPath('mobile.png'), fullPage: true, animations: 'disabled' })
    await page.getByRole('button', { name: 'Controls', exact: true }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
})
