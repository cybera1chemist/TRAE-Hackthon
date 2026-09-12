/**
 * zod DTO 校验（T0-06 / TDD §5.1：所有 DTO 用 zod schema 校验，
 * 不合规 = BAD_OUTPUT，按失败处理进入降级）。
 * 结构与 types.ts 一一对应；供应商 adapter 在出参处 parse，失败抛 AIError('BAD_OUTPUT')。
 */
import { z } from 'zod'

const bboxTuple = z.tuple([z.number(), z.number(), z.number(), z.number()])
const modelInfo = z.object({ vendor: z.string(), version: z.string() })
const confidence = z.number().min(0).max(1)

export const recognizeRespSchema = z.object({
  requestId: z.string(),
  results: z.array(
    z.object({
      imageIndex: z.number().int(),
      imageQuality: z.object({ blur: z.boolean(), hasFood: z.boolean() }),
      dishes: z.array(
        z.object({
          name: z.string().min(1),
          confidence,
          candidates: z.array(z.string()),
          bbox: bboxTuple,
        }),
      ),
    }),
  ),
  model: modelInfo,
})

export const menuScanRespSchema = z.object({
  requestId: z.string(),
  results: z.array(
    z.object({
      imageIndex: z.number().int(),
      sections: z.array(
        z.object({
          name: z.string(),
          items: z.array(
            z.object({
              name: z.string().min(1),
              price: z.number().nullable(),
              spec: z.string().optional(),
              confidence,
              bbox: bboxTuple,
            }),
          ),
        }),
      ),
      unreadableRegions: z.array(bboxTuple),
    }),
  ),
  model: modelInfo,
})

const tagSuggestion = z.object({ value: z.string().min(1), confidence })
const dimTags = z.array(tagSuggestion)

export const tagRespSchema = z.object({
  tags: z.object({
    taste: dimTags.optional(),
    cuisine: z
      .object({ primary: tagSuggestion.optional(), secondary: dimTags.optional() })
      .optional(),
    ingredient: dimTags.optional(),
    cooking: dimTags.optional(),
    scene: dimTags.optional(),
    custom: dimTags.optional(),
  }),
})

export const copyRespSchema = z.object({ lines: z.array(z.string().min(1)) })
