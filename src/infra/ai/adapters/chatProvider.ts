/**
 * 对话型 AIProvider 共享核心（T2-01/T2-02/T3-02/T4-05）。
 *
 * 把「prompt 构造 → 发送 → JSON 提取 → zod 校验」固定为一条流水线，
 * 供应商/链路差异仅通过 ChatTransport 注入：
 * - direct（Qwen）：直连供应商兼容端点，body 带 model，header 带 Bearer Key；
 * - bff：POST 同源 /api/ai/:endpoint，model 与 Key 由服务端注入。
 */
import {
  type AIProvider,
  type CopyReq,
  type CopyResp,
  type MenuScanReq,
  type MenuScanResp,
  type RecognizeReq,
  type RecognizeResp,
  type TagReq,
  type TagResp,
} from '../types'
import { copyRespSchema, menuScanRespSchema, recognizeRespSchema, tagRespSchema } from '../schemas'
import {
  buildCardCopyUser,
  buildMenuScanUser,
  buildRecognizeUser,
  buildTagsUser,
  cardCopySystem,
  menuScanSystem,
  recognizeSystem,
  tagsSystem,
  type VocabPayload,
} from '../prompts'
import { parseChatJson, type ChatCompletionRaw, type ChatSpec } from './openaiChat'

export type AiEndpointName = 'recognize' | 'menuScan' | 'tags' | 'cardCopy'

/** 链路差异：direct 注入 model+鉴权；bff 换路径并不下发 model */
export interface ChatTransport {
  invoke(endpoint: AiEndpointName, spec: ChatSpec, signal?: AbortSignal): Promise<ChatCompletionRaw>
  /** 实际供应商名（dashscope / ark…），写入 AIModelInfo.vendor */
  vendor: string
  /** 无 raw.model 回显时的模型名兜底（按端点） */
  fallbackModel(endpoint: AiEndpointName): string
}

/** 词表缺失兜底：prompt 仍可工作，仅失去受控词归一 */
export const EMPTY_VOCAB: VocabPayload = {
  version: 'unset',
  taste: [],
  cuisine: [],
  ingredient: [],
  cooking: [],
  scene: [],
}

export interface ChatProviderOptions {
  transport: ChatTransport
  vocab?: VocabPayload
}

function asRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
}

function requestId(raw: ChatCompletionRaw): string {
  return raw.id ?? globalThis.crypto.randomUUID()
}

export function createChatProvider(opts: ChatProviderOptions): AIProvider {
  const { transport } = opts
  const vocab = opts.vocab ?? EMPTY_VOCAB

  async function call(endpoint: AiEndpointName, spec: ChatSpec, signal?: AbortSignal) {
    const raw = await transport.invoke(endpoint, spec, signal)
    return { raw, data: asRecord(parseChatJson(raw)) }
  }

  return {
    async recognizeDish(req: RecognizeReq, signal?: AbortSignal): Promise<RecognizeResp> {
      const spec: ChatSpec = {
        system: recognizeSystem,
        userText: buildRecognizeUser(req),
        images: req.images,
        temperature: 0.2,
        jsonMode: true,
      }
      const { raw, data } = await call('recognize', spec, signal)
      return recognizeRespSchema.parse({
        requestId: requestId(raw),
        results: data.results,
        model: {
          vendor: transport.vendor,
          version: raw.model ?? transport.fallbackModel('recognize'),
        },
      })
    },

    async scanMenu(req: MenuScanReq, signal?: AbortSignal): Promise<MenuScanResp> {
      const spec: ChatSpec = {
        system: menuScanSystem,
        userText: buildMenuScanUser(req),
        images: req.images,
        temperature: 0.1,
        // qwen-vl-ocr 不支持 response_format=json_object，靠 prompt + 容错解析
        jsonMode: false,
      }
      const { raw, data } = await call('menuScan', spec, signal)
      return menuScanRespSchema.parse({
        requestId: requestId(raw),
        results: data.results,
        model: {
          vendor: transport.vendor,
          version: raw.model ?? transport.fallbackModel('menuScan'),
        },
      })
    },

    async extractTags(req: TagReq, signal?: AbortSignal): Promise<TagResp> {
      const spec: ChatSpec = {
        system: tagsSystem,
        userText: buildTagsUser(req, vocab),
        images: req.images,
        temperature: 0.2,
        jsonMode: true,
      }
      // TagResp 冻结结构不含 requestId/model；供应商信息由调用方写日志侧
      const { data } = await call('tags', spec, signal)
      return tagRespSchema.parse({ tags: asRecord(data.tags) })
    },

    async generateCardCopy(req: CopyReq, signal?: AbortSignal): Promise<CopyResp> {
      const spec: ChatSpec = {
        system: cardCopySystem,
        userText: buildCardCopyUser(req),
        temperature: 0.9,
        jsonMode: true,
      }
      const { data } = await call('cardCopy', spec, signal)
      return copyRespSchema.parse({ lines: data.lines })
    },
  }
}
