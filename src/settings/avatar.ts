export const AVATAR_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif";

export const MAX_AVATAR_INPUT_BYTES = 8 * 1024 * 1024;
export const AVATAR_OUTPUT_SIZE = 256;
// Keep in sync with `src-tauri/src/settings.rs`.
export const MAX_AVATAR_PNG_BYTES = 400_000;
export const MAX_AVATAR_DATA_URL_CHARS = 560_000;
export const PNG_DATA_URL_PREFIX = "data:image/png;base64,";

const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

export function isAllowedAvatarFile(file: File): boolean {
  const type = file.type.toLowerCase();
  if (type && ALLOWED_TYPES.has(type)) return true;
  return /\.(png|jpe?g|webp|gif)$/i.test(file.name);
}

export function parseAvatarDataUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith(PNG_DATA_URL_PREFIX)) return null;
  if (trimmed.length > MAX_AVATAR_DATA_URL_CHARS) return null;
  if (trimmed.slice(PNG_DATA_URL_PREFIX.length).length === 0) return null;
  return trimmed;
}

export async function prepareAvatarFile(file: File): Promise<string> {
  if (file.size > MAX_AVATAR_INPUT_BYTES) {
    throw new Error("Choose an image smaller than 8 MB.");
  }
  if (!isAllowedAvatarFile(file)) {
    throw new Error("Use a PNG, JPEG, WebP, or GIF image.");
  }

  const bitmap = await rasterizeAvatar(file);
  try {
    if (!bitmap.width || !bitmap.height) {
      throw new Error("That image could not be read.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_OUTPUT_SIZE;
    canvas.height = AVATAR_OUTPUT_SIZE;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not prepare that image.");
    }
    const scale = Math.max(
      AVATAR_OUTPUT_SIZE / bitmap.width,
      AVATAR_OUTPUT_SIZE / bitmap.height,
    );
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    context.drawImage(
      bitmap,
      (AVATAR_OUTPUT_SIZE - width) / 2,
      (AVATAR_OUTPUT_SIZE - height) / 2,
      width,
      height,
    );
    const blob = await canvasToPng(canvas);
    if (blob.size > MAX_AVATAR_PNG_BYTES) {
      throw new Error("That image is too large.");
    }
    const dataUrl = await blobToDataUrl(blob);
    const parsed = parseAvatarDataUrl(dataUrl);
    if (!parsed) {
      throw new Error("Could not prepare that image.");
    }
    return parsed;
  } finally {
    if ("close" in bitmap && typeof bitmap.close === "function") {
      bitmap.close();
    }
  }
}

async function rasterizeAvatar(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through to an <img> decode, which some WebViews prefer.
    }
  }
  return loadImageElement(file);
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That image could not be read."));
    };
    image.src = url;
  });
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not prepare that image."));
    }, "image/png");
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not prepare that image."));
    };
    reader.onerror = () => reject(new Error("Could not prepare that image."));
    reader.readAsDataURL(blob);
  });
}
