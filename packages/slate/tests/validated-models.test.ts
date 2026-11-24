import {describe,expect,it} from 'vitest'
import {isValidatedModel,isVerifiedFeature,validatedCameraModels,verifiedFeatureModels} from '@camera/validated-models'
import {isSonyModelName} from '@vendors/sony/model-name'

describe('validated camera models',()=>{
    it('matches bench bodies by DeviceInfo name, ignoring case and spacing',()=>{
        expect(isValidatedModel('ILCE-6700')).toBe(true)
        expect(isValidatedModel(' canon eos  r6 mark iii ')).toBe(true)
        expect(isValidatedModel('ILCE-7M4')).toBe(false)
        expect(isValidatedModel(undefined)).toBe(false)
    })
    it('verifies a feature only on the bodies it was confirmed on',()=>{
        expect(isVerifiedFeature('sony-wireless','ILME-FX2')).toBe(true)
        expect(isVerifiedFeature('sony-card-fallback','ILME-FX2')).toBe(false)
        expect(isVerifiedFeature('nikon-wireless-status','Z6_3')).toBe(true)
        expect(isVerifiedFeature('nikon-wireless-status','Z5_2')).toBe(false)
        expect(isVerifiedFeature('sony-wireless',undefined)).toBe(false)
        for(const models of Object.values(verifiedFeatureModels))
            for(const model of models)expect(validatedCameraModels).toContain(model)
    })
    it('accepts any bounded Sony body name for attempted features',()=>{
        for(const model of ['ILCE-6700','ILME-FX3','ZV-E1','DSC-RX100M7','NEX-5T'])expect(isSonyModelName(model)).toBe(true)
        for(const model of ['unknown','Z6_3','ILCE-','ILCE-7M4 ; rm',undefined,7])expect(isSonyModelName(model)).toBe(false)
    })
})
