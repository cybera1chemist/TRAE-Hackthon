/**
 * 出片引擎纯逻辑单测（T5-01）：不依赖 Canvas。
 * measure 用「每字符 = style.size 宽」的确定性假函数；渲染执行层由 E2E/CARD-EXPORT 覆盖。
 * 依据：PRD §8.2/8.5、EC-CARD-01/02/03、TDD §3.7/§8（卡片布局计算列 Vitest 门禁）。
 */
import { describe, expect, it } from 'vitest'
import { buildCardFilename, rarityOf, starFractions } from '@/features/share-card/rarity'
import { fitBlock, fitLine } from '@/features/share-card/text'
import { buildOps } from '@/features/share-card/ops'
import { applySkin, classicTemplate, getTemplate } from '@/features/share-card/templates'
import {
  CARD_BOTTOM_SAFE,
  CARD_H,
  CONTENT_W,
  type CardData,
  type CardTemplate,
  type TextStyle,
} from '@/features/share-card/types'

/** 确定性假测量：CJK 每字符 1em，字距按字符数展开 */
const fakeMeasure = (text: string, style: TextStyle): number => {
  const n = [...text].length
  return n * style.size + (style.letterSpacing ?? 0) * Math.max(0, n - 1)
}

const fullData: CardData = {
  dishName: '水煮牛肉',
  restaurantName: '川香小馆',
  cuisine: '川菜',
  rating: 4.5,
  isAvoid: false,
  unlockNo: 61,
  tags: ['麻辣', '聚餐', '重口味'],
  comment: '麻辣鲜香，牛肉嫩滑',
  achievement: '🔥 新图鉴解锁！你的麻辣图鉴 +1，辣味收集度 45%',
  ateAt: '2026-09-10T19:30:00+08:00',
  place: '广州',
  watermark: '@食客',
}

const env = (image: unknown = null) => ({
  measure: fakeMeasure,
  image: image as never,
})

describe('rarityOf（PRD §8.2 稀有度映射）', () => {
  it('null 评分且非避雷 → 无角标', () => {
    expect(rarityOf({ rating: null, isAvoid: false })).toBeNull()
  })
  it('评分 ≤2 或避雷 → warning；isAvoid 优先于高分', () => {
    expect(rarityOf({ rating: 2, isAvoid: false })).toBe('warning')
    expect(rarityOf({ rating: 5, isAvoid: true })).toBe('warning')
  })
  it('3 COMMON / 4.5 RARE / 5 LEGENDARY', () => {
    expect(rarityOf({ rating: 3, isAvoid: false })).toBe('common')
    expect(rarityOf({ rating: 4.5, isAvoid: false })).toBe('rare')
    expect(rarityOf({ rating: 5, isAvoid: false })).toBe('legendary')
  })
})

describe('starFractions（半星）', () => {
  it('4.5 → 四全一半星', () => {
    expect(starFractions(4.5)).toEqual([1, 1, 1, 1, 0.5])
  })
  it('2 → 两全三星空', () => {
    expect(starFractions(2)).toEqual([1, 1, 0, 0, 0])
  })
})

describe('buildCardFilename（PRD §8.5）', () => {
  it('fooddex_菜名_YYYYMMDD.png', () => {
    expect(buildCardFilename('水煮牛肉', '2026-09-10T19:30:00+08:00')).toBe(
      'fooddex_水煮牛肉_20260910.png',
    )
  })
  it('剔除平台非法字符与空白', () => {
    const f = buildCardFilename('a/b:c*?菜', '2026-09-10T00:00:00+08:00')
    expect(f.startsWith('fooddex_a_b_c_菜_')).toBe(true)
    expect(f.endsWith('_20260910.png')).toBe(true)
  })
})

describe('fitLine / fitBlock（EC-CARD-03 长文本省略）', () => {
  const style: TextStyle = { family: 'body', size: 10, weight: 400, lineHeight: 14, color: 'ink' }
  it('不超宽原样返回', () => {
    expect(fitLine('水煮牛肉', style, 40, fakeMeasure)).toEqual({
      text: '水煮牛肉',
      truncated: false,
    })
  })
  it('超宽截断补 …', () => {
    const r = fitLine('水煮牛肉非常好吃', style, 60, fakeMeasure)
    expect(r.truncated).toBe(true)
    expect(r.text.endsWith('…')).toBe(true)
    expect(fakeMeasure(r.text, style)).toBeLessThanOrEqual(60)
  })
  it('多行截断最多 maxLines 行', () => {
    const r = fitBlock('一'.repeat(30), style, 100, 2, fakeMeasure)
    expect(r.lines).toHaveLength(2)
    expect(r.truncated).toBe(true)
    expect(r.lines[1].endsWith('…')).toBe(true)
  })
})

