import { EventEmitter } from 'node:events';
import { v4 as uuidv4 } from 'uuid';
import type { FishFinderResult } from '../types.js';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';
export type BatchStatus = 'pending' | 'running' | 'completed' | 'cancelled';

export interface ProgressUpdate {
  stage: 'uploading' | 'processing' | 'analyzing' | 'extracting';
  percent: number;
  message: string;
}

export interface Job {
  id: string;
  status: JobStatus;
  progress: ProgressUpdate | null;
  result: FishFinderResult | null;
  error: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

export interface VideoQueueItem {
  path: string;
  originalName: string;
}

export interface BatchJob {
  batchId: string;
  videos: string[];
  videoQueue: VideoQueueItem[];  // Dynamic queue for incremental additions
  originalNames: Map<string, string>;  // path -> originalName mapping
  model: string;
  fps: number;
  currentIndex: number;
  currentJobId: string | null;
  completed: string[];
  failed: Array<{ path: string; error: string }>;
  results: Map<string, FishFinderResult>;
  status: BatchStatus;
  uploadsComplete: boolean;  // True when all uploads are done
  startedAt: Date;
  completedAt: Date | null;
}

class JobManager extends EventEmitter {
  private jobs = new Map<string, Job>();
  private batches = new Map<string, BatchJob>();

  createJob(id: string): Job {
    const job: Job = {
      id,
      status: 'pending',
      progress: null,
      result: null,
      error: null,
      startedAt: new Date(),
      completedAt: null,
    };

    this.jobs.set(id, job);
    return job;
  }

