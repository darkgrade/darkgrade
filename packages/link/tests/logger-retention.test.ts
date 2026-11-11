import { Logger } from '@core/logger'
import { describe, expect, it } from 'vitest'

function quietLogger(maxTransactions: number): Logger {
    return new Logger({ captureConsole: false, renderInTerminal: false, maxTransactions })
}

function logOperation(logger: Logger, transactionId: number): number {
    return logger.addLog({
        type: 'ptp_operation',
        level: 'info',
        sessionId: 1,
        transactionId,
        requestPhase: { timestamp: 0, operationName: 'GetObject', encodedParams: [], decodedParams: {} },
    })
}

describe('Logger retention', () => {
    it('keeps only the most recent transactions, so a long live view cannot grow without bound', () => {
        const logger = quietLogger(100)
        for (let transactionId = 1; transactionId <= 5000; transactionId++) logOperation(logger, transactionId)
        const transactions = logger.getOrderedTransactions()
        expect(transactions.length).toBeLessThanOrEqual(110)
        expect(logger.getLogsByTransaction(1, 5000)).toHaveLength(1)
        expect(logger.getLogsByTransaction(1, 1)).toHaveLength(0)
    })

    it('updates and finds a recent log by id after older ones are dropped', () => {
        const logger = quietLogger(100)
        let lastId = 0
        for (let transactionId = 1; transactionId <= 500; transactionId++) lastId = logOperation(logger, transactionId)
        logger.updateLog(lastId, { level: 'error' })
        expect(logger.getLogById(lastId)?.level).toBe('error')
    })

    it('keeps a transfer that is still in progress', () => {
        const logger = quietLogger(100)
        const transferId = logger.startTransfer(42, 1, 1, 'GetPartialObject', 1_000_000)
        for (let transactionId = 2; transactionId <= 1000; transactionId++) logOperation(logger, transactionId)
        expect(logger.getLogById(transferId)).toBeDefined()
        logger.completeTransfer(42)
        for (let transactionId = 1001; transactionId <= 1200; transactionId++) logOperation(logger, transactionId)
        expect(logger.getLogById(transferId)).toBeUndefined()
    })
})
