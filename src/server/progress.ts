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

export interface BatchJob {
  batchId: string;
  videos: string[];
  model: string;
  fps: number;
  currentIndex: number;
  currentJobId: string | null;
  completed: string[];
  failed: Array<{ path: string; error: string }>;
  results: Map<string, FishFinderResult>;
  status: BatchStatus;
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
      model,
      fps,
      currentIndex: -1,
      currentJobId: null,
      completed: [],
      failed: [],
      results: new Map(),
      status: 'pending',
      startedAt: new Date(),
      completedAt: null,
    };

    this.batches.set(batchId, batch);
    return batch;
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
