import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'

export interface ApiState<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

/** Small data-fetch hook with loading / error states and manual reload. */
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[] = []): ApiState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const mounted = useRef(true)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    mounted.current = true
    setLoading(true)
    setError(null)
    fetcher()
      .then((result) => {
        if (mounted.current) setData(result)
      })
      .catch((err: unknown) => {
        if (!mounted.current) return
        setError(err instanceof ApiError ? err.message : String(err))
      })
      .finally(() => {
        if (mounted.current) setLoading(false)
      })
    return () => {
      mounted.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  return { data, loading, error, reload }
}
