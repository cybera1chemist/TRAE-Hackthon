import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ToastProvider } from '@/ui'

/**
 * 全局 Provider（TDD §2.4 app/providers.tsx）：
 * TanStack Query（AI 请求缓存/重试/突变态）+ DS Toast。
 * 主题在 main.tsx 中先行初始化，不经 Provider。
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
})

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  )
}
