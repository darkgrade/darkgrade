export type Row = { path: string; data: Record<string, any> }
export interface Transaction {
    get(path: string): Promise<Record<string, any> | undefined>
    set(path: string, data: Record<string, any>): void
    delete(path: string): void
}
export interface Database {
    transaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T>
    get(path: string): Promise<Record<string, any> | undefined>
    list(collection: string, field?: string, value?: unknown, after?: string): Promise<Row[]>
}
