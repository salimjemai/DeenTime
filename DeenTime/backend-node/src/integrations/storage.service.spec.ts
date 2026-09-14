import type { BlobServiceClient } from '@azure/storage-blob';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppConfig } from '../config/configuration.js';
import { AzureBlobStorageService, LocalStorageService, STORAGE_SERVICE, storageProvider } from './storage.service.js';

const roots: string[] = [];

function tempConfig(overrides: Record<string, string> = {}): AppConfig {
  const contentRoot = mkdtempSync(join(tmpdir(), 'iqamatime-storage-'));
  roots.push(contentRoot);
  return AppConfig.load({ contentRoot, env: {}, overrides, environmentName: 'Testing' });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface RecordedUpload {
  key: string;
  data: Buffer;
  options: unknown;
}

function fakeBlobClient(): { client: BlobServiceClient; uploads: RecordedUpload[]; containers: string[] } {
  const uploads: RecordedUpload[] = [];
  const containers: string[] = [];
  const client = {
    getContainerClient: (name: string) => ({
      createIfNotExists: async () => {
        containers.push(name);
        return {};
      },
      getBlockBlobClient: (key: string) => ({
        url: `https://iqamatime.blob.core.windows.net/${name}/${encodeURIComponent(key).replaceAll('%2F', '/')}`,
        uploadData: async (data: Buffer, options: unknown) => {
          uploads.push({ key, data, options });
          return {};
        },
      }),
    }),
  };
  return { client: client as unknown as BlobServiceClient, uploads, containers };
}

describe('LocalStorageService', () => {
  it('writes under wwwroot/uploads and returns the public URL', async () => {
    const config = tempConfig();
    const service = new LocalStorageService(config);
    const data = Buffer.from('png-bytes');

    const url = await service.upload('org-1/logo-abc.png', 'image/png', data, 'https://api.iqamatime.test');

    expect(url).toBe('https://api.iqamatime.test/uploads/org-1/logo-abc.png');
    const written = join(config.contentRoot, 'wwwroot', 'uploads', 'org-1', 'logo-abc.png');
    expect(existsSync(written)).toBe(true);
    expect(readFileSync(written)).toEqual(data);
  });

  it('creates the uploads directory eagerly and overwrites existing files', async () => {
    const config = tempConfig();
    const service = new LocalStorageService(config);
    expect(existsSync(join(config.contentRoot, 'wwwroot', 'uploads'))).toBe(true);

    await service.upload('a.txt', 'text/plain', Buffer.from('one'), '');
    await service.upload('a.txt', 'text/plain', Buffer.from('two'), '');
    expect(readFileSync(join(service.basePath, 'a.txt'), 'utf8')).toBe('two');
  });

  it('refuses keys that escape the uploads directory', async () => {
    const service = new LocalStorageService(tempConfig());
    await expect(service.upload('../escape.txt', 'text/plain', Buffer.from('x'), '')).rejects.toThrow('outside the uploads directory');
  });
});

describe('AzureBlobStorageService', () => {
  it('uploads with the content type and returns the blob URL', async () => {
    const fake = fakeBlobClient();
    const service = new AzureBlobStorageService(tempConfig(), fake.client);

    const url = await service.upload('org-1/logo.png', 'image/png', Buffer.from('png'), 'https://ignored.test');

    expect(url).toBe('https://iqamatime.blob.core.windows.net/deentime/org-1/logo.png');
    expect(fake.containers).toEqual(['deentime']);
    expect(fake.uploads).toEqual([{ key: 'org-1/logo.png', data: Buffer.from('png'), options: { blobHTTPHeaders: { blobContentType: 'image/png' } } }]);
  });

  it('uses the configured container and CDN base', async () => {
    const fake = fakeBlobClient();
    const service = new AzureBlobStorageService(tempConfig({ 'Storage:Container': 'assets', 'Storage:CdnBase': 'https://cdn.iqamatime.test/' }), fake.client);

    const url = await service.upload('pdf/schedule.pdf', '', Buffer.from('pdf'), '');

    expect(url).toBe('https://cdn.iqamatime.test/pdf/schedule.pdf');
    expect(fake.containers).toEqual(['assets']);
    expect(fake.uploads[0].options).toBeUndefined();
  });
});

describe('storageProvider', () => {
  it('provides the local service unless a connection string is configured', () => {
    expect(storageProvider.provide).toBe(STORAGE_SERVICE);
    expect(storageProvider.inject).toEqual([AppConfig]);
    expect(storageProvider.useFactory(tempConfig())).toBeInstanceOf(LocalStorageService);
    expect(storageProvider.useFactory(tempConfig({ 'Storage:ConnectionString': '  ' }))).toBeInstanceOf(LocalStorageService);
    expect(storageProvider.useFactory(tempConfig({ 'Storage:ConnectionString': 'UseDevelopmentStorage=true' }))).toBeInstanceOf(AzureBlobStorageService);
  });
});
