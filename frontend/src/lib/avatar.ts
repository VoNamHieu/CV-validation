/**
 * Resize an uploaded image to a square JPEG data URL suitable for embedding
 * in CV templates. We center-crop to the smallest dimension, then scale to
 * a fixed `size`. JPEG quality is set low enough to keep ~10–25KB so it fits
 * safely inside zustand's localStorage budget.
 *
 * Throws if the file isn't an image or the browser can't decode it.
 */
export async function resizeAvatarToDataUrl(
    file: File,
    size = 256,
    quality = 0.85,
): Promise<string> {
    if (!file.type.startsWith('image/')) {
        throw new Error('Tệp không phải là ảnh.');
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(new Error('Không đọc được tệp ảnh.'));
        r.readAsDataURL(file);
    });

    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('Không giải mã được ảnh.'));
        i.src = dataUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Trình duyệt không hỗ trợ canvas.');

    const minDim = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - minDim) / 2;
    const sy = (img.naturalHeight - minDim) / 2;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);

    return canvas.toDataURL('image/jpeg', quality);
}
