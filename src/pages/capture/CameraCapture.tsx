import { useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, RefreshCw } from 'lucide-react'
import { Button } from '@/ui'

export interface CameraCaptureProps {
  /** 快门产出（JPEG File） */
  onCapture: (file: File) => void
  onClose: () => void
}

type CameraState = 'starting' | 'ready' | 'denied' | 'unavailable'

/**
 * 相机取景（T2-07）：getUserMedia 环境摄像头 + 快门出图。
 * 非 HTTPS / 无摄像头 / 用户拒绝授权 → 降级提示，页面侧回落到相册上传（EC-CAP-01/02）。
 */
export function CameraCapture({ onCapture, onClose }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [state, setState] = useState<CameraState>('starting')
  const [startToken, setStartToken] = useState(0)

  useEffect(() => {
    let cancelled = false

    const start = async () => {
      setState('starting')
      if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setState('unavailable')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1440 } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => undefined)
        }
        setState('ready')
      } catch (e) {
        if (!cancelled)
          setState((e as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'unavailable')
      }
    }

    void start()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [startToken])

  const shoot = () => {
    const video = videoRef.current
    if (!video || video.videoWidth === 0) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    canvas.toBlob(
      (blob) => {
        if (!blob) return
        onCapture(new File([blob], `cam-${Date.now()}.jpg`, { type: 'image/jpeg' }))
      },
      'image/jpeg',
      0.92,
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <video
        ref={videoRef}
        playsInline
        muted
        className={state === 'ready' ? 'h-full w-full object-contain' : 'hidden'}
      />

      {state !== 'ready' && (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-white/80">
          <CameraOff className="h-10 w-10" aria-hidden />
          {state === 'starting' && <p>正在启动相机…</p>}
          {state === 'denied' && <p>相机权限被拒绝，请关闭后使用相册上传</p>}
          {state === 'unavailable' && (
            <p>
              当前环境无法使用相机
              <br />
              <span className="text-sm opacity-70">
                （需要 HTTPS 与摄像头权限，可改用相册上传）
              </span>
            </p>
          )}
        </div>
      )}

      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4">
        <Button variant="secondary" onClick={onClose} className="bg-black/50 text-white">
          关闭
        </Button>
        {state !== 'starting' && (
          <Button
            variant="secondary"
            aria-label="重试相机"
            className="bg-black/50 text-white"
            onClick={() => setStartToken((n) => n + 1)}
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>

      {state === 'ready' && (
        <div className="absolute inset-x-0 bottom-0 flex justify-center p-6">
          <button
            type="button"
            aria-label="拍摄"
            onClick={shoot}
            className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white/80 bg-white/20 text-white active:scale-95"
          >
            <Camera className="h-7 w-7" aria-hidden />
          </button>
        </div>
      )}
    </div>
  )
}
