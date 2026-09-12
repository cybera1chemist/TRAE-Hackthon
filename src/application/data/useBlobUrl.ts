import { useEffect, useState } from 'react'
import { getDataLayer } from './dataLayer'

/**
 * 解析 BlobStore 中的图片为可渲染的 object URL（T1-11）。
 * 自动随 key 变化 / 组件卸载 revoke，避免虚拟滚动下 URL 泄漏。
 */
export function useBlobUrl(blobKey: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let revoked = false
    let created: string | null = null
    if (!blobKey) {
      setUrl(null)
      return
    }
    void getDataLayer().then(async (layer) => {
      const blob = await layer.blobStore.get(blobKey)
      if (!blob || revoked) return
      created = URL.createObjectURL(blob)
      setUrl(created)
    })
    return () => {
      revoked = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [blobKey])

  return url
}
