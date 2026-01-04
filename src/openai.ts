import OpenAI from 'openai';
import type { GeminiAnalysisResponse } from './types.js';

let client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (client) return client;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY environment variable is required for GPT-5 models.\n' +
      'Get your API key at: https://platform.openai.com/api-keys'
    );
  }

  client = new OpenAI({ apiKey });
  return client;
}

export async function analyzeWithOpenAI(
  frames: string[],
  model: string,
  verbose: boolean = false,
  videoDurationSeconds: number
): Promise<GeminiAnalysisResponse> {
  const openai = getOpenAIClient();

  const prompt = `You are an expert marine biologist analyzing frames from a diving video. The frames are extracted at regular intervals from a ${videoDurationSeconds} second video. Identify all marine species visible across these frames, including fish, invertebrates (lobsters, crabs, shrimp, octopus, nudibranchs, sea slugs, jellyfish, anemones, sea stars, urchins), marine mammals, sea turtles, and any other identifiable marine life.

For each species you identify, provide:
1. Common name
2. Scientific name
3. Confidence level (0.0 to 1.0)
4. Approximate timestamps (in seconds) when the species appears based on frame positions
5. Typical habitat description
6. Brief description of the species' appearance

Respond ONLY with valid JSON in this exact format:
{
  "species": [
    {
      "common_name": "Clownfish",
      "scientific_name": "Amphiprion ocellaris",
      "confidence": 0.95,
      "timestamps": [{"start": 12, "end": 18}, {"start": 45, "end": 52}],
      "habitat": "Coral reefs in the Indo-Pacific region, typically found among sea anemones",
      "description": "Orange body with three white vertical bands outlined in black"
    }
  ],
  "summary": "Brief summary of all marine life observed in the video",
  "video_duration_seconds": ${videoDurationSeconds}
}

If no marine life is visible, return an empty species array. Be thorough but only identify species you can see clearly.`;

  if (verbose) {
    const totalSizeKB = frames.reduce((sum, f) => sum + f.length * 0.75, 0) / 1024;
    console.log(`Analyzing ${frames.length} frames (${(totalSizeKB / 1024).toFixed(1)} MB) with model: ${model}`);
  }

  const startTime = Date.now();

  const imageContent = frames.map((base64Data, index) => ({
    type: 'image_url' as const,
    image_url: {
      url: `data:image/jpeg;base64,${base64Data}`,
      detail: 'low' as const,
    },
  }));

  const response = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...imageContent,
        ],
      },
    ],
    max_completion_tokens: 16384,
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  if (verbose) {
    console.log(`API response in ${elapsed}s`);
  }

  const choice = response.choices[0];
  if (!choice) {
    throw new Error(`No response from OpenAI. Response: ${JSON.stringify(response)}`);
  }

  const text = choice.message?.content;
  if (!text) {
    throw new Error(`Empty content from OpenAI. Finish reason: ${choice.finish_reason}, Message: ${JSON.stringify(choice.message)}`);
  }

  // Extract JSON from response (handle potential markdown code blocks)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not parse JSON response from OpenAI');
  }

  try {
    return JSON.parse(jsonMatch[0]) as GeminiAnalysisResponse;
  } catch {
    throw new Error(`Invalid JSON in OpenAI response: ${text}`);
  }
}
