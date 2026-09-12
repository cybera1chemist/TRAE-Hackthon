/**
 * ECharts 懒加载（T4-02 / T5-01 分包）：洞察页首次渲染图表时才拉取
 * echarts + echarts-wordcloud chunk，不阻塞图鉴/打卡主链路。
 */
import type * as EChartsNS from 'echarts'

let promise: Promise<typeof EChartsNS> | null = null

export function loadEcharts(): Promise<typeof EChartsNS> {
  if (!promise) {
    promise = Promise.all([import('echarts'), import('echarts-wordcloud')]).then(
      ([echarts]) => echarts,
    )
  }
  return promise
}
