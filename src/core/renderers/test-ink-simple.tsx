#!/usr/bin/env node
import React from 'react'
import { render } from 'ink'
import { Logger } from '../logger'
import { InkSimpleLogger } from './ink-simple'
import { operationDefinitions } from '../../ptp/definitions/operation-definitions'
import { populateMockData } from './mock-data'

async function main() {
    // Create logger
    const logger = new Logger<typeof operationDefinitions>({
        minLevel: 'debug',
        collapse: false,
        expandOnError: true,
        collapseUSB: false,
        showEncodedData: true,
        showDecodedData: true,
        maxLogs: 100,
    })

    // Render first (Ink will update as data comes in)
    render(<InkSimpleLogger logger={logger} />)

    // Then populate mock data (will trigger updates)
    await populateMockData(logger)

    // Exit after data is populated
    process.exit(0)
}

main()
