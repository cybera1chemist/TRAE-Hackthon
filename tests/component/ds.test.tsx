import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button, Chip, Empty, LoadingButton, Stars } from '@/ui'

afterEach(cleanup)

describe('DS Button', () => {
  it('渲染并响应点击', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>开始识别</Button>)
    await userEvent.click(screen.getByRole('button', { name: '开始识别' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('disabled 时不响应点击', async () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        保存
      </Button>,
    )
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('LoadingButton 加载中禁用并显示 busy', () => {
    render(<LoadingButton loading>保存中</LoadingButton>)
    const btn = screen.getByRole('button', { name: '保存中' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'true')
  })
})

describe('DS Stars（半星）', () => {
  it('半星渲染 aria 值正确，可键盘步进 0.5', async () => {
    const onChange = vi.fn()
    render(<Stars value={3.5} onChange={onChange} />)
    const slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('aria-valuenow', '3.5')
    slider.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenCalledWith(4)
    await userEvent.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenCalledWith(3)
  })

  it('只读模式无 slider 语义', () => {
    render(<Stars value={5} />)
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: '评分 5 / 5' })).toBeInTheDocument()
  })
})

describe('DS Chip / Empty', () => {
  it('Chip 选中态与删除按钮', async () => {
    const onRemove = vi.fn()
    render(
      <Chip selected onRemove={onRemove}>
        麻辣
      </Chip>,
    )
    expect(screen.getByText('麻辣')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '删除标签' }))
    expect(onRemove).toHaveBeenCalledOnce()
  })

  it('Empty 展示标题与描述', () => {
    render(<Empty title="图鉴空空如也" description="去打卡第一道菜吧" />)
    expect(screen.getByText('图鉴空空如也')).toBeInTheDocument()
    expect(screen.getByText(/去打卡第一道菜吧/)).toBeInTheDocument()
  })
})
