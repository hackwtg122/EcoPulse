import { validScanCategory, type scanCategories } from "./pilotPolicy.ts";

export class AiClassificationError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export { validScanCategory, type scanCategories };

export function sanitizePng(input: Buffer): Buffer {
  if (!Buffer.isBuffer(input) || input.length < 8 || input.length > 5 * 1024 * 1024) throw new AiClassificationError(400, "invalid_image");
  const sig = input.readUInt32BE(0);
  if (sig !== 0x89504e47) throw new AiClassificationError(400, "invalid_image");
  let offset = 8;
  const chunks: Buffer[] = [];
  let seenEnd = false;
  const allowedChunks = new Set(["IHDR", "IDAT", "IEND", "PLTE", "tRNS"]);
  while (offset + 12 <= input.length) {
    const size = input.readUInt32BE(offset);
    const type = input.slice(offset + 4, offset + 8).toString("ascii");
    const dataEnd = offset + 12 + size;
    if (dataEnd > input.length) throw new AiClassificationError(400, "invalid_image");
    const crc = input.readUInt32BE(dataEnd);
    // Basic CRC check not required; just bounds
    if (type === "IEND") {
      chunks.push(input.subarray(offset, dataEnd + 4));
      seenEnd = true;
      break;
    }
    if ((type.charCodeAt(0) & 32) === 0 && !allowedChunks.has(type)) throw new AiClassificationError(400, "unsupported_image_chunk");
    if (allowedChunks.has(type)) chunks.push(input.subarray(offset, offset + size + 12));
    offset += size + 12;
  }
  if (!seenEnd || offset !== input.length) throw new AiClassificationError(400, "invalid_image");
  return Buffer.concat(chunks);
}