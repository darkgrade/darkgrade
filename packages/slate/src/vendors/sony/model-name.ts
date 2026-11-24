/** Sony DeviceInfo/SDK body names (ILCE-6700, ILME-FX2, ZV-E1, DSC-RX100M7); bounded so it is safe to log. */
const sonyModelName = /^(?:ILCE|ILME|DSC|NEX|ZV)-[A-Za-z0-9-]{1,40}$/

export function isSonyModelName(model: unknown): model is string {
    return typeof model === 'string' && sonyModelName.test(model)
}
