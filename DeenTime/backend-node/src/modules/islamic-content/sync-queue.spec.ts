import { describe, expect, it } from 'vitest';
import { IslamicContentSyncQueue } from './sync-queue.js';

describe('IslamicContentSyncQueue', () => {
  it('admits one queued-or-running synchronization per provider', () => {
    const queue = new IslamicContentSyncQueue();
    expect(queue.tryQueue('Quran', 'Catalog')).toBe(true);
    expect(queue.tryQueue('quran', 'all')).toBe(false);
    expect(queue.tryQueue('hadith', 'all')).toBe(true);
    expect(queue.queued()).toEqual(['quran', 'hadith']);

    queue.markCompleted('QURAN');
    expect(queue.queued()).toEqual(['hadith']);
    expect(queue.tryQueue('quran', 'text')).toBe(true);
  });

  it('delivers requests to the consumer in order and stops when aborted', async () => {
    const queue = new IslamicContentSyncQueue();
    const controller = new AbortController();
    const received: string[] = [];

    const consumer = (async () => {
      for await (const request of queue.readAll(controller.signal)) {
        received.push(`${request.provider}:${request.scope}`);
        queue.markCompleted(request.provider);
        if (received.length === 3) controller.abort();
      }
    })();

    expect(queue.tryQueue('quran', 'catalog')).toBe(true);
    expect(queue.tryQueue('hadith', 'all')).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queue.tryQueue('quran', 'ALL')).toBe(true);

    await consumer;
    expect(received).toEqual(['quran:catalog', 'hadith:all', 'quran:all']);
  });

  it('wakes up an idle consumer when work arrives', async () => {
    const queue = new IslamicContentSyncQueue();
    const controller = new AbortController();
    const iterator = queue.readAll(controller.signal);

    const pending = iterator.next();
    queue.tryQueue('hadith', 'all');
    await expect(pending).resolves.toMatchObject({ done: false, value: { provider: 'hadith', scope: 'all' } });
    expect((await pending).value?.requestedAtUtc).toBeInstanceOf(Date);

    controller.abort();
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
  });
});
