import type { Ctx } from '../core/context.js';

/**
 * Port of backend-node/src/integrations/storage.service.ts (LocalStorageService) onto the
 * `UPLOADS` KV namespace. A KV key is the path backend-node writes below
 * `wwwroot/uploads/` ("orgs/<orgId>/header-<uuid>.png"); the content type, size and upload
 * time live in the KV metadata. Files are served by `GET /uploads/*` (modules/design.ts).
 * Azure Blob storage is not ported.
 */

/** Largest object accepted (KV allows 25 MiB per value; uploads are capped at 8 MB anyway). */
export const MAX_STORED_BYTES = 25 * 1024 * 1024;

export interface StoredObjectMetadata {
  contentType: string;
  size: number;
  /** ISO-8601 UTC instant of the upload (the file's mtime in backend-node). */
  uploadedAtUtc: string;
}

export interface StoredObject extends StoredObjectMetadata {
  bytes: ArrayBuffer;
}

export interface StorageService {
  /**
   * backend-node's StorageService.upload: stores `data` under `key` and returns its public
   * URL. `publicOrigin` is the request's "{scheme}://{host}" (see `requestOrigin`).
   */
  upload(key: string, contentType: string, data: Uint8Array | ArrayBuffer, publicOrigin: string): Promise<string>;
  /** Stores the bytes under `path` (relative to /uploads/) with their content type. */
  put(path: string, bytes: Uint8Array | ArrayBuffer, contentType: string): Promise<void>;
  /** The stored object, or null when the path is unknown or not a valid key. */
  get(path: string): Promise<StoredObject | null>;
  /** "{publicOrigin}/uploads/{path}", the URL backend-node's LocalStorageService returns. */
  publicUrl(path: string, publicOrigin: string): string;
}

/** The subset of KVNamespace the storage uses (so tests can substitute an in-memory fake). */
export interface UploadsKv {
  put(key: string, value: ArrayBuffer, options?: { metadata?: unknown }): Promise<void>;
  getWithMetadata<Metadata = unknown>(key: string, type: 'arrayBuffer'): Promise<{ value: ArrayBuffer | null; metadata: Metadata | null }>;
}

/**
 * LocalStorageService refuses keys that resolve outside the uploads directory; here a key
 * must be a clean relative path: no empty, "." or ".." segments, no backslashes or control
 * characters, and at most 512 bytes (the KV key limit).
 */
export function isValidStorageKey(key: string): boolean {
  if (key.length === 0 || new TextEncoder().encode(key).length > 512) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f]/.test(key)) return false;
  return key.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function toArrayBuffer(data: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

export class KvStorageService implements StorageService {
  constructor(private readonly kv: UploadsKv) {}

  async upload(key: string, contentType: string, data: Uint8Array | ArrayBuffer, publicOrigin: string): Promise<string> {
    await this.put(key, data, contentType);
    return this.publicUrl(key, publicOrigin);
  }

  async put(path: string, bytes: Uint8Array | ArrayBuffer, contentType: string): Promise<void> {
    if (!isValidStorageKey(path)) throw new Error(`Storage key "${path}" resolves outside the uploads directory.`);
    if (bytes.byteLength > MAX_STORED_BYTES) throw new Error(`Storage key "${path}" exceeds the ${MAX_STORED_BYTES} byte limit.`);
    const metadata: StoredObjectMetadata = { contentType, size: bytes.byteLength, uploadedAtUtc: new Date().toISOString() };
    await this.kv.put(path, toArrayBuffer(bytes), { metadata });
  }

  async get(path: string): Promise<StoredObject | null> {
    if (!isValidStorageKey(path)) return null;
    const { value, metadata } = await this.kv.getWithMetadata<Partial<StoredObjectMetadata>>(path, 'arrayBuffer');
    if (value === null) return null;
    return {
      bytes: value,
      contentType: metadata?.contentType || 'application/octet-stream',
      size: value.byteLength,
      uploadedAtUtc: metadata?.uploadedAtUtc ?? new Date(0).toISOString(),
    };
  }

  publicUrl(path: string, publicOrigin: string): string {
    return `${publicOrigin}/uploads/${path}`;
  }
}

/** The storage of this request's worker (the `UPLOADS` KV binding). */
export function storage(c: Ctx): StorageService {
  return new KvStorageService(c.env.UPLOADS as unknown as UploadsKv);
}

/** `${request.protocol}://${request.get('host')}` in backend-node: the origin the request was sent to. */
export function requestOrigin(c: Ctx): string {
  const url = new URL(c.req.url);
  return `${url.protocol}//${url.host}`;
}
