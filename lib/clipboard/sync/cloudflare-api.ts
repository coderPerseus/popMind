// Cloudflare REST calls used by the manual setup ("paste an R2 API token"). Pure apart from `fetch`.
const API = 'https://api.cloudflare.com/client/v4'

type ApiEnvelope<T> = { success: boolean; result: T; errors?: Array<{ code: number; message: string }> }

export class CloudflareApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly codes: number[] = []
  ) {
    super(message)
  }
}

const call = async <T>(token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> => {
  const response = await fetch(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token.trim()}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
  const envelope = (await response.json().catch(() => null)) as ApiEnvelope<T> | null
  if (!response.ok || !envelope?.success) {
    const errors = envelope?.errors ?? []
    throw new CloudflareApiError(
      errors.map((error) => `${error.code} ${error.message}`).join('; ') || `HTTP ${response.status}`,
      response.status,
      errors.map((error) => error.code)
    )
  }
  return envelope.result
}

/** Token id (= R2 access key id). Account-owned tokens verify under the account, user tokens under /user. */
export const verifyToken = async (token: string, accountId: string): Promise<string> => {
  try {
    return (await call<{ id: string; status: string }>(token, `/accounts/${accountId}/tokens/verify`)).id
  } catch (accountError) {
    try {
      return (await call<{ id: string; status: string }>(token, '/user/tokens/verify')).id
    } catch {
      throw accountError
    }
  }
}

/** The only account the token can see, or null when there are none / several. */
export const detectAccountId = async (token: string): Promise<string | null> => {
  try {
    const accounts = await call<Array<{ id: string }>>(token, '/accounts')
    return accounts.length === 1 ? accounts[0].id : null
  } catch {
    return null
  }
}

/** Creates the bucket unless it already exists. */
export const ensureBucket = async (token: string, accountId: string, bucket: string) => {
  try {
    await call(token, `/accounts/${accountId}/r2/buckets/${bucket}`)
    return 'existing' as const
  } catch (error) {
    if (!(error instanceof CloudflareApiError) || error.status !== 404) throw error
  }
  await call(token, `/accounts/${accountId}/r2/buckets`, { method: 'POST', body: { name: bucket } })
  return 'created' as const
}
