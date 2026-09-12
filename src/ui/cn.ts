import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** 类名合并工具：clsx + tailwind-merge（DS 组件内部消费） */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
