// Browser-safe: no node: imports. Cross-process leases (HardwareCoordinator) need
// Node's AsyncLocalStorage and stay in the default entry and `./ownership`.
export { HardwareBusyError } from '@runtime/errors'
export { HttpCameraClient } from '@runtime/http-client'
export { CameraRuntime } from '@runtime/runtime'
export type { CameraClient, CameraProvider, OperationReply } from '@runtime/runtime'
export { OperationInputError, readOperationInput, runOperation, surfaceOperation, surfaceOperations } from '@runtime/operations'
export type {
    CameraOperationDescription,
    OperationFile,
    OperationInput,
    OperationOutcome,
    OperationParameter,
    SurfaceOperation,
} from '@runtime/operations'
