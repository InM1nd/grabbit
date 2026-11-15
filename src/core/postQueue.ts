type Request = { resolve: () => void; reject: (error: unknown) => void; promise: Promise<void> };

/** One worker, with explicit shares/retries ahead of the oldest eligible backlog. */
export function createPostQueue<T>(
  find: (id?: number) => Promise<T | null | undefined>,
  process: (post: T) => Promise<void>,
  onIdle?: () => void,
) {
  const priority = new Map<number, Request>();
  let remaining = 0;
  let running: Promise<void> | null = null;

  async function drain() {
    try {
      while (priority.size || remaining > 0) {
        const target = priority.entries().next().value;
        if (target) {
          const [id, request] = target;
          priority.delete(id);
          try {
            const post = await find(id);
            if (post != null) await process(post);
            request.resolve();
          } catch (error) {
            request.reject(error);
          }
          continue;
        }

        const post = await find();
        if (priority.size) continue;
        if (post == null) remaining = 0;
        else {
          remaining--;
          await process(post);
        }
      }
    } catch (error) {
      for (const request of priority.values()) request.reject(error);
      priority.clear();
      remaining = 0;
      throw error;
    } finally {
      running = null;
      onIdle?.();
    }
  }

  return (id?: number): Promise<void> => {
    let target: Request | undefined;
    if (id === undefined) remaining = Math.max(remaining, 60);
    else {
      target = priority.get(id);
      if (!target) {
        let resolve!: Request['resolve'];
        let reject!: Request['reject'];
        const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
        target = { promise, resolve, reject };
        priority.set(id, target);
      }
    }

    if (!running) {
      running = Promise.resolve().then(drain);
      void running.catch(() => {});
    }
    return target?.promise ?? running;
  };
}