  getJob(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  updateProgress(id: string, progress: ProgressUpdate): void {
    const job = this.jobs.get(id);
    if (job) {
      job.status = 'running';
      job.progress = progress;
      this.emit(`progress:${id}`, progress);
    }
  }

  completeJob(id: string, result: FishFinderResult): void {
    const job = this.jobs.get(id);
    if (job) {
      job.status = 'completed';
      job.result = result;
      job.completedAt = new Date();
      this.emit(`complete:${id}`, result);
    }
  }

  failJob(id: string, error: string): void {
    const job = this.jobs.get(id);
    if (job) {
      job.status = 'failed';
      job.error = error;
      job.completedAt = new Date();
      this.emit(`error:${id}`, error);
    }
  }

  // Clean up old jobs (older than 1 hour)
  cleanup(): void {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;

    for (const [id, job] of this.jobs) {
      if (job.startedAt.getTime() < oneHourAgo) {
        this.jobs.delete(id);
      }
    }

    for (const [id, batch] of this.batches) {
      if (batch.startedAt.getTime() < oneHourAgo) {
        this.batches.delete(id);
      }
    }
  }

  // Batch job management
  createBatch(videos: string[], model: string, fps: number): BatchJob {
    const batchId = uuidv4();
    const batch: BatchJob = {
      batchId,
      videos,
      videoQueue: videos.map(v => ({ path: v, originalName: v })),
      originalNames: new Map(),
      model,
      fps,
      currentIndex: -1,
      currentJobId: null,
      completed: [],
      failed: [],
      results: new Map(),
      status: 'pending',
      uploadsComplete: true,  // Legacy batches have all videos upfront
      startedAt: new Date(),
      completedAt: null,
    };

    this.batches.set(batchId, batch);
    return batch;
  }

  // Create empty batch for incremental video additions
  createEmptyBatch(model: string, fps: number, expectedCount?: number): BatchJob {
    const batchId = uuidv4();
    const batch: BatchJob = {
      batchId,
      videos: [],
      videoQueue: [],
      originalNames: new Map(),
      model,
      fps,
      currentIndex: -1,
      currentJobId: null,
      completed: [],
      failed: [],
      results: new Map(),
      status: 'pending',
      uploadsComplete: false,  // Will be set true when all uploads complete
      startedAt: new Date(),
      completedAt: null,
    };

    this.batches.set(batchId, batch);
    this.emit(`batch:created:${batchId}`, { batchId, expectedCount });
    return batch;
  }

  // Add video to batch (can be called while batch is processing)
  addVideoToBatch(batchId: string, videoPath: string, originalName: string): boolean {
    const batch = this.batches.get(batchId);
    if (!batch || batch.status === 'completed' || batch.status === 'cancelled') {
      return false;
    }

    batch.videos.push(videoPath);
    batch.videoQueue.push({ path: videoPath, originalName });
    batch.originalNames.set(videoPath, originalName);

    this.emit(`batch:video_added:${batchId}`, {
      path: videoPath,
      originalName,
      queueLength: batch.videoQueue.length,
      total: batch.videos.length,
    });

    return true;
  }

  // Mark all uploads complete (batch can finish when queue is empty)
  markUploadsComplete(batchId: string): void {
    const batch = this.batches.get(batchId);
    if (batch) {
      batch.uploadsComplete = true;
      this.emit(`batch:uploads_complete:${batchId}`, {
        total: batch.videos.length,
      });
    }
  }

  // Get next video from queue (returns null if queue empty)
  getNextQueuedVideo(batchId: string): VideoQueueItem | null {
    const batch = this.batches.get(batchId);
    if (!batch || batch.videoQueue.length === 0) {
      return null;
    }
    return batch.videoQueue.shift() || null;
  }

  // Check if batch should continue waiting or finish
  shouldBatchWait(batchId: string): boolean {
    const batch = this.batches.get(batchId);
    if (!batch) return false;
    // Wait if: uploads not complete AND queue is empty
    return !batch.uploadsComplete && batch.videoQueue.length === 0;
  }

  // Check if batch is done (uploads complete and queue empty)
  isBatchDone(batchId: string): boolean {
    const batch = this.batches.get(batchId);
    if (!batch) return true;
    return batch.uploadsComplete && batch.videoQueue.length === 0;
  }

  getBatch(batchId: string): BatchJob | undefined {
    return this.batches.get(batchId);
  }

  startBatchVideo(batchId: string, videoPath: string, jobId: string): void {
    const batch = this.batches.get(batchId);
    if (batch) {
      batch.status = 'running';
      batch.currentIndex = batch.videos.indexOf(videoPath);
      batch.currentJobId = jobId;
      this.emit(`batch:video_start:${batchId}`, {
        path: videoPath,
        index: batch.currentIndex,
        total: batch.videos.length,
      });
    }
  }

  updateBatchVideoProgress(batchId: string, videoPath: string, progress: ProgressUpdate): void {
    const batch = this.batches.get(batchId);
    if (batch) {
      this.emit(`batch:video_progress:${batchId}`, {
        path: videoPath,
        ...progress,
      });
      this.emit(`batch:progress:${batchId}`, {
        total: batch.videos.length,
        completed: batch.completed.length,
        failed: batch.failed.length,
        currentIndex: batch.currentIndex,
        currentVideo: videoPath,
        currentProgress: progress,
      });
    }
  }

  completeBatchVideo(batchId: string, videoPath: string, result: FishFinderResult): void {
    const batch = this.batches.get(batchId);
    if (batch) {
      batch.completed.push(videoPath);
      batch.results.set(videoPath, result);
      batch.currentJobId = null;
      this.emit(`batch:video_complete:${batchId}`, {
        path: videoPath,
        result,
        completedCount: batch.completed.length,
        total: batch.videos.length,
      });
    }
  }

  failBatchVideo(batchId: string, videoPath: string, error: string): void {
    const batch = this.batches.get(batchId);
    if (batch) {
      batch.failed.push({ path: videoPath, error });
      batch.currentJobId = null;
      this.emit(`batch:video_error:${batchId}`, {
        path: videoPath,
        error,
        failedCount: batch.failed.length,
        total: batch.videos.length,
      });
    }
  }

  skipBatchVideo(batchId: string, videoPath: string, reason: string): void {
    const batch = this.batches.get(batchId);
    if (batch) {
      // Count skipped videos as completed (they already have results)
      batch.completed.push(videoPath);
      this.emit(`batch:video_skipped:${batchId}`, {
        path: videoPath,
        reason,
        completedCount: batch.completed.length,
        total: batch.videos.length,
      });
    }
  }

  completeBatch(batchId: string): void {
    const batch = this.batches.get(batchId);
    if (batch) {
      batch.status = 'completed';
      batch.completedAt = new Date();
      batch.currentJobId = null;
      this.emit(`batch:complete:${batchId}`, {
        completed: batch.completed,
        failed: batch.failed,
        total: batch.videos.length,
      });
    }
  }

  cancelBatch(batchId: string): boolean {
    const batch = this.batches.get(batchId);
    if (batch && batch.status === 'running') {
      batch.status = 'cancelled';
      batch.completedAt = new Date();
      this.emit(`batch:cancelled:${batchId}`, {
        completed: batch.completed,
        failed: batch.failed,
        remaining: batch.videos.length - batch.completed.length - batch.failed.length,
      });
      return true;
    }
    return false;
  }

  isBatchCancelled(batchId: string): boolean {
    const batch = this.batches.get(batchId);
    return batch?.status === 'cancelled';
  }
}

export const jobManager = new JobManager();

// Cleanup old jobs every 10 minutes
setInterval(() => jobManager.cleanup(), 10 * 60 * 1000);
