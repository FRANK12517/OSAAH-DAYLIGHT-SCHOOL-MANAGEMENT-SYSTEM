const MAX_SIDE = 2400;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This browser could not decode the selected image. Try PNG, JPEG, WebP, or BMP.')); };
    image.src = url;
  });
}

export async function processSignatureImage(file) {
  if (!file || !String(file.type || '').startsWith('image/')) throw new Error('Choose an image file for the signature.');
  const image = await loadImage(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const source = document.createElement('canvas'); source.width = width; source.height = height;
  const sourceContext = source.getContext('2d', { willReadFrequently: true }); sourceContext.drawImage(image, 0, 0, width, height);
  const frame = sourceContext.getImageData(0, 0, width, height), pixels = frame.data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const luminance = .2126 * r + .7152 * g + .0722 * b;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    // Retain colored ink and dark strokes. Fade bright, low-chroma paper and shadows.
    const ink = Math.max(0, Math.min(1, (232 - luminance) / 74, (chroma > 24 ? 1 : (206 - luminance) / 90)));
    pixels[i + 3] = Math.round(pixels[i + 3] * ink);
    if (pixels[i + 3] > 10) {
      const pixel = i / 4, x = pixel % width, y = Math.floor(pixel / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) throw new Error('No signature ink was detected. Use a darker signature or adjust the lighting.');
  sourceContext.putImageData(frame, 0, 0);
  const pad = Math.max(8, Math.round(Math.max(maxX - minX + 1, maxY - minY + 1) * .035));
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad); maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
  const output = document.createElement('canvas'); output.width = maxX - minX + 1; output.height = maxY - minY + 1;
  output.getContext('2d').drawImage(source, minX, minY, output.width, output.height, 0, 0, output.width, output.height);
  return { dataUrl: output.toDataURL('image/png'), width: output.width, height: output.height, sourceWidth: image.naturalWidth, sourceHeight: image.naturalHeight };
}
