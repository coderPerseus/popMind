import { basename, extname } from 'node:path'
import { readFile } from 'node:fs/promises'

const GOOGLE_LENS_UPLOAD_URL = 'https://lens.google.com/v3/upload'

const MIME_TYPE_BY_EXT: Record<string, string> = {
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

export class GoogleLensService {
  async createSearchUrl(imagePath: string) {
    const fileBuffer = await readFile(imagePath)
    const fileName = basename(imagePath)
    const mimeType = MIME_TYPE_BY_EXT[extname(imagePath).toLowerCase()] ?? 'image/png'
    const formData = new FormData()

    formData.set('encoded_image', new Blob([fileBuffer], { type: mimeType }), fileName)
    formData.set('hl', 'zh-CN')

    const response = await fetch(GOOGLE_LENS_UPLOAD_URL, {
      method: 'POST',
      body: formData,
      redirect: 'follow',
      headers: {
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
      },
    })

    if (!response.ok && !isRedirectStatus(response.status)) {
      throw new Error(`Google Lens upload failed with status ${response.status}`)
    }

    const targetUrl = response.url
    if (!targetUrl || !targetUrl.startsWith('https://www.google.com/search?')) {
      throw new Error('Google Lens did not return a result URL')
    }

    return targetUrl
  }
}

const isRedirectStatus = (status: number) => status >= 300 && status < 400
