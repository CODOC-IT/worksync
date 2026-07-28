import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Real local-disk, content-addressed storage for Project Chat attachments — backs
// collab.StoredFiles' Sha256Hash/SizeBytes/StorageObjectKey columns with actual bytes instead of
// faking success. Content-addressed (filename = sha256 hex) so re-uploading identical content is
// a natural no-op/dedup rather than a new file every time.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Vercel's filesystem is read-only except /tmp — matches the same VERCEL check the Auth file
// store (backend/src/store/userStore.ts) already uses for its own /tmp fallback.
const STORAGE_ROOT = process.env.VERCEL === '1'
  ? path.join('/tmp', 'worksync-storage', 'collab-files')
  : path.join(__dirname, '..', '..', 'storage', 'collab-files');

const DATA_URL_PATTERN = /^data:([^;]+);base64,(.+)$/;

export interface ParsedAttachment {
  mimeType: string;
  buffer: Buffer;
}

export const parseAttachmentDataUrl = (dataUrl: string): ParsedAttachment | null => {
  const match = DATA_URL_PATTERN.exec(dataUrl);
  if (!match) return null;
  try {
    return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
  } catch {
    return null;
  }
};

export interface WrittenFile {
  sha256Hex: string;
  storageObjectKey: string;
  sizeBytes: number;
}

export const writeAttachmentToDisk = async (buffer: Buffer): Promise<WrittenFile> => {
  const sha256Hex = createHash('sha256').update(buffer).digest('hex');
  const storageObjectKey = `collab/${sha256Hex}`;
  await fs.mkdir(STORAGE_ROOT, { recursive: true });
  await fs.writeFile(path.join(STORAGE_ROOT, sha256Hex), buffer);
  return { sha256Hex, storageObjectKey, sizeBytes: buffer.length };
};

export const readAttachmentFromDisk = async (storageObjectKey: string): Promise<Buffer> => {
  const sha256Hex = storageObjectKey.split('/').pop() as string;
  return fs.readFile(path.join(STORAGE_ROOT, sha256Hex));
};
