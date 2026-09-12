import { useEffect, useRef, useState } from 'react'
import type * as EChartsNS from 'echarts'
import { loadEcharts } from './echartsLazy'

export interface DonutDatum {
  value: string
  count: number
  color?: string
}

interface DonutChartProps {
  /** tooltip 口径说明（PRD：口径必须在图表上明示） */
  caption: string
  items: DonutDatum[]
  centerLabel?: string
  height?: number
  /** 点击扇区下钻（如跳转图鉴标签筛选） */
  onItemClick?: (value: string) => void
}

/**
 * 环形占比图（T4-02）：分母 0（items 为空）时由调用方渲染「—」空态，
 * 本组件不伪造 100% 圆环。tooltip 显式给出条数/占比与口径说明。
 */
export function DonutChart({
  items,
  caption,
  centerLabel,
  height = 240,
  onItemClick,
}: DonutChartProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const chartRef = useRef<EChartsNS.ECharts | null>(null)
  const itemsRef = useRef(items)
  const captionRef = useRef(caption)
  const clickRef = useRef(onItemClick)
  itemsRef.current = items
  captionRef.current = caption
  clickRef.current = onItemClick

  useEffect(() => {
    let disposed = false
    let ro: ResizeObserver | null = null
    void loadEcharts().then((echarts) => {
      if (disposed || !ref.current) return
      const chart = echarts.init(ref.current, undefined, { renderer: 'canvas' })
      chartRef.current = chart
      const total = itemsRef.current.reduce((s, x) => s + x.count, 0)
      chart.setOption({
        tooltip: {
          trigger: 'item',
          formatter: (p: unknown) => {
            const d = p as { name: string; value: number; percent: number }
            return `${d.name}：${d.value} 条（${d.percent}%）<br/><span style="color:#8A8F98">${captionRef.current}</span>`
          },
        },
        legend: {
          type: 'scroll',
          bottom: 0,
          left: 'center',
          textStyle: { color: '#8A8F98', fontSize: 11 },
        },
        title: {
          text: String(total),
          subtext: centerLabel ?? '',
          left: 'center',
          top: '32%',
          textStyle: { color: '#16171A', fontSize: 22, fontWeight: 700 },
          subtextStyle: { color: '#8A8F98', fontSize: 11 },
        },
        series: [
          {
            type: 'pie',
            radius: ['52%', '72%'],
            center: ['50%', '42%'],
            avoidLabelOverlap: true,
            label: { show: false },
            labelLine: { show: false },
            data: itemsRef.current.map((x) => ({
              name: x.value,
              value: x.count,
              itemStyle: x.color ? { color: x.color } : undefined,
            })),
          },
        ],
      })
      chart.on('click', (p: unknown) => {
        const name = (p as { name?: string }).name
        if (name) clickRef.current?.(name)
      })
      ro = new ResizeObserver(() => chart.resize())
      ro.observe(ref.current)
      setReady(true)
    })
    return () => {
      disposed = true
      ro?.disconnect()
      chartRef.current?.dispose()
      chartRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 数据变化时更新（不重新 init）
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !ready) return
    const total = items.reduce((s, x) => s + x.count, 0)
    chart.setOption({
      title: { text: String(total) },
      series: [
        {
          data: items.map((x) => ({
            name: x.value,
            value: x.count,
            itemStyle: x.color ? { color: x.color } : undefined,
          })),
        },
      ],
    })
  }, [items, ready])

  return <div ref={ref} style={{ height }} role="img" aria-label={caption} />
}
