/**
 * Hardware tests open the attached camera, which other agents and processes share. They run only
 * when SLATE_HARDWARE_TESTS=1, which `bun run camera:lease -- <command>` sets while it holds the
 * camera's cross-process lease. Without it, `usb-guard.ts` makes native USB enumeration report no
 * devices, so a test that reaches real USB by accident finds nothing rather than opening a camera.
 */
export const hardwareTestEnvironmentVariable = 'SLATE_HARDWARE_TESTS'
export const hardwareTestsEnabled = process.env[hardwareTestEnvironmentVariable] === '1'
