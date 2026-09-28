import { expect, test } from "bun:test";
import {
  isAllowedAvatarFile,
  MAX_AVATAR_DATA_URL_CHARS,
  MAX_AVATAR_PNG_BYTES,
  parseAvatarDataUrl,
  PNG_DATA_URL_PREFIX,
} from "./avatar";

function file(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

test("accepts common raster image types and extensions", () => {
  expect(isAllowedAvatarFile(file("photo.png", "image/png"))).toBe(true);
  expect(isAllowedAvatarFile(file("photo.jpg", "image/jpeg"))).toBe(true);
  expect(isAllowedAvatarFile(file("photo.webp", "image/webp"))).toBe(true);
  expect(isAllowedAvatarFile(file("photo.gif", "image/gif"))).toBe(true);
  expect(isAllowedAvatarFile(file("photo.PNG", ""))).toBe(true);
  expect(isAllowedAvatarFile(file("photo.svg", "image/svg+xml"))).toBe(false);
  expect(isAllowedAvatarFile(file("photo.txt", "text/plain"))).toBe(false);
});

test("only persisted avatars are PNG data URLs", () => {
  const png = `${PNG_DATA_URL_PREFIX}aaa`;
  expect(parseAvatarDataUrl(png)).toBe(png);
  expect(parseAvatarDataUrl(`  ${png}  `)).toBe(png);
  expect(parseAvatarDataUrl("data:image/jpeg;base64,aaa")).toBeNull();
  expect(parseAvatarDataUrl("https://example.test/a.png")).toBeNull();
  expect(parseAvatarDataUrl(PNG_DATA_URL_PREFIX)).toBeNull();
  expect(
    parseAvatarDataUrl(`${PNG_DATA_URL_PREFIX}${"a".repeat(MAX_AVATAR_DATA_URL_CHARS)}`),
  ).toBeNull();
});

test("data URL ceiling fits a max-size PNG", () => {
  expect(
    PNG_DATA_URL_PREFIX.length + Math.ceil((MAX_AVATAR_PNG_BYTES * 4) / 3) + 8,
  ).toBeLessThanOrEqual(MAX_AVATAR_DATA_URL_CHARS);
});
