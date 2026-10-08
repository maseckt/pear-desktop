export type DownloadTask = {
  id: string;
  title: string;
  status: 'queued' | 'running' | 'done' | 'cancelled' | 'error';
  progress: number;
  error?: string;
};

export class DownloadTasks {
  private tasks = new Map<string, DownloadTask>();
  private keys = new Map<string, Promise<void>>();
  private jobs = new Map<string, () => Promise<void>>();
  private cancelled = new Set<string>();
  private tail = Promise.resolve();
  private nextId = 0;
  private listeners = new Set<() => void>();

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  snapshot() {
    return [...this.tasks.values()].map((task) => ({ ...task }));
  }
  private emit() {
    for (const listener of this.listeners) listener();
  }
  check(id: string) {
    if (this.cancelled.has(id)) throw new Error('Download cancelled');
  }
  update(id: string, title: string, progress = -1) {
    if (this.cancelled.has(id)) return;
    const task = this.tasks.get(id);
    if (!task || task.status !== 'running') return;
    task.title = title.slice(0, 300);
    task.progress =
      Number.isFinite(progress) && progress >= 0 && progress <= 1
        ? progress
        : -1;
    this.emit();
  }
  cancel(id: unknown) {
    if (typeof id !== 'string') return;
    const task = this.tasks.get(id);
    if (!task || (task.status !== 'queued' && task.status !== 'running'))
      return;
    this.cancelled.add(id);
    // Running conversion is cooperative: allow ffmpeg to finish, but never save.
    if (task.status === 'queued') task.status = 'cancelled';
    this.emit();
  }
  dismiss(id: unknown) {
    if (typeof id !== 'string') return;
    const task = this.tasks.get(id);
    if (!task || task.status === 'queued' || task.status === 'running') return;
    this.tasks.delete(id);
    this.jobs.delete(id);
    this.emit();
  }
  retry(id: unknown) {
    if (typeof id !== 'string' || this.tasks.get(id)?.status !== 'error')
      return;
    const job = this.jobs.get(id);
    if (!job) return;
    this.dismiss(id);
    job().catch(console.error);
  }
  enqueue(
    key: string,
    title: string,
    run: (id: string) => Promise<void>,
  ): Promise<void> {
    const existing = this.keys.get(key);
    if (existing) return existing;
    // Cancelled queued rows can be dismissed before their promise drains.
    // Bound pending work independently of visible history.
    if (this.keys.size >= 100)
      return Promise.reject(new Error('Download queue full'));
    // Never allow IPC spam to accumulate an unbounded queue or failure history.
    while (this.tasks.size >= 100) {
      const finished = [...this.tasks.values()].find(
        (t) => t.status !== 'queued' && t.status !== 'running',
      );
      if (!finished) return Promise.reject(new Error('Download queue full'));
      this.dismiss(finished.id);
    }
    const id = String(++this.nextId);
    const task: DownloadTask = {
      id,
      title: title.slice(0, 300),
      status: 'queued',
      progress: -1,
    };
    this.tasks.set(id, task);
    this.jobs.set(id, () => this.enqueue(key, title, run));
    const promise = this.tail.then(async () => {
      try {
        this.check(id);
        task.status = 'running';
        this.emit();
        await run(id);
        this.check(id);
        task.status = 'done';
        task.progress = 1;
      } catch (error) {
        task.status = this.cancelled.has(id) ? 'cancelled' : 'error';
        if (task.status === 'error')
          task.error = (
            error instanceof Error ? error.message : 'Download failed'
          )
            .replace(/https?:\/\/\S+/g, '[URL]')
            .slice(0, 500);
      } finally {
        this.keys.delete(key);
        this.cancelled.delete(id);
        if (task.status !== 'error') this.jobs.delete(id);
        this.emit();
      }
    });
    this.tail = promise;
    this.keys.set(key, promise);
    this.emit();
    return promise;
  }
}
