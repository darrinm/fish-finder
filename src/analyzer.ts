import { mkdir } from 'node:fs/promises';
import { uploadVideo, analyzeVideo } from './gemini.js';
import { analyzeWithOpenAI } from './openai.js';
import { extractFrame, extractFramesAsBase64, checkFfmpeg } from './video.js';
import type { FishFinderResult, IdentifiedSpecies, AnalyzeOptions, GeminiAnalysisResponse, AnalysisTiming } from './types.js';

interface AnalysisWithTiming {
  analysis: GeminiAnalysisResponse;
  timing: Partial<AnalysisTiming>;
}

export async function analyzeVideoFile(
  videoPath: string,
  options: AnalyzeOptions
): Promise<FishFinderResult> {
  const { provider } = options;
  const totalStart = Date.now();

  // Route to appropriate provider
  const { analysis, timing } = provider === 'openai'
    ? await analyzeWithOpenAIProvider(videoPath, options)
    : await analyzeWithGeminiProvider(videoPath, options);

  // Transform response to our format
  const identifiedSpecies: IdentifiedSpecies[] = analysis.species.map(s => ({
    commonName: s.common_name,
    scientificName: s.scientific_name,
    confidence: s.confidence,
    timestamps: s.timestamps,
    habitat: s.habitat,
    description: s.description,
  }));

  // Extract frames if requested
  let frameExtractionMs: number | undefined;
  if (options.extractFrames && identifiedSpecies.length > 0) {
    const frameStart = Date.now();
    await extractSpeciesFrames(videoPath, identifiedSpecies, options);
    frameExtractionMs = Date.now() - frameStart;
  }

  const totalMs = Date.now() - totalStart;

  return {
    video: videoPath,
    duration: analysis.video_duration_seconds,
    identifiedSpecies,
    summary: analysis.summary,
    analyzedAt: new Date().toISOString(),
    timing: {
      ...timing,
      frameExtractionMs,
      totalMs,
    } as AnalysisTiming,
  };
}

async function analyzeWithGeminiProvider(
  videoPath: string,
  options: AnalyzeOptions
): Promise<AnalysisWithTiming> {
  const { model, verbose, fps } = options;

  // Upload video to Gemini
  const uploadStart = Date.now();
  const { uri, mimeType } = await uploadVideo(videoPath, verbose);
  const uploadMs = Date.now() - uploadStart;

  // Analyze with Gemini
  const analysisStart = Date.now();
  const analysis = await analyzeVideo(uri, mimeType, model, verbose, fps);
  const analysisMs = Date.now() - analysisStart;

  return {
    analysis,
    timing: { uploadMs, analysisMs },
  };
}

async function analyzeWithOpenAIProvider(
  videoPath: string,
  options: AnalyzeOptions
): Promise<AnalysisWithTiming> {
  const { model, verbose, fps = 1 } = options;

  // Extract frames locally
  const extractStart = Date.now();
  const { frames, duration } = await extractFramesAsBase64(videoPath, fps, verbose);
  const extractFramesMs = Date.now() - extractStart;

  // Analyze with OpenAI
  const analysisStart = Date.now();
  const analysis = await analyzeWithOpenAI(frames, model, verbose, duration);
  const analysisMs = Date.now() - analysisStart;

  return {
    analysis,
    timing: { extractFramesMs, analysisMs },
  };
}

async function extractSpeciesFrames(
  videoPath: string,
  identifiedSpecies: IdentifiedSpecies[],
  options: AnalyzeOptions
): Promise<void> {
  const { extractFrames, verbose } = options;
  if (!extractFrames) return;

  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) {
    console.warn(
      'Warning: ffmpeg not found, skipping frame extraction.\n' +
      'Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)'
    );
    return;
  }

  await mkdir(extractFrames, { recursive: true });

  for (const species of identifiedSpecies) {
    if (species.timestamps.length === 0) continue;

    const frameFiles: string[] = [];

    // Extract 1 frame per second over all intervals
    for (const interval of species.timestamps) {
      const start = Math.floor(interval.start);
      const end = Math.floor(interval.end);

      for (let sec = start; sec <= end; sec++) {
        try {
          const framePath = await extractFrame(
            videoPath,
            sec,
            extractFrames,
            species.commonName
          );
          frameFiles.push(framePath);
        } catch (error) {
          if (verbose) {
            console.warn(`Failed to extract frame at ${sec}s for ${species.commonName}:`, error);
          }
        }
      }
    }

    if (frameFiles.length > 0) {
      species.frameFiles = frameFiles;
      if (verbose) {
        console.log(`Extracted ${frameFiles.length} frames for ${species.commonName}`);
      }
    }
  }
}
