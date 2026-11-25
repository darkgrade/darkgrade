#!/usr/bin/env node
import { runDarkgradeCli } from '@darkgrade/slate/cli'
import { readFileSync } from 'node:fs'

// The published version is set on package.json at release, after this file is written.
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

process.exitCode = await runDarkgradeCli(process.argv.slice(2), { version })
