import type { FishFinderResult } from './types.js';

export function formatJson(result: FishFinderResult): string {
  return JSON.stringify(result, null, 2);
}

export function formatText(result: FishFinderResult): string {
  const lines: string[] = [];

  lines.push(`Fish Finder Analysis`);
  lines.push(`${'='.repeat(50)}`);
  lines.push(`Video: ${result.video}`);
  lines.push(`Duration: ${formatDuration(result.duration)}`);
  lines.push(`Analyzed: ${result.analyzedAt}`);
  lines.push('');

  if (result.identifiedSpecies.length === 0) {
    lines.push('No marine species identified in this video.');
  } else {
    lines.push(`Species Identified: ${result.identifiedSpecies.length}`);
    lines.push('-'.repeat(50));

    for (const species of result.identifiedSpecies) {
      lines.push('');
      lines.push(`${species.commonName} (${species.scientificName})`);
      lines.push(`  Confidence: ${(species.confidence * 100).toFixed(0)}%`);
      lines.push(`  Appears at: ${formatTimestamps(species.timestamps)}`);
      lines.push(`  Habitat: ${species.habitat}`);
      lines.push(`  Description: ${species.description}`);
      if (species.frameFiles && species.frameFiles.length > 0) {
        lines.push(`  Frames saved: ${species.frameFiles.length}`);
        for (const frame of species.frameFiles) {
          lines.push(`    - ${frame}`);
        }
      }
    }
  }

  lines.push('');
  lines.push('-'.repeat(50));
  lines.push(`Summary: ${result.summary}`);

  return lines.join('\n');
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function formatTimestamps(timestamps: Array<{ start: number; end: number }>): string {
  return timestamps
    .map(t => `${formatDuration(t.start)}-${formatDuration(t.end)}`)
    .join(', ');
}

export function formatBatchSummary(results: FishFinderResult[]): string {
  const lines: string[] = [];
  const allSpecies = new Map<string, number>();

  for (const result of results) {
    for (const species of result.identifiedSpecies) {
      const key = species.scientificName;
      allSpecies.set(key, (allSpecies.get(key) || 0) + 1);
    }
  }

  lines.push('');
  lines.push('Batch Analysis Complete');
  lines.push('='.repeat(50));
  lines.push(`Videos analyzed: ${results.length}`);
  lines.push(`Unique species found: ${allSpecies.size}`);

  if (allSpecies.size > 0) {
    lines.push('');
    lines.push('Species frequency:');
    const sorted = [...allSpecies.entries()].sort((a, b) => b[1] - a[1]);
    for (const [species, count] of sorted) {
      lines.push(`  ${species}: ${count} video(s)`);
    }
  }

  return lines.join('\n');
}
