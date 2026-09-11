import { BlobServiceClient } from '@azure/storage-blob';
import { Injectable, Optional, type FactoryProvider } from '@nestjs/common';
import { mkdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { AppConfig } from '../config/configuration.js';

/** Injection token for the StorageService implementation chosen by storageProvider. */
export const STORAGE_SERVICE = Symbol('STORAGE_SERVICE');

/** Port of DeenTime.Core.Services.IStorageService.UploadAsync. */
export interface StorageService {
  /**
   * Stores `data` under `key` and returns its public URL. `publicOrigin` is the
   * request's "{scheme}://{host}" (LocalStorageService read it from IHttpContextAccessor).
   */
  upload(key: string, contentType: string, data: Buffer, publicOrigin: string): Promise<string>;
}

/**
 * Port of LocalStorageService: files live under wwwroot/uploads/ and are served as
 * static assets from the same origin (development / single-server deployments).
 */
@Injectable()
export class LocalStorageService implements StorageService {
  readonly basePath: string;

  constructor(config: AppConfig) {
    this.basePath = resolve(config.contentRoot, 'wwwroot', 'uploads');
    mkdirSync(this.basePath, { recursive: true });
  }

  async upload(key: string, _contentType: string, data: Buffer, publicOrigin: string): Promise<string> {
    const target = join(this.basePath, ...key.split('/'));
    if (!target.startsWith(`${this.basePath}${sep}`)) throw new Error(`Storage key "${key}" resolves outside the uploads directory.`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
    return `${publicOrigin}/uploads/${key}`;
  }
}

/**
 * Port of AzureBlobStorageService. Options: Storage:ConnectionString, Storage:Container
 * (default "deentime") and Storage:CdnBase (public URL prefix instead of the blob URL).
 */
@Injectable()
export class AzureBlobStorageService implements StorageService {
  private readonly client: BlobServiceClient;
  private readonly container: string;
  private readonly cdnBase: string;

  constructor(config: AppConfig, @Optional() client?: BlobServiceClient) {
    this.client = client ?? BlobServiceClient.fromConnectionString(config.get('Storage:ConnectionString') ?? '');
    this.container = config.getOrDefault('Storage:Container', 'deentime');
    this.cdnBase = config.get('Storage:CdnBase') ?? '';
  }

  async upload(key: string, contentType: string, data: Buffer, _publicOrigin: string): Promise<string> {
    const container = this.client.getContainerClient(this.container);
    await container.createIfNotExists();
    const blob = container.getBlockBlobClient(key);
    await blob.uploadData(data, contentType === '' ? undefined : { blobHTTPHeaders: { blobContentType: contentType } });
    return this.cdnBase === '' ? blob.url : `${this.cdnBase.replace(/\/+$/, '')}/${key}`;
  }
}

/** Program.cs: Azure Blob Storage when Storage:ConnectionString is set, the local filesystem otherwise. */
export const storageProvider: FactoryProvider<StorageService> = {
  provide: STORAGE_SERVICE,
  useFactory: (config: AppConfig): StorageService =>
    (config.get('Storage:ConnectionString') ?? '').trim() === '' ? new LocalStorageService(config) : new AzureBlobStorageService(config),
  inject: [AppConfig],
};
