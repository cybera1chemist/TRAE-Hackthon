/**
 * 标签受控词表与近义归一映射（T1-06 / TDD §6）—— Agent-1
 *
 *  - 5 个受控维度：taste / cuisine / ingredient / cooking / scene；
 *  - 同义词 raw → canonical；未命中的自由标签归 custom 维度；
 *  - 词表为数据，供 Agent-2 prompt 下发（exportVocabForPrompt）与自定义标签复用；
 *  - 词表变更需 Agent-1 / Agent-2 共同评审。
 */
import type { TagDim } from '@/domain/entities'

export interface VocabEntry {
  canonical: string
  aliases: string[]
}

export const VOCAB: Record<Exclude<TagDim, 'custom'>, VocabEntry[]> = {
  taste: [
    { canonical: '清淡', aliases: ['清淡口', '不辣', '原味', '清鲜'] },
    { canonical: '微辣', aliases: ['有点辣', '稍辣', '微辣口'] },
    { canonical: '中辣', aliases: ['中辣口', '挺辣'] },
    { canonical: '麻辣', aliases: ['辣', '很辣', '特辣', '超辣', '麻辣口', '香辣'] },
    { canonical: '甜', aliases: ['甜味', '甜口', '甘甜'] },
    { canonical: '酸', aliases: ['酸味', '酸口', '酸爽'] },
    { canonical: '咸鲜', aliases: ['咸', '咸香', '咸鲜口'] },
    { canonical: '鲜香', aliases: ['鲜', '鲜味', '鲜美'] },
    { canonical: '苦', aliases: ['苦味', '苦口'] },
  ],
  cuisine: [
    { canonical: '川菜', aliases: ['四川菜', '川味'] },
    { canonical: '粤菜', aliases: ['广东菜', '粤式'] },
    { canonical: '湘菜', aliases: ['湖南菜', '湘味'] },
    { canonical: '鲁菜', aliases: ['山东菜'] },
    { canonical: '苏菜', aliases: ['江苏菜', '淮扬菜'] },
    { canonical: '浙菜', aliases: ['浙江菜'] },
    { canonical: '闽菜', aliases: ['福建菜'] },
    { canonical: '徽菜', aliases: ['安徽菜'] },
    { canonical: '日料', aliases: ['日本菜', '日式', '和食'] },
    { canonical: '韩餐', aliases: ['韩国菜', '韩式'] },
    { canonical: '西餐', aliases: ['西式', '欧美菜'] },
    { canonical: '东南亚', aliases: ['泰餐', '越南菜', '新加坡菜', '马来菜'] },
  ],
  ingredient: [
    { canonical: '牛肉', aliases: ['牛', '牛排', '牛腩'] },
    { canonical: '猪肉', aliases: ['猪', '五花肉', '排骨'] },
    { canonical: '鸡肉', aliases: ['鸡', '土鸡', '鸡胸'] },
    { canonical: '鱼', aliases: ['鱼类', '鱼肉', '海鱼'] },
    { canonical: '虾', aliases: ['虾仁', '大虾'] },
    { canonical: '豆腐', aliases: ['豆制品', '嫩豆腐', '老豆腐'] },
    { canonical: '蔬菜', aliases: ['青菜', '时蔬', '绿叶菜'] },
    { canonical: '面', aliases: ['面条', '面食'] },
    { canonical: '米饭', aliases: ['饭', '白饭', '米'] },
    { canonical: '蛋', aliases: ['鸡蛋', '蛋类'] },
  ],
  cooking: [
    { canonical: '炒', aliases: ['爆炒', '清炒', '生炒'] },
    { canonical: '煮', aliases: ['水煮', '白煮'] },
    { canonical: '蒸', aliases: ['清蒸', '干蒸'] },
    { canonical: '炸', aliases: ['油炸', '香炸', '酥炸'] },
    { canonical: '烤', aliases: ['烧烤', '烤制', '焗'] },
    { canonical: '炖', aliases: ['红烧', '焖', '煲'] },
    { canonical: '凉拌', aliases: ['凉菜', '拌'] },
    { canonical: '煎', aliases: ['香煎', '生煎'] },
  ],
  scene: [
    { canonical: '一人食', aliases: ['独自', '一个人'] },
    { canonical: '聚餐', aliases: ['聚会', '团建', '多人'] },
    { canonical: '约会', aliases: ['双人', '情侣'] },
    { canonical: '快餐', aliases: ['速食', '简餐'] },
    { canonical: '夜宵', aliases: ['宵夜', '深夜'] },
    { canonical: '早餐', aliases: ['早点', '早饭'] },
    { canonical: '下午茶', aliases: ['茶点', '下午茶点'] },
  ],
}

/** 构建 raw(lowercase) → canonical 的扁平查找表（含 canonical 自身） */
function buildAliasMap(entries: VocabEntry[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const e of entries) {
    map.set(e.canonical.toLowerCase(), e.canonical)
    for (const a of e.aliases) map.set(a.toLowerCase(), e.canonical)
  }
  return map
}

const ALIAS_MAPS: Record<Exclude<TagDim, 'custom'>, Map<string, string>> = {
  taste: buildAliasMap(VOCAB.taste),
  cuisine: buildAliasMap(VOCAB.cuisine),
  ingredient: buildAliasMap(VOCAB.ingredient),
  cooking: buildAliasMap(VOCAB.cooking),
  scene: buildAliasMap(VOCAB.scene),
}

export interface NormalizedTag {
  /** 命中后为受控维度；未命中统一归 custom */
  dim: TagDim
  /** 原始值 */
  value: string
  /** 归一化标准值（未命中则等于 value） */
  canonical: string
  inVocab: boolean
}

/** 归一化单个标签 */
export function normalizeTag(raw: string, dim: TagDim): NormalizedTag {
  const value = raw.trim()
  if (!value) return { dim, value: '', canonical: '', inVocab: false }
  if (dim === 'custom') return { dim, value, canonical: value, inVocab: false }

  const canonical = ALIAS_MAPS[dim].get(value.toLowerCase())
  if (canonical) return { dim, value, canonical, inVocab: true }
  return { dim: 'custom', value, canonical: value, inVocab: false }
}

/** 取某维度全部 canonical 词表 */
export function listCanonical(dim: Exclude<TagDim, 'custom'>): string[] {
  return VOCAB[dim].map((e) => e.canonical)
}

/** 导出完整词表（Agent-2 prompt 下发用） */
export function exportVocabForPrompt(): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const dim of Object.keys(VOCAB) as Array<Exclude<TagDim, 'custom'>>) {
    out[dim] = listCanonical(dim)
  }
  return out
}
