const sonyResponse = <const Code extends number, const Name extends string, const Description extends string>(
    code: Code,
    name: Name,
    description: Description
) => ({ code, name, description }) as const

export const sonyResponseRegistry = {
    AuthenticationFailed: sonyResponse(
        0xa101,
        'AuthenticationFailed',
        'Indicates that the major version of the connected host is less than that of the camera. It also indicates that authentication fails due to some other factor.'
    ),
    PasswordLengthOverMax: sonyResponse(0xa102, 'PasswordLengthOverMax', 'Indicates that the password length is over max.'),
    PasswordIncludesInvalidCharacter: sonyResponse(
        0xa103,
        'PasswordIncludesInvalidCharacter',
        'Indicates that the password includes invalid character.'
    ),
    FeatureVersionInvalidValue: sonyResponse(0xa104, 'FeatureVersionInvalidValue', 'Indicates that the feature version is invalid value.'),
    TemporaryStorageFull: sonyResponse(0xa105, 'TemporaryStorageFull', 'Indicates that the temporary storage is full.'),
    CameraStatusError: sonyResponse(0xa106, 'CameraStatusError', 'Indicates that a camera status error occurred.'),
} as const

export type SonyResponseDef = (typeof sonyResponseRegistry)[keyof typeof sonyResponseRegistry]
