import { useEffect, useRef } from 'react'
import type * as EChartsNS from 'echarts'
import type { CloudTag } from '../stats/types'
import { loadEcharts } from './echartsLazy'

interface TagCloudChartProps {
  tags: CloudTag[]
  /** tooltip 口径说明（近 365 天等） */
  caption: string
  height?: number
  onTagClick?: (value: string) => void
}

/**
 * 口味标签云（T4-02 / PRD §5.4.1）：字号由云图权重决定，口味走语义色；
 * 点击标签下钻到图鉴标签视图。词频由 CloudTag.weight 给定（14 + sqrt(n)·k）。
 */
export function TagCloudChart({ tags, caption, height = 220, onTagClick }: TagCloudChartProps) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<EChartsNS.ECharts | null>(null)
  const tagsRef = useRef(tags)
  tagsRef.current = tags
  const clickRef = useRef(onTagClick)
  clickRef.current = onTagClick

  useEffect(() => {
    let disposed = false
    let ro: ResizeObserver | null = null
    void loadEcharts().then((echarts) => {
      if (disposed || !ref.current) return
      const chart = echarts.init(ref.current, undefined, { renderer: 'canvas' })
      chartRef.current = chart
      const series = {
        type: 'wordCloud',
        shape: 'circle',
        left: 'center',
        top: 10,
        width: '95%',
        height: '85%',
        sizeRange: [13, 30],
        rotationRange: [0, 0],
        gridSize: 8,
        drawOutOfBound: false,
        textStyle: { color: '#6B7075', fontFamily: 'sans-serif' },
        emphasis: { textStyle: { fontWeight: 'bold' as const } },
        data: tagsRef.current.map((t) => ({
          name: t.value,
          value: t.count,
          textStyle: t.color ? { color: t.color } : undefined,
        })),
      }
      chart.setOption({
        tooltip: {
          formatter: (p: unknown) => {
            const d = p as { name: string; value: number }
            return `${d.name}：${d.value} 次<br/><span style="color:#8A8F98">${caption}</span>`
          },
        },
        series: [series] as unknown as EChartsNS.SeriesOption[],
      })
      chart.on('click', (p: unknown) => {
        const name = (p as { name?: string }).name
        if (name) clickRef.current?.(name)
      })
      ro = new ResizeObserver(() => chart.resize())
      ro.observe(ref.current)
    })
    return () => {
      disposed = true
      ro?.disconnect()
      chartRef.current?.dispose()
      chartRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.setOption({
      series: [
        {
          data: tags.map((t) => ({
            name: t.value,
            value: t.count,
            textStyle: t.color ? { color: t.color } : undefined,
          })),
        },
      ] as unknown as EChartsNS.SeriesOption[],
    })
  }, [tags])

  return <div ref={ref} style={{ height }} role="img" aria-label={caption} />
}
