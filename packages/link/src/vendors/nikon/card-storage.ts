/** PTP access describes host uploads; Nikon's camera-side card protection is separate. */
export async function nikonCanRecordToStorage(camera: any, accessCapability: number): Promise<boolean> {
    if (accessCapability !== 0 && accessCapability !== 2) return false
    const property = camera.getInstance().registry.properties.MovieRecProhibitionCondition
    if (!property) return false
    const condition = await camera.get(property)
    if (typeof condition !== 'string' || !condition) return false
    return !/noCardInserted|cardAccessError|cardNotFormatted|noFreeSpace|cardProtected/.test(condition)
}
