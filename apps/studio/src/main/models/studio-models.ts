import { ModelCache } from '@main/models/model-cache'
import { PythonRuntime } from '@main/voice/python-runtime'
import { app } from 'electron'
import { join } from 'node:path'

let cache: ModelCache | undefined
let python: PythonRuntime | undefined

/** The one model download folder the assistant, speech and vision share. */
export function studioModelCache(): ModelCache {
    return (cache ??= new ModelCache(join(app.getPath('userData'), 'models')))
}

/** Studio's one private Python, which the speech and vision environments are built on. */
export function studioPythonRuntime(): PythonRuntime {
    return (python ??= new PythonRuntime({ directory: join(app.getPath('userData'), 'python-runtime') }))
}
