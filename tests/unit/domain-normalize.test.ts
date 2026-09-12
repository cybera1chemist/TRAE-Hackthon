import { describe, expect, it } from 'vitest'
import { compareKeys, normalizeDishName } from '@/domain/services/normalize'

describe('normalizeDishName（TDD §3.4）', () => {
  it('NFKC + 全角转半角', () => {
    expect(normalizeDishName('ＡＢＣ').name).toBe('ABC')
  })

  it('去除尾部 / 与括号规格', () => {
    expect(normalizeDishName('黑椒牛柳/例').name).toBe('黑椒牛柳')
    expect(normalizeDishName('黑椒牛柳／大份').name).toBe('黑椒牛柳')
    expect(normalizeDishName('米饭(大)').name).toBe('米饭')
    expect(normalizeDishName('米饭（中）').name).toBe('米饭')
  })

  it('去除价格残留', () => {
    expect(normalizeDishName('宫保鸡丁 38').name).toBe('宫保鸡丁')
    expect(normalizeDishName('宫保鸡丁￥38.5').name).toBe('宫保鸡丁')
    expect(normalizeDishName('$12.5 沙拉').name).toBe('沙拉')
  })

  it('去除连续装饰符号', () => {
    expect(normalizeDishName('★★招牌牛肉★★').name).toBe('招牌牛肉')
  })

  it('括号内容拆为 aliases，主名保留', () => {
    const r = normalizeDishName('黑椒牛柳（辣）')
    expect(r.name).toBe('黑椒牛柳')
    expect(r.aliases).toContain('辣')
  })

  it('多重括号全部拆出', () => {
    const r = normalizeDishName('水煮鱼(辣)[招牌]')
    expect(r.name).toBe('水煮鱼')
    expect(r.aliases).toEqual(expect.arrayContaining(['辣', '招牌']))
  })

  it('空白压缩，保留英文显示大小写', () => {
    expect(normalizeDishName('  宫保   鸡丁  ').name).toBe('宫保 鸡丁')
    expect(normalizeDishName('KFC 全家桶').name).toBe('KFC 全家桶')
  })

  it('空输入安全', () => {
    expect(normalizeDishName('')).toEqual({ name: '', aliases: [] })
  })

  it('compareKeys 英文小写化用于比较', () => {
    expect(compareKeys('KFC 全家桶')).toContain('kfc 全家桶')
  })
})
