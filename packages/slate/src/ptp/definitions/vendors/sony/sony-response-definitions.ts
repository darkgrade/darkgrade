import { ResponseDefinition } from '@ptp/types/response'

export const AuthenticationFailed = {
    code: 0xa101,
    name: 'AuthenticationFailed',
    description:
        'Indicates that the major version of the connected host is less than that of the camera. It also indicates that authentication fails due to some other factor.',
} as const satisfies ResponseDefinition

export const PasswordLengthOverMax = {
    code: 0xa102,
    name: 'PasswordLengthOverMax',
    description: 'Indicates that the password length is over max.',
} as const satisfies ResponseDefinition

export const PasswordIncludesInvalidCharacter = {
    code: 0xa103,
    name: 'PasswordIncludesInvalidCharacter',
    description: 'Indicates that the password includes invalid character.',
} as const satisfies ResponseDefinition

export const FeatureVersionInvalidValue = {
    code: 0xa104,
    name: 'FeatureVersionInvalidValue',
    description: 'Indicates that the feature version is invalid value.',
} as const satisfies ResponseDefinition

export const TemporaryStorageFull = {
    code: 0xa105,
    name: 'TemporaryStorageFull',
    description: 'Indicates that the temporary storage is full.',
} as const satisfies ResponseDefinition

export const CameraStatusError = {
    code: 0xa106,
    name: 'CameraStatusError',
    description: 'Indicates that a camera status error occurred.',
} as const satisfies ResponseDefinition

export const sonyResponseRegistry = {
    AuthenticationFailed,
    PasswordLengthOverMax,
    PasswordIncludesInvalidCharacter,
    FeatureVersionInvalidValue,
    TemporaryStorageFull,
    CameraStatusError,
} as const

export type SonyResponseDef = (typeof sonyResponseRegistry)[keyof typeof sonyResponseRegistry]
