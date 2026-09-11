import { Injectable } from '@nestjs/common';

export interface IslamicContentSyncRequest {
  provider: string;
  scope: string;
  requestedAtUtc: Date;
}

/**
 * IslamicContentSyncQueue: an unbounded single-reader queue that admits at most
 * one queued-or-running synchronization per provider (keys are lower-cased).
 */
@Injectable()
export class IslamicContentSyncQueue {
  private readonly queuedProviders = new Set<string>();
  private readonly pending: IslamicContentSyncRequest[] = [];
  private wake: (() => void) | null = null;

  /** Queues a run unless the provider already has one queued or running. */
  tryQueue(provider: string, scope: string): boolean {
    const providerKey = provider.trim().toLowerCase();
    const scopeKey = scope.trim().toLowerCase();
    if (this.queuedProviders.has(providerKey)) return false;
    this.queuedProviders.add(providerKey);
    this.pending.push({ provider: providerKey, scope: scopeKey, requestedAtUtc: new Date() });
    this.wake?.();
    return true;
  }

  /** Consumes requests until the signal aborts (single consumer, like Channel SingleReader). */
  async *readAll(signal?: AbortSignal): AsyncGenerator<IslamicContentSyncRequest, void, undefined> {
    while (!signal?.aborted) {
      const next = this.pending.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      await this.waitForWork(signal);
    }
  }

  /** Releases the provider so a new synchronization can be queued. */
  markCompleted(provider: string): void {
    this.queuedProviders.delete(provider.trim().toLowerCase());
  }

  /** Providers with a synchronization queued or running. */
  queued(): string[] {
    return [...this.queuedProviders];
  }

  private waitForWork(signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const finish = (): void => {
        signal?.removeEventListener('abort', finish);
        this.wake = null;
        resolve();
      };
      if (signal?.aborted) {
        finish();
        return;
      }
      this.wake = finish;
      signal?.addEventListener('abort', finish, { once: true });
    });
  }
}
