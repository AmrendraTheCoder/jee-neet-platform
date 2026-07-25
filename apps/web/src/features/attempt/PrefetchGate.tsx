import { useEffect, useRef, useState } from 'react';
import type { AssetManifestEntry } from '../../lib/api/types.js';
import { formatBytes } from '../../lib/format.js';
import { Callout, ProgressBar } from '../../components/ui/Feedback.js';
import { Button } from '../../components/ui/Button.js';
import './attempt.css';

interface PrefetchProgress {
  readonly loadedBytes: number;
  readonly totalBytes: number;
  readonly completed: number;
  readonly failed: readonly string[];
  readonly done: boolean;
}

/**
 * Asset prefetch with determinate progress, BEFORE the paper begins
 * (FR-ATT-14).
 *
 * The manifest carries hashes and byte sizes, which is what makes the progress
 * determinate — a spinner here tells a candidate nothing about whether to wait
 * or to reload, at the worst possible moment. Prefetching afterwards is worse
 * still: a diagram that loads at question 40 costs paper time against an
 * immovable deadline, and on a coaching-centre network it may not load at all.
 *
 * Assets are fetched with `cache: 'force-cache'` so the browser's HTTP cache
 * holds them for the rest of the paper. The URLs are per-object and identical
 * for every candidate — per-user signed URLs would eliminate CDN caching
 * entirely and make origin egress scale with student count.
 *
 * A failed asset does NOT block the paper. Some images failing is recoverable;
 * refusing to let a candidate start is not.
 */
export function PrefetchGate(props: {
  readonly assets: readonly AssetManifestEntry[];
  readonly onReady: () => void;
  readonly children?: never;
}): JSX.Element {
  const [progress, setProgress] = useState<PrefetchProgress>(() => ({
    loadedBytes: 0,
    totalBytes: props.assets.reduce((sum, asset) => sum + asset.bytes, 0),
    completed: 0,
    failed: [],
    done: props.assets.length === 0,
  }));
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;

    const run = async (): Promise<void> => {
      let loadedBytes = 0;
      let completed = 0;
      const failed: string[] = [];

      // Sequential with a small concurrency window rather than all at once: a
      // 4G connection issuing sixty parallel requests is slower end to end and
      // makes the progress bar meaningless.
      const queue = [...props.assets];
      const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
        for (;;) {
          const asset = queue.shift();
          if (asset === undefined || cancelled) return;
          try {
            await fetch(asset.url, { cache: 'force-cache', credentials: 'omit' });
          } catch {
            failed.push(asset.assetId);
          }
          loadedBytes += asset.bytes;
          completed += 1;
          if (!cancelled) {
            setProgress((previous) => ({
              ...previous,
              loadedBytes,
              completed,
              failed: [...failed],
            }));
          }
        }
      });

      await Promise.all(workers);
      if (!cancelled) setProgress((previous) => ({ ...previous, done: true, failed: [...failed] }));
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [props.assets]);

  return (
    <div className="centered-page stack">
      <h1>Preparing your paper</h1>
      <p className="muted">
        Downloading the diagrams and images for this paper now, so that nothing has to load
        while you are answering. Your time does not start until this finishes.
      </p>

      <ProgressBar
        label={`${progress.completed} of ${props.assets.length} files`}
        value={progress.loadedBytes}
        max={Math.max(1, progress.totalBytes)}
        detail={`${formatBytes(progress.loadedBytes)} of ${formatBytes(progress.totalBytes)}`}
      />

      {progress.failed.length > 0 ? (
        <Callout tone="warning" title={`${progress.failed.length} file${progress.failed.length === 1 ? '' : 's'} could not be downloaded`}>
          You can still sit the paper. If an image does not appear on a question, use the
          Report action on that question — it does not affect your marks.
        </Callout>
      ) : null}

      <div className="row">
        <Button size="lg" disabled={!progress.done} onClick={props.onReady}>
          {progress.done ? 'Continue to instructions' : 'Preparing'}
        </Button>
      </div>
    </div>
  );
}
