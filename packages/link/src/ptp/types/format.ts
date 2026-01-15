export interface FormatDefinition {
    code: number
    name: string
    description: string
    category: 'non-image' | 'audio' | 'video' | 'image' | 'other'
}
