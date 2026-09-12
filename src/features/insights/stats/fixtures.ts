/**
 * Agent-5 开发/测试夹具（T1-10/T4-01/T4-03 联调使用）。
 * 仅依赖冻结实体类型；在 Agent-1 Dexie 落地前，供图鉴三视图、洞察页、
 * 避雷库组件基于内存快照开发（可灌入 InMemoryDb 或直接喂统计纯函数）。
 * 数据集口径固定在 2026-09-12，含：365 天窗口外数据、多标签、无菜系、
 * 低分避雷与仅手动避雷、灰菜（locked）等边界。
 */
import type { Dish, ID, Log, Restaurant, SyncState, Tag, TagDim } from '@/domain/entities'

const DEFAULT_NOW = new Date('2026-09-12T12:00:00+08:00')
const DAY_MS = 86_400_000

let seq = 0
const uid = (prefix: string): ID => `${prefix}_fx${(++seq).toString(36)}`

const TS = '2026-01-01T12:00:00.000Z'

export function makeTag(dim: TagDim, value: string, source: Tag['source'] = 'ai'): Tag {
  return source === 'ai' ? { dim, value, source, confidence: 0.9 } : { dim, value, source }
}

type DishSeed = Partial<Dish> & Pick<Dish, 'restaurantId' | 'name'>

export function makeDish(seed: DishSeed): Dish {
  return {
    id: seed.id ?? uid('dsh'),
    restaurantId: seed.restaurantId,
    name: seed.name,
    nameSource: seed.nameSource ?? 'ocr',
    aiSuggestedName: seed.aiSuggestedName,
    canonicalDishId: seed.canonicalDishId,
    section: seed.section,
    aliases: seed.aliases ?? [],
    prices: seed.prices ?? [],
    status: seed.status ?? 'locked',
    isAvoid: seed.isAvoid ?? false,
    unlockedAt: seed.unlockedAt,
    firstLogId: seed.firstLogId,
    stats: seed.stats ?? { logCount: 0, avgRating: null, latestRating: null },
    tags: seed.tags ?? [],
    createdAt: seed.createdAt ?? TS,
    updatedAt: seed.updatedAt ?? TS,
  }
}

type LogSeed = Partial<Log> & Pick<Log, 'dishId' | 'restaurantId' | 'ateAt'>

export function makeLog(seed: LogSeed): Log {
  return {
    id: seed.id ?? uid('log'),
    dishId: seed.dishId,
    restaurantId: seed.restaurantId,
    canonicalDishId: seed.canonicalDishId,
    rating: seed.rating ?? null,
    manualAvoid: seed.manualAvoid ?? false,
    comment: seed.comment ?? '',
    price: seed.price ?? null,
    scene: seed.scene,
    ateAt: seed.ateAt,
    photoIds: seed.photoIds ?? [],
    aiSnapshot: seed.aiSnapshot,
    tagExtractionState: seed.tagExtractionState ?? 'done',
    createdAt: seed.createdAt ?? seed.ateAt,
    updatedAt: seed.updatedAt ?? seed.ateAt,
  }
}

type RestaurantSeed = Partial<Restaurant> & Pick<Restaurant, 'name'>

export function makeRestaurant(
  seed: RestaurantSeed,
  dishes: Dish[] = [],
  logs: Log[] = [],
): Restaurant {
  const id = seed.id ?? uid('rst')
  const rated = logs.filter((l) => l.rating !== null)
  const stats = {
    dishTotal: dishes.length,
    unlockedCount: dishes.filter((d) => d.status === 'unlocked').length,
    avoidCount: dishes.filter((d) => d.isAvoid).length,
    avgRating:
      rated.length === 0
        ? null
        : Math.round((rated.reduce((s, l) => s + (l.rating ?? 0), 0) / rated.length) * 10) / 10,
    logCount: logs.length,
  }
  return {
    id,
    name: seed.name,
    aliases: seed.aliases ?? [],
    city: seed.city,
    district: seed.district,
    address: seed.address,
    coverPhotoId: seed.coverPhotoId,
    dishIds: dishes.map((d) => d.id),
    stats,
    createdAt: seed.createdAt ?? TS,
    updatedAt: seed.updatedAt ?? TS,
    syncState: 'local_only' as SyncState,
  }
}

export interface DemoDataset {
  now: Date
  restaurants: Restaurant[]
  dishes: Dish[]
  logs: Log[]
}

/** 相对锚点日期 n 天前 19:00 的 ISO 字符串 */
export function daysAgoISO(now: Date, days: number, hour = 19): string {
  const d = new Date(now.getTime() - days * DAY_MS)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}

/**
 * 固定故事数据集（锚点 2026-09-12）：
 * - r1 川香小馆 6 道菜（含 1 道低分避雷、1 道仅手动避雷、1 道灰菜）
 * - r2 樱寿司 3 道菜（含 365 天窗口外打卡、无主菜系菜品）
 * - 近 3 天连续打卡（streak=3），近 7 天新解锁 3 道
 */
