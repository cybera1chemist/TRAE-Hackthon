/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 冻结契约（分工文档 §2.3）：DS 组件导出清单。
 * Agent-3/4/5/6 一律从 `@/ui` 具名导入；新增组件只允许追加导出，不允许改名/删除。
 * Owner：Agent-0（foundation）。
 * ─────────────────────────────────────────────────────────────────────────────
 */

// 基础组件
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './Button'
export { LoadingButton, type LoadingButtonProps } from './LoadingButton'
export { Input, Textarea, type InputProps, type TextareaProps } from './Input'
export { Chip, type ChipProps, type ChipTone } from './Chip'
export { Empty, type EmptyProps } from './Empty'
export { Stars, type StarsProps } from './Stars'
export { Switch, type SwitchProps } from './Switch'

// 覆盖层组件
export { Dialog, type DialogProps } from './Dialog'
export { Sheet, type SheetProps } from './Sheet'
export { ToastProvider, useToast, type ToastOptions, type ToastVariant } from './Toast'

// 工具
export { cn } from './cn'
