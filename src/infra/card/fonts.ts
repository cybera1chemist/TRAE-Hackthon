/**
 * 出片字体保障（EC-CARD-05）：渲染前确保标题/正文两族 Web Font 加载完毕。
 * 字体文件（public/fonts/ 子集化可商用字体）由 T5-07 NFR 收口时落地；
 * 未落地时 load() 对缺失字族静默解析为空集，回退系统字体，不阻塞出片。
 */

export const CARD_FONT_FAMILIES = {
  title: '"FoodDex Display"',
  body: '"FoodDex Body"',
} as const

/** 探测用样张：覆盖常用汉字区 + 拉丁/数字/标点 */
const PROBE_TEXT = '美食图鉴No.061★☆·！？，。--— FOODDEX 0123456789'

export type CardFontStatus = 'ready' | 'unavailable' | 'timeout'

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    p.then((v) => {
      clearTimeout(timer)
      resolve(v)
    }).catch(() => {
      clearTimeout(timer)
      resolve(fallback)
    })
  })
}

/**
 * 等待出片字体就绪。非浏览器环境（单测/SSR）返回 'unavailable'，渲染器据此跳过。
 */
export async function ensureCardFonts(timeoutMs = 3000): Promise<CardFontStatus> {
  if (typeof document === 'undefined' || document.fonts === undefined) return 'unavailable'
  const loads = [
    document.fonts.load(`900 48px ${CARD_FONT_FAMILIES.title}`, PROBE_TEXT),
    document.fonts.load(`700 48px ${CARD_FONT_FAMILIES.title}`, PROBE_TEXT),
    document.fonts.load(`400 28px ${CARD_FONT_FAMILIES.body}`, PROBE_TEXT),
    document.fonts.load(`600 28px ${CARD_FONT_FAMILIES.body}`, PROBE_TEXT),
  ]
  const settled = await withTimeout(Promise.all(loads), timeoutMs, null)
  if (settled === null) return 'timeout'
  await withTimeout(document.fonts.ready, timeoutMs, undefined)
  return 'ready'
}