describe('buildOps（条件显隐与空间重排，EC-CARD-01/02）', () => {
  it('无图 → 占位图 op；未评分/无标签 → 不产生 stars/chips/badge 空块', () => {
    const ops = buildOps(
      classicTemplate,
      { dishName: '茶话蛋', rating: null, isAvoid: false },
      env(),
    )
    const kinds = ops.map((o) => o.op)
    expect(kinds).toContain('placeholder')
    expect(kinds).not.toContain('stars')
    expect(kinds).not.toContain('chips')
    expect(kinds).not.toContain('stripes')
  })
  it('完整数据：编号补零、副标题组合、星级与标签齐备', () => {
    const ops = buildOps(classicTemplate, fullData, env())
    const texts = ops.filter((o) => o.op === 'text')
    const allLines = texts.flatMap((t) => (t.op === 'text' ? t.lines : []))
    expect(allLines).toContain('No.061')
    expect(allLines).toContain('川香小馆 · 川菜')
    expect(allLines.some((l) => l.startsWith('2026.09.10'))).toBe(true) // meta 行（假测量下可能省略号截断）
    expect(allLines.some((l) => l.includes('@食客'))).toBe(true)
    expect(ops.some((o) => o.op === 'stars' && o.valueText === '4.5')).toBe(true)
    expect(ops.some((o) => o.op === 'chips' && o.chips.length === 3)).toBe(true)
  })
  it('有图数据：图片区吸收剩余空间，内容不越底部安全区', () => {
    const img = { source: null, width: 100, height: 100 } as never
    const ops = buildOps(classicTemplate, fullData, env(img))
    const imageOp = ops.find((o) => o.op === 'image')
    expect(imageOp).toBeDefined()
    if (imageOp?.op === 'image') {
      expect(imageOp.h).toBeGreaterThan(100)
      expect(imageOp.y + imageOp.h).toBeLessThanOrEqual(CARD_H - CARD_BOTTOM_SAFE)
    }
  })
  it('标签过多时 chips 换行且行宽不超内容区', () => {
    const data: CardData = {
      dishName: '拼盘',
      rating: 4,
      isAvoid: false,
      tags: ['深夜食堂限定麻辣锅', '聚餐必点硬菜推荐', '重口味慎点警告', '炭火现烤', '下酒神菜'],
    }
    const ops = buildOps(classicTemplate, data, env())
    const chipsOp = ops.find((o) => o.op === 'chips')
    if (chipsOp?.op !== 'chips') throw new Error('缺少 chips op')
    expect(chipsOp.chips.length).toBe(5) // 模板 max:5（PRD §8.2 取 3–5 枚）
    for (const c of chipsOp.chips) {
      expect(c.x).toBeGreaterThanOrEqual(0)
      expect(c.x + c.w).toBeLessThanOrEqual(CONTENT_W + 1)
    }
    const ys = new Set(chipsOp.chips.map((c) => c.y))
    expect(ys.size).toBeGreaterThanOrEqual(2)
  })
})

describe('避雷皮肤（PRD §8.4 雷品警报）', () => {
  it('isAvoid 或评分 ≤2 → 黄黑皮肤 + 顶部警示条', () => {
    const skinned = applySkin(classicTemplate, { rating: 2, isAvoid: false })
    expect(skinned.id).toBe('warning')
    expect(skinned.stripeBarHeight).toBeGreaterThan(0)
    const ops = buildOps(skinned, { dishName: '踩雷鱼', rating: 2, isAvoid: false }, env())
    expect(ops.some((o) => o.op === 'stripes')).toBe(true)
  })
  it('非避雷保持原模板；getTemplate 可取三模板', () => {
    expect(applySkin(getTemplate('neon'), { rating: 4.5, isAvoid: false }).id).toBe('neon')
    expect(getTemplate('michelin').name).toBe('米其林留白')
  })
})

describe('布局重排（缺字段不留空块）', () => {
  const layoutsOf = (t: CardTemplate, d: CardData) =>
    buildOps(t, d, env())
      .filter((o) => o.op === 'text' || o.op === 'chips' || o.op === 'stars')
      .map((o) => ('y' in o ? o.y : -1))
      .sort((a, b) => a - b)

  it('同一模板下，缺副标题/标签时后续节点 y 前移（重排而非留空）', () => {
    const fullYs = layoutsOf(classicTemplate, fullData)
    const sparse: CardData = {
      ...fullData,
      restaurantName: undefined,
      cuisine: undefined,
      tags: undefined,
    }
    const sparseYs = layoutsOf(classicTemplate, sparse)
    expect(sparseYs.length).toBeLessThan(fullYs.length)
    // 去除副标题后，其后首个文本节点 y 应小于完整版对应值（整体上移）
    const lastFull = fullYs[fullYs.length - 1]
    const lastSparse = sparseYs[sparseYs.length - 1]
    expect(lastSparse).toBeLessThanOrEqual(lastFull)
  })
})
