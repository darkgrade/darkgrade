import { CodecType } from '@ptp/types/codec'

type BuildParamObject<Params extends readonly any[], Acc = {}> = Params extends readonly []
    ? Acc
    : Params extends readonly [infer Head, ...infer Tail]
      ? Head extends { name: infer N extends string; codec: infer C; required: true }
          ? BuildParamObject<Tail, Acc & Record<N, CodecType<C>>>
          : Head extends { name: infer N extends string; codec: infer C }
            ? BuildParamObject<Tail, Acc & Partial<Record<N, CodecType<C>>>>
            : BuildParamObject<Tail, Acc>
      : Acc

type BuildEventParamObject<Params extends readonly any[], Acc = {}> = Params extends readonly []
    ? Acc
    : Params extends readonly [infer Head, ...infer Tail]
      ? Head extends { name: infer N extends string; codec: infer C }
          ? BuildEventParamObject<Tail, Acc & Record<N, CodecType<C>>>
          : BuildEventParamObject<Tail, Acc>
      : Acc

export type OperationParams<Op extends { operationParameters: readonly any[] }> =
    Op['operationParameters'] extends readonly [] ? Record<string, never> : BuildParamObject<Op['operationParameters']>

export type OperationResponse<Op> = Op extends { dataCodec: infer C }
    ? { code: number; data: CodecType<C> }
    : Op extends { dataDirection: 'out' }
      ? { code: number; data: Uint8Array }
      : { code: number }

export type EventParams<E extends { parameters: readonly any[] }> = E['parameters'] extends readonly []
    ? Record<string, never>
    : BuildEventParamObject<E['parameters']>

export type EventNames<Events extends { [key: string]: { name: string } }> = Events[keyof Events]['name']