export function buildDemoDataset(now: Date = DEFAULT_NOW): DemoDataset {
  const r1: Restaurant = { ...makeRestaurant({ name: '川香小馆（大学城店）', city: '广州' }) }
  const r2: Restaurant = { ...makeRestaurant({ name: '樱寿司', city: '广州' }) }

  const d1 = makeDish({
    id: 'dsh_fx_shuizhu',
    restaurantId: r1.id,
    name: '水煮牛肉',
    section: '招牌菜',
    status: 'unlocked',
    unlockedAt: daysAgoISO(now, 100),
    prices: [{ spec: '例', price: 58 }],
    tags: [makeTag('taste', '麻辣'), makeTag('taste', '香辣'), makeTag('cuisine', '川菜')],
  })
  const d2 = makeDish({
    id: 'dsh_fx_gongbao',
    restaurantId: r1.id,
    name: '宫保鸡丁',
    section: '招牌菜',
    status: 'unlocked',
    unlockedAt: daysAgoISO(now, 2),
    prices: [{ price: 32 }],
    tags: [makeTag('taste', '甜辣'), makeTag('cuisine', '川菜')],
  })
  const d3 = makeDish({
    id: 'dsh_fx_xilanhua',
    restaurantId: r1.id,
    name: '蒜蓉西兰花',
    section: '素菜',
    status: 'unlocked',
    unlockedAt: daysAgoISO(now, 3),
    prices: [{ price: 22 }],
    tags: [makeTag('taste', '清淡'), makeTag('taste', '蒜香'), makeTag('cuisine', '川菜')],
  })
  const d4 = makeDish({
    id: 'dsh_fx_kugua',
    restaurantId: r1.id,
    name: '苦瓜炒蛋',
    section: '素菜',
    status: 'unlocked',
    isAvoid: true,
    unlockedAt: daysAgoISO(now, 30),
    tags: [makeTag('cuisine', '川菜')],
  })
  const d5 = makeDish({
    id: 'dsh_fx_huicai',
    restaurantId: r1.id,
    name: '鱼香肉丝',
    section: '招牌菜',
    prices: [{ price: 30 }],
    tags: [makeTag('cuisine', '川菜')],
  })
  const d6 = makeDish({
    id: 'dsh_fx_paigu',
    restaurantId: r1.id,
    name: '秘制糖醋排骨',
    section: '招牌菜',
    status: 'unlocked',
    isAvoid: true,
    unlockedAt: daysAgoISO(now, 60),
    tags: [makeTag('cuisine', '川菜')],
  })
  const d7 = makeDish({
    id: 'dsh_fx_ciShen',
    restaurantId: r2.id,
    name: '三文鱼刺身',
    section: '刺身',
    status: 'unlocked',
    unlockedAt: daysAgoISO(now, 200),
    prices: [{ price: 68 }],
    tags: [makeTag('taste', '清淡'), makeTag('cuisine', '日料'), makeTag('ingredient', '海鲜')],
  })
  const d8 = makeDish({
    id: 'dsh_fx_egan',
    restaurantId: r2.id,
    name: '鹅肝寿司',
    section: '寿司',
    status: 'unlocked',
    unlockedAt: daysAgoISO(now, 400),
    tags: [makeTag('cuisine', '日料')],
  })
  const d9 = makeDish({
    id: 'dsh_fx_chaofan',
    restaurantId: r2.id,
    name: '蛋炒饭',
    section: '主食',
    status: 'unlocked',
    unlockedAt: daysAgoISO(now, 5),
    tags: [makeTag('taste', '咸鲜')],
  })

  const dishes = [d1, d2, d3, d4, d5, d6, d7, d8, d9]

  const logs = [
    makeLog({
      dishId: d1.id,
      restaurantId: r1.id,
      ateAt: daysAgoISO(now, 1),
      rating: 5,
      comment: '还是那么香',
    }),
    makeLog({ dishId: d1.id, restaurantId: r1.id, ateAt: daysAgoISO(now, 100), rating: 4.5 }),
    makeLog({ dishId: d2.id, restaurantId: r1.id, ateAt: daysAgoISO(now, 2), rating: 4 }),
    makeLog({ dishId: d3.id, restaurantId: r1.id, ateAt: daysAgoISO(now, 3), rating: 4 }),
    makeLog({
      dishId: d4.id,
      restaurantId: r1.id,
      ateAt: daysAgoISO(now, 30),
      rating: 1,
      comment: '太苦了完全没法吃',
      manualAvoid: true,
    }),
    makeLog({
      dishId: d6.id,
      restaurantId: r1.id,
      ateAt: daysAgoISO(now, 60),
      rating: 4,
      comment: '还行，但太甜，手动避雷',
      manualAvoid: true,
    }),
    makeLog({ dishId: d7.id, restaurantId: r2.id, ateAt: daysAgoISO(now, 200), rating: 4.5 }),
    // 365 天窗口外：计入累计/店铺均分，不计入占比与云图
    makeLog({ dishId: d8.id, restaurantId: r2.id, ateAt: daysAgoISO(now, 400), rating: 5 }),
    // 无主菜系：计入 unclassifiedCuisineCount
    makeLog({ dishId: d9.id, restaurantId: r2.id, ateAt: daysAgoISO(now, 5), rating: 3.5 }),
  ]

  // 回填派生字段，模拟 Agent-1 recomputeDerived 后的快照形态
  for (const dish of dishes) {
    const dishLogs = logs.filter((l) => l.dishId === dish.id)
    const rated = dishLogs.filter((l) => l.rating !== null)
    dish.stats = {
      logCount: dishLogs.length,
      avgRating:
        rated.length === 0
          ? null
          : Math.round((rated.reduce((s, l) => s + (l.rating ?? 0), 0) / rated.length) * 10) / 10,
      latestRating: dishLogs.at(-1)?.rating ?? null,
      latestLogAt: dishLogs.at(-1)?.ateAt,
    }
    dish.firstLogId = dishLogs[0]?.id
  }

  const r1Dishes = dishes.filter((d) => d.restaurantId === r1.id)
  const r2Dishes = dishes.filter((d) => d.restaurantId === r2.id)
  const restaurants = [
    makeRestaurant(
      { ...r1 },
      r1Dishes,
      logs.filter((l) => l.restaurantId === r1.id),
    ),
    makeRestaurant(
      { ...r2 },
      r2Dishes,
      logs.filter((l) => l.restaurantId === r2.id),
    ),
  ]

  return { now, restaurants, dishes, logs }
}
