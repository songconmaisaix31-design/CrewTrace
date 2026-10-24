import { AppError } from './errors.js';

export function encodeUtf8(content: string): Buffer {
  const bytes = Buffer.from(content,'utf8');
  if (new TextDecoder('utf-8',{ fatal: true,ignoreBOM: true }).decode(bytes)!==content) throw new AppError(400,'INVALID_INPUT','原文不能无损编码为 UTF-8');
  return bytes;
}
