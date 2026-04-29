import { open, readFile } from 'fs/promises';
import JSZip from 'jszip';

const HEADER_LENGTH = 64;

async function readHeader(filePath, length = HEADER_LENGTH) {
  const file = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await file.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

function startsWithBytes(buffer, signature) {
  if (!buffer || buffer.length < signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (buffer[i] !== signature[i]) return false;
  }
  return true;
}

function hasAsciiAt(buffer, offset, ascii) {
  if (!buffer || buffer.length < offset + ascii.length) return false;
  return buffer.subarray(offset, offset + ascii.length).toString('ascii') === ascii;
}

function isMp3FrameSync(buffer) {
  if (!buffer || buffer.length < 2) return false;
  return buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
}

export async function detectOcrMimeType(filePath) {
  const header = await readHeader(filePath);

  if (startsWithBytes(header, Buffer.from([0x25, 0x50, 0x44, 0x46]))) {
    return 'application/pdf';
  }
  if (startsWithBytes(header, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (startsWithBytes(header, Buffer.from([0xff, 0xd8, 0xff]))) {
    return 'image/jpeg';
  }
  if (hasAsciiAt(header, 0, 'RIFF') && hasAsciiAt(header, 8, 'WEBP')) {
    return 'image/webp';
  }

  return null;
}

export async function detectAudioMimeType(filePath) {
  const header = await readHeader(filePath);

  if (hasAsciiAt(header, 0, 'RIFF') && hasAsciiAt(header, 8, 'WAVE')) {
    return 'audio/wav';
  }
  if (hasAsciiAt(header, 0, 'OggS')) {
    return 'audio/ogg';
  }
  if (hasAsciiAt(header, 0, 'fLaC')) {
    return 'audio/flac';
  }
  if (startsWithBytes(header, Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    return 'audio/webm';
  }
  if (hasAsciiAt(header, 0, 'ID3') || isMp3FrameSync(header)) {
    return 'audio/mpeg';
  }
  if (hasAsciiAt(header, 4, 'ftyp')) {
    return 'audio/mp4';
  }

  return null;
}

export async function detectOfficeMimeTypeFromBuffer(buffer) {
  if (!buffer || buffer.length < 4 || !startsWithBytes(buffer, Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    return null;
  }

  try {
    const zip = await JSZip.loadAsync(buffer);
    const contentTypesEntry = zip.file('[Content_Types].xml');
    if (!contentTypesEntry) return null;
    const contentTypesXml = await contentTypesEntry.async('string');

    if (contentTypesXml.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')) {
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    if (contentTypesXml.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml')) {
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }
    if (contentTypesXml.includes('application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml')) {
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    }
  } catch {
    return null;
  }

  return null;
}

export async function detectOfficeMimeType(filePath) {
  const buffer = await readFile(filePath);
  return detectOfficeMimeTypeFromBuffer(buffer);
}

export function extensionFromDetectedMime(mimeType) {
  const map = {
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/ogg': '.ogg',
    'audio/webm': '.webm',
    'audio/flac': '.flac',
    'audio/mp4': '.m4a',
    'application/pdf': '.pdf',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  };
  return map[mimeType] || '';
}
