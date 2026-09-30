// Minimal PNG header parsing so image sizes are known without decoding pixels.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export const parsePngSize = (data: Uint8Array): { width: number; height: number } | null => {
  if (data.length < 24) {
    return null
  }

  const buffer = Buffer.from(data.buffer, data.byteOffset, Math.min(data.length, 32))
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE) || buffer.toString('latin1', 12, 16) !== 'IHDR') {
    return null
  }

  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  return width > 0 && height > 0 ? { width, height } : null
}
