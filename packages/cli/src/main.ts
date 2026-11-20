#!/usr/bin/env node
import { runDarkgradeCli } from '@darkgrade/link/cli'

process.exitCode = await runDarkgradeCli(process.argv.slice(2))
