import type { AreaOperationTable } from '@camera/operations/table/operation-entry'

/**
 * The settings area's operations. `current` lists every method on Camera today with its
 * disposition; `planned` lists target operations not on Camera yet. When one lands, move its entry
 * from `planned` to `current` (the compiler fails until the table and Camera agree).
 */
export const settingsOperationTable = {
    current: {
        getCapabilities: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Every setting\'s current value and choices, which operations this camera supports right now (with the reason when not), and the lens and its focal length',
        },
        setControl: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Sets any setting by id. For UIs that list every setting',
            surfaces: {
                cli: {
                    arguments: [{ name: 'id', description: 'a setting id or alias' }, { name: 'value', description: 'one of its allowed values' }],
                },
            },
        },
        getExposureTime: {
            area: 'settings',
            disposition: { kind: 'replaced-by', target: 'getShutterSpeed' },
        },
        setExposureTime: {
            area: 'settings',
            disposition: { kind: 'replaced-by', target: 'setShutterSpeed' },
        },
        setCanonManualExposureMode: {
            area: 'settings',
            disposition: { kind: 'replaced-by', target: 'setExposureMode' },
        },
        getSonyColorTemperature: {
            area: 'settings',
            disposition: { kind: 'replaced-by', target: 'getColorTemperature' },
        },
        setSonyColorTemperature: {
            area: 'settings',
            disposition: { kind: 'replaced-by', target: 'setColorTemperature' },
        },
        getCanonColorTemperature: {
            area: 'settings',
            disposition: { kind: 'replaced-by', target: 'getColorTemperature' },
        },
        setCanonColorTemperature: {
            area: 'settings',
            disposition: { kind: 'replaced-by', target: 'setColorTemperature' },
        },
        getMovieServoAutofocus: {
            area: 'settings',
            disposition: {
                kind: 'replaced-by',
                target: 'getFocusMode',
                note: 'In video mode Movie Servo AF on reads AF-C and off reads AF-S',
            },
        },
        setMovieServoAutofocus: {
            area: 'settings',
            disposition: {
                kind: 'replaced-by',
                target: 'setFocusMode',
                note: 'In video mode Movie Servo AF on reads AF-C and off reads AF-S',
            },
        },
        getContinuousAutofocus: {
            area: 'settings',
            disposition: {
                kind: 'replaced-by',
                target: 'getCapabilities',
                note: 'Canon Continuous AF pre-focuses in One-Shot and is not AF-C; it is the control continuousAutofocus',
            },
        },
        setContinuousAutofocus: {
            area: 'settings',
            disposition: {
                kind: 'replaced-by',
                target: 'setControl',
                note: 'Canon Continuous AF pre-focuses in One-Shot and is not AF-C; it is the control continuousAutofocus',
            },
        },
        getCanonLiveViewAutofocusMode: {
            area: 'settings',
            disposition: { kind: 'replaced-by', target: 'getFocusArea' },
        },
        setCanonLiveViewAutofocusMode: {
            area: 'settings',
            disposition: { kind: 'replaced-by', target: 'setFocusArea' },
        },
        getSonyImageFormat: {
            area: 'settings',
            disposition: { kind: 'replaced-by', target: 'getPhotoFormat' },
        },
        setSonyImageFormat: {
            area: 'settings',
            disposition: { kind: 'replaced-by', target: 'setPhotoFormat' },
        },
        getImageFormat: {
            area: 'settings',
            disposition: { kind: 'replaced-by', target: 'getPhotoFormat' },
        },
        setImageFormat: {
            area: 'settings',
            disposition: { kind: 'replaced-by', target: 'setPhotoFormat' },
        },
        getSonyJpegQuality: {
            area: 'settings',
            disposition: { kind: 'replaced-by', target: 'getJpegQuality' },
        },
        setSonyJpegQuality: {
            area: 'settings',
            disposition: { kind: 'replaced-by', target: 'setJpegQuality' },
        },
        getSonyImageSize: {
            area: 'settings',
            disposition: { kind: 'replaced-by', target: 'getPhotoSize' },
        },
        setSonyImageSize: {
            area: 'settings',
            disposition: { kind: 'replaced-by', target: 'setPhotoSize' },
        },
        getSonyAspectRatio: {
            area: 'settings',
            disposition: { kind: 'replaced-by', target: 'getAspectRatio' },
        },
        setSonyAspectRatio: {
            area: 'settings',
            disposition: { kind: 'replaced-by', target: 'setAspectRatio' },
        },
        getSonyMovieFileFormat: {
            area: 'settings',
            disposition: { kind: 'replaced-by', target: 'getVideoFormat' },
        },
        setSonyMovieFileFormat: {
            area: 'settings',
            disposition: { kind: 'replaced-by', target: 'setVideoFormat' },
        },
        getMovieFormat: {
            area: 'settings',
            disposition: { kind: 'replaced-by', target: 'getVideoFormat' },
        },
        setMovieFormat: {
            area: 'settings',
            disposition: { kind: 'replaced-by', target: 'setVideoFormat' },
        },
        getSonyMovieRecordingSetting: {
            area: 'settings',
            disposition: { kind: 'replaced-by', target: 'getVideoQuality' },
        },
        setSonyMovieRecordingSetting: {
            area: 'settings',
            disposition: { kind: 'replaced-by', target: 'setVideoQuality' },
        },
        getMovieSize: {
            area: 'settings',
            disposition: { kind: 'replaced-by', target: 'getVideoQuality' },
        },
        getSonyZoomSetting: {
            area: 'settings',
            disposition: { kind: 'replaced-by', target: 'getDigitalZoom' },
        },
        setSonyZoomSetting: {
            area: 'settings',
            disposition: { kind: 'replaced-by', target: 'setDigitalZoom' },
        },
        getCanonMovieSoundRecording: {
            area: 'settings',
            disposition: { kind: 'replaced-by', target: 'getAudioRecording' },
        },
        setCanonMovieSoundRecording: {
            area: 'settings',
            disposition: { kind: 'replaced-by', target: 'setAudioRecording' },
        },
        getShutterSpeed: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'The current shutter speed, in canonical spelling',
        },
        setShutterSpeed: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Sets the shutter speed and returns the value read back',
            surfaces: {
                cli: {
                    arguments: [{ name: 'value', description: 'for example 1/250' }],
                },
            },
        },
        getAperture: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'The current aperture, in canonical spelling',
        },
        setAperture: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Sets the aperture and returns the value read back',
            surfaces: {
                cli: {
                    arguments: [{ name: 'value', description: 'for example f/2.8' }],
                },
            },
        },
        getIso: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'The current ISO, in canonical spelling',
        },
        setIso: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Sets the ISO and returns the value read back',
            surfaces: {
                cli: {
                    arguments: [{ name: 'value', description: 'for example ISO 800' }],
                },
            },
        },
        getExposureMode: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'The current exposure mode, in canonical spelling',
        },
        setExposureMode: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Sets the exposure mode and returns the value read back',
            surfaces: {
                cli: {
                    arguments: [{ name: 'value', description: 'for example Manual' }],
                },
            },
        },
        getExposureCompensation: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'The current exposure compensation, in canonical spelling',
        },
        setExposureCompensation: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Sets the exposure compensation and returns the value read back',
            surfaces: {
                cli: {
                    arguments: [{ name: 'value', description: 'for example +0.7' }],
                },
            },
        },
        getMeteringMode: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'The current metering mode, in canonical spelling',
        },
        setMeteringMode: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Sets the metering mode and returns the value read back',
            surfaces: {
                cli: {
                    arguments: [{ name: 'value', description: 'for example Spot' }],
                },
            },
        },
        getWhiteBalance: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'The current white balance, in canonical spelling',
        },
        setWhiteBalance: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Sets the white balance and returns the value read back',
            surfaces: {
                cli: {
                    arguments: [{ name: 'value', description: 'for example Daylight' }],
                },
            },
        },
        getFocusMode: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'The current focus mode, in canonical spelling',
        },
        setFocusMode: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Sets the focus mode and returns the value read back',
            surfaces: {
                cli: {
                    arguments: [{ name: 'value', description: 'for example AF-C' }],
                },
            },
        },
        getPhotoVideoMode: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'The current photo/video mode, in canonical spelling',
        },
        setPhotoVideoMode: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Sets the photo/video mode and returns the value read back',
            surfaces: {
                cli: {
                    arguments: [{ name: 'value', description: 'for example video' }],
                },
            },
        },
        getDriveMode: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'The current drive mode, in canonical spelling',
        },
        setDriveMode: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Sets the drive mode and returns the value read back',
            surfaces: {
                cli: {
                    arguments: [{ name: 'value', description: 'for example Single' }],
                },
            },
        },
        getColorTemperature: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'The current colour temperature, in kelvin',
        },
        setColorTemperature: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Sets the colour temperature and returns the value read back',
            surfaces: {
                cli: {
                    arguments: [{ name: 'value', description: 'for example 5600' }],
                },
            },
        },
        getPictureStyle: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'The current look (picture style), in canonical spelling',
        },
        setPictureStyle: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Sets the look (picture style) and returns the value read back',
            surfaces: {
                cli: {
                    arguments: [{ name: 'value', description: 'for example Standard' }],
                },
            },
        },
        getPictureProfile: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'The current picture profile, in canonical spelling',
        },
        setPictureProfile: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Sets the picture profile and returns the value read back',
            surfaces: {
                cli: {
                    arguments: [{ name: 'value', description: 'for example PP8' }],
                },
            },
        },
        getFocusArea: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'The current focus area, in canonical spelling',
        },
        setFocusArea: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Sets the focus area and returns the value read back',
            surfaces: {
                cli: {
                    arguments: [{ name: 'value', description: 'for example Zone' }],
                },
            },
        },
        getSubjectDetection: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'The current subject detection, in canonical spelling',
        },
        setSubjectDetection: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Sets the subject detection and returns the value read back',
            surfaces: {
                cli: {
                    arguments: [{ name: 'value', description: 'for example On' }],
                },
            },
        },
        getDetectionSubject: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'The current detection subject, in canonical spelling',
        },
        setDetectionSubject: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Sets the detection subject and returns the value read back',
            surfaces: {
                cli: {
                    arguments: [{ name: 'value', description: 'for example People' }],
                },
            },
        },
        getEyeSelection: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'The current eye selection, in canonical spelling',
        },
        setEyeSelection: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Sets the eye selection and returns the value read back',
            surfaces: {
                cli: {
                    arguments: [{ name: 'value', description: 'for example Auto' }],
                },
            },
        },
        getPhotoFormat: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'The current photo format, in canonical spelling',
        },
        setPhotoFormat: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Sets the photo format and returns the value read back',
            surfaces: {
                cli: {
                    arguments: [{ name: 'value', description: 'for example RAW+JPEG' }],
                },
            },
        },
        getPhotoSize: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'The current photo size, in canonical spelling',
        },
        setPhotoSize: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Sets the photo size and returns the value read back',
            surfaces: {
                cli: {
                    arguments: [{ name: 'value', description: 'for example Large' }],
                },
            },
        },
        getAspectRatio: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'The current aspect ratio, in canonical spelling',
        },
        setAspectRatio: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Sets the aspect ratio and returns the value read back',
            surfaces: {
                cli: {
                    arguments: [{ name: 'value', description: 'for example 3:2' }],
                },
            },
        },
        getJpegQuality: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'The current JPEG quality, in canonical spelling',
        },
        setJpegQuality: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Sets the JPEG quality and returns the value read back',
            surfaces: {
                cli: {
                    arguments: [{ name: 'value', description: 'for example Fine' }],
                },
            },
        },
        getRawCompression: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'The current RAW compression, in canonical spelling',
        },
        setRawCompression: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Sets the RAW compression and returns the value read back',
            surfaces: {
                cli: {
                    arguments: [{ name: 'value', description: 'for example Lossless' }],
                },
            },
        },
        getFlashMode: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'The current flash mode, in canonical spelling',
        },
        setFlashMode: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Sets the flash mode and returns the value read back',
            surfaces: {
                cli: {
                    arguments: [{ name: 'value', description: 'for example Off' }],
                },
            },
        },
        getVideoFormat: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'The current video format, in canonical spelling',
        },
        setVideoFormat: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Sets the video format and returns the value read back',
            surfaces: {
                cli: {
                    arguments: [{ name: 'value', description: 'for example XAVC S 4K' }],
                },
            },
        },
        getVideoQuality: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'The current video quality, in canonical spelling',
        },
        setVideoQuality: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Sets the video quality and returns the value read back',
            surfaces: {
                cli: {
                    arguments: [{ name: 'value', description: 'for example 150M 4:2:0 10-bit' }],
                },
            },
        },
        getFrameRate: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'The current frame rate, in canonical spelling',
        },
        setFrameRate: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Sets the frame rate and returns the value read back',
            surfaces: {
                cli: {
                    arguments: [{ name: 'value', description: 'for example 24p' }],
                },
            },
        },
        getAudioRecording: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'The current audio recording, in canonical spelling',
        },
        setAudioRecording: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Sets the audio recording and returns the value read back',
            surfaces: {
                cli: {
                    arguments: [{ name: 'value', description: 'for example On' }],
                },
            },
        },
        getDigitalZoom: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'The current digital zoom, in canonical spelling',
        },
        setDigitalZoom: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Sets the digital zoom and returns the value read back',
            surfaces: {
                cli: {
                    arguments: [{ name: 'value', description: 'for example Off' }],
                },
            },
        },
        getLiveViewQuality: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'The current live-view quality, in canonical spelling',
        },
        setLiveViewQuality: {
            area: 'settings',
            disposition: { kind: 'keep' },
            summary: 'Sets the live-view quality and returns the value read back',
            surfaces: {
                cli: {
                    arguments: [{ name: 'value', description: 'for example High' }],
                },
            },
        },
    },
    planned: {},
} as const satisfies AreaOperationTable
