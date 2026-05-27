import { config } from '@/lib/config'

// Thin client for the upstream wwebjs-api. Injects the single global key;
// callers never see it.
export async function wwebjsFetch(path: string, init: RequestInit = {}) {
  return fetch(`${config.wwebjsBaseUrl}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), 'x-api-key': config.wwebjsApiKey }
  })
}
