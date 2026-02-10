import sharp from 'sharp';

const MAX_DIMENSION = 2200;

export async function preprocessForOcr(input: Buffer): Promise<Buffer> {
  // Philosophy: favor readability, avoid aggressive transforms that can destroy text.
  // - auto-orient via EXIF
  // - flatten alpha to white
  // - downscale large images (no upscaling by default)
  // - normalize contrast and apply mild sharpening
  const img = sharp(input, { failOn: 'none' })
    .rotate()
    .flatten({ background: '#ffffff' });

  const meta = await img.metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  const maxSide = Math.max(width, height);

  const resized = (maxSide && maxSide > MAX_DIMENSION)
    ? img.resize({
        width: width >= height ? MAX_DIMENSION : undefined,
        height: height > width ? MAX_DIMENSION : undefined,
        fit: 'inside',
        withoutEnlargement: true,
        kernel: sharp.kernel.lanczos3,
      })
    : img;

  return await resized
    .normalise()
    .sharpen(0.8, 0.6)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}
