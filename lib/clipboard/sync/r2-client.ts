// Minimal Cloudflare R2 client over the S3 API with AWS Signature V4 (no AWS SDK). Pure apart from `fetch`.
import { createHash, createHmac } from 'node:crypto'
import type { SyncCredentials } from '@/lib/clipboard/sync/sync-key'

export type R2Object = { key: string; lastModified: number; size: number }

export class R2Error extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message)
  }
}

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: Buffer }
) => Promise<{
  status: number
  ok: boolean
  arrayBuffer(): Promise<ArrayBuffer>
  text(): Promise<string>
}>

const REGION = 'auto'
const MAX_RETRIES = 3
const RETRY_BASE_MS = 400

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const SERVICE = 's3'
const EMPTY_HASH = createHash('sha256').update('').digest('hex')

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest()

/** RFC 3986 encoding as SigV4 requires (`encodeURIComponent` leaves !'()* alone). */
const encodeRfc3986 = (value: string) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)

const xmlValues = (xml: string, tag: string) =>
  [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((match) => decodeXml(match[1]))

const decodeXml = (value: string) =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

export class R2Client {
  private readonly host: string

  constructor(
    private readonly credentials: Pick<SyncCredentials, 'accountId' | 'bucket' | 'accessKeyId' | 'secretAccessKey'>,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly now: () => Date = () => new Date()
  ) {
    this.host = `${credentials.accountId}.r2.cloudflarestorage.com`
  }

  /** Retries dropped connections, throttling and server errors (flaky links to R2 are common). */
  private async request(method: string, key: string, query: Record<string, string> = {}, body?: Buffer) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await this.send(method, key, query, body)
        if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
          await sleep(RETRY_BASE_MS * 2 ** attempt)
          continue
        }
        return response
      } catch (error) {
        if (attempt >= MAX_RETRIES) throw error
        await sleep(RETRY_BASE_MS * 2 ** attempt)
      }
    }
  }

  private async send(method: string, key: string, query: Record<string, string> = {}, body?: Buffer) {
    const date = this.now()
      .toISOString()
      .replace(/[:-]|\.\d{3}/g, '')
    const day = date.slice(0, 8)
    const path = `/${encodeRfc3986(this.credentials.bucket)}${key ? `/${key.split('/').map(encodeRfc3986).join('/')}` : ''}`
    const canonicalQuery = Object.keys(query)
      .sort()
      .map((name) => `${encodeRfc3986(name)}=${encodeRfc3986(query[name])}`)
      .join('&')
    const payloadHash = body ? sha256(body) : EMPTY_HASH
    const headers: Record<string, string> = {
      host: this.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': date,
    }
    const signedHeaders = Object.keys(headers).sort().join(';')
    const canonicalHeaders = Object.keys(headers)
      .sort()
      .map((name) => `${name}:${headers[name]}\n`)
      .join('')
    const canonicalRequest = [method, path, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n')
    const scope = `${day}/${REGION}/${SERVICE}/aws4_request`
    const stringToSign = ['AWS4-HMAC-SHA256', date, scope, sha256(canonicalRequest)].join('\n')
    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${this.credentials.secretAccessKey}`, day), REGION), SERVICE),
      'aws4_request'
    )
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')

    const { host: _host, ...sendHeaders } = headers
    const response = await this.fetchImpl(`https://${this.host}${path}${canonicalQuery ? `?${canonicalQuery}` : ''}`, {
      method,
      headers: {
        ...sendHeaders,
        authorization: `AWS4-HMAC-SHA256 Credential=${this.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        ...(body ? { 'content-type': 'application/octet-stream' } : {}),
      },
      body,
    })
    return response
  }

  private async fail(response: Awaited<ReturnType<FetchLike>>, action: string): Promise<never> {
    const text = await response.text().catch(() => '')
    const code = xmlValues(text, 'Code')[0]
    const message = xmlValues(text, 'Message')[0]
    throw new R2Error(
      `${action} failed: ${response.status} ${code ?? ''} ${message ?? ''}`.trim(),
      response.status,
      code
    )
  }

  /** One page of ListObjectsV2. */
  async listPage(prefix: string, continuationToken?: string) {
    const query: Record<string, string> = { 'list-type': '2', prefix, 'max-keys': '1000' }
    if (continuationToken) query['continuation-token'] = continuationToken
    const response = await this.request('GET', '', query)
    if (!response.ok) await this.fail(response, 'list')

    const xml = await response.text()
    const objects: R2Object[] = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((match) => ({
      key: xmlValues(match[1], 'Key')[0] ?? '',
      lastModified: Date.parse(xmlValues(match[1], 'LastModified')[0] ?? '') || 0,
      size: Number(xmlValues(match[1], 'Size')[0] ?? 0),
    }))
    const truncated = xmlValues(xml, 'IsTruncated')[0] === 'true'
    return { objects, next: truncated ? xmlValues(xml, 'NextContinuationToken')[0] : undefined }
  }

  async listAll(prefix: string): Promise<R2Object[]> {
    const all: R2Object[] = []
    let token: string | undefined
    do {
      const page = await this.listPage(prefix, token)
      all.push(...page.objects)
      token = page.next
    } while (token)
    return all
  }

  /** Returns null when the object does not exist. */
  async get(key: string): Promise<Buffer | null> {
    const response = await this.request('GET', key)
    if (response.status === 404) {
      const text = await response.text().catch(() => '')
      if (xmlValues(text, 'Code')[0] === 'NoSuchBucket') throw new R2Error('bucket missing', 404, 'NoSuchBucket')
      return null
    }
    if (!response.ok) await this.fail(response, 'get')
    return Buffer.from(await response.arrayBuffer())
  }

  async put(key: string, body: Buffer): Promise<void> {
    const response = await this.request('PUT', key, {}, body)
    if (!response.ok) await this.fail(response, 'put')
  }
}
