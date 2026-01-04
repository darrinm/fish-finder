export interface Timestamp {
  start: number;
  end: number;
}

export interface IdentifiedSpecies {
  commonName: string;
  scientificName: string;
  confidence: number;
  timestamps: Timestamp[];
  habitat: string;
  description: string;
  frameFiles?: string[];
}

export interface FishFinderResult {
  video: string;
  duration: number;
  identifiedSpecies: IdentifiedSpecies[];
  summary: string;
  analyzedAt: string;
}

export type Provider = 'gemini' | 'openai';

export interface AnalyzeOptions {
  output: 'json' | 'text';
  extractFrames?: string;
  model: string;
  verbose: boolean;
  fps?: number;
  provider: Provider;
}

export interface GeminiAnalysisResponse {
  species: Array<{
    common_name: string;
    scientific_name: string;
    confidence: number;
    timestamps: Array<{ start: number; end: number }>;
    habitat: string;
    description: string;
  }>;
  summary: string;
  video_duration_seconds: number;
}

export interface BoundingBox {
  ymin: number;  // 0-1 normalized
  xmin: number;
  ymax: number;
  xmax: number;
  confidence?: number;  // 0-1
  label?: string;       // species name
}
