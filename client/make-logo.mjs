import sharp from 'sharp';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const userDownloadPath = 'C:/Users/UDAY_YADAV/Downloads/tgstore_first_logo.png';
const publicDir = resolve(__dirname, 'public');
const iconsDir = resolve(publicDir, 'icons');
const defaultLogoPath = resolve(publicDir, 'logo.png');

const inputPath = existsSync(userDownloadPath) ? userDownloadPath : defaultLogoPath;

async function run() {
  console.log('Reading source image from:', inputPath);

  // 1. Keep pristine full uncropped logo in public/logo.png
  if (inputPath !== defaultLogoPath) {
    copyFileSync(inputPath, defaultLogoPath);
  }

  const img = sharp(defaultLogoPath);
  const meta = await img.metadata();
  console.log(`Original dimensions: ${meta.width}x${meta.height}`);

  const raw = await img.raw().toBuffer({ resolveWithObject: true });
  const { data, info } = raw;
  const { width, height } = info;
  const channels = info.channels;

  // 2. Flood fill background to create transparent version WITHOUT cropping any part of logo
  const visited = new Uint8Array(width * height);
  const queue = [];

  function isBg(r, g, b) {
    // Light near-white / subtle-blue background
    return r >= 218 && g >= 225 && b >= 235;
  }

  // Queue 4 borders
  for (let x = 0; x < width; x++) {
    queue.push([x, 0], [x, height - 1]);
    visited[x] = 1;
    visited[(height - 1) * width + x] = 1;
  }
  for (let y = 0; y < height; y++) {
    queue.push([0, y], [width - 1, y]);
    visited[y * width] = 1;
    visited[y * width + width - 1] = 1;
  }

  let head = 0;
  while (head < queue.length) {
    const [x, y] = queue[head++];
    const idx = (y * width + x) * channels;
    const r = data[idx], g = data[idx + 1], b = data[idx + 2];

    if (!isBg(r, g, b)) continue;

    const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nIdx = ny * width + nx;
        if (!visited[nIdx]) {
          visited[nIdx] = 1;
          const p = nIdx * channels;
          if (isBg(data[p], data[p + 1], data[p + 2])) {
            queue.push([nx, ny]);
          }
        }
      }
    }
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const src = idx * channels;
      const dst = idx * 4;
      const r = data[src], g = data[src + 1], b = data[src + 2];

      if (visited[idx] && isBg(r, g, b)) {
        rgba[dst] = 0;
        rgba[dst + 1] = 0;
        rgba[dst + 2] = 0;
        rgba[dst + 3] = 0;
      } else {
        let isEdge = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const nIdx = ny * width + nx;
            if (visited[nIdx] && isBg(data[nIdx * channels], data[nIdx * channels + 1], data[nIdx * channels + 2])) {
              isEdge = true;
              break;
            }
          }
        }

        rgba[dst] = r;
        rgba[dst + 1] = g;
        rgba[dst + 2] = b;

        if (isEdge && r >= 210 && g >= 215 && b >= 225) {
          const avg = (r + g + b) / 3;
          const a = Math.max(0, Math.min(255, Math.round(255 - (avg - 210) * 5.5)));
          rgba[dst + 3] = a;
        } else {
          rgba[dst + 3] = 255;
        }
      }
    }
  }

  // 3. Save transparent logo mark - NO CROP, full uncropped aspect ratio
  const transparentLogoBuf = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(resolve(publicDir, 'logo-icon.png'), transparentLogoBuf);
  console.log('Saved public/logo-icon.png');

  // 4. Generate square PWA icons with comfortable centering & padding
  // Scale logo to fit inside 470x470 so all 3D curves and the folder stay fully visible
  const icon512 = await sharp(transparentLogoBuf)
    .resize(470, 470, { fit: 'inside' })
    .toBuffer()
    .then(b => sharp(b).resize(512, 512, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }).png({ compressionLevel: 9 }).toBuffer());

  writeFileSync(resolve(iconsDir, 'icon-512.png'), icon512);
  writeFileSync(resolve(iconsDir, 'icon-192.png'), await sharp(icon512).resize(192, 192).png().toBuffer());
  writeFileSync(resolve(iconsDir, 'apple-touch-icon.png'), await sharp(icon512).resize(180, 180).png().toBuffer());
  writeFileSync(resolve(iconsDir, 'favicon-32.png'), await sharp(icon512).resize(32, 32).png().toBuffer());

  const b64 = icon512.toString('base64');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <image href="data:image/png;base64,${b64}" width="512" height="512"/>
</svg>\n`;
  writeFileSync(resolve(iconsDir, 'icon.svg'), svg);

  console.log('All icons generated perfectly without cropping!');
}

run().catch(console.error);



