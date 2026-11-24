#!/usr/bin/env node
import { runDarkgradeCli } from '@darkgrade/slate/cli'

process.exitCode = await runDarkgradeCli(process.argv.slice(2))
