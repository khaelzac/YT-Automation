import { env } from '../../config/env';

type VideoPromptConfig = {
  prompt: string;
  duration?: number;
  aspectRatio?: string;
  resolution?: string;
};

const videoPromptByNiche: Record<string, VideoPromptConfig> = {
  'street food vendor at night in manila': {
    prompt: [
      'Create a 10-second cinematic video.',
      '',
      'Scene: street food vendor at night in Manila',
      'Style: realistic, dramatic lighting, smooth camera movement',
      'Subject: fried chicken being cooked in reused oil',
      'Action: oil bubbling dark and thick',
      'Mood: slightly disturbing',
      '',
      'Voiceover (natural, engaging, short):',
      '"Did you know? Reused cooking oil can increase the risk of heart disease."',
      '',
      'Requirements:',
      '- Hook in first 2 seconds',
      '- Fast pacing',
      '- Clear subject focus',
      '- No subtitles unless specified',
      '- Vertical format (9:16)'
    ].join('\n'),
    duration: 10,
    aspectRatio: '9:16',
    resolution: '720p'
  }
};

function normalizeNiche(value: string): string {
  return value.trim().toLowerCase();
}

function resolveVideoPrompt(script: string, niche: string): VideoPromptConfig {
  const normalized = normalizeNiche(niche);
  return videoPromptByNiche[normalized] ?? { prompt: script };
}

export type VideoGenerationStart =
  | { requestId: string }
  | { placeholderUrl: string };

export async function startVideoGeneration(script: string, niche: string): Promise<VideoGenerationStart> {
  const apiKey = env.XAI_API_KEY || env.VIDEO_PROVIDER_API_KEY;
  if (!apiKey) {
    return { placeholderUrl: `https://video-assets.local/${encodeURIComponent(niche)}/${Date.now()}.mp4` };
  }

  const config = resolveVideoPrompt(script, niche);

  const payload: {
    model: string;
    prompt: string;
    duration?: number;
    aspect_ratio?: string;
    resolution?: string;
  } = {
    model: env.XAI_VIDEO_MODEL,
    prompt: config.prompt
  };

  if (config.duration) payload.duration = config.duration;
  if (config.aspectRatio) payload.aspect_ratio = config.aspectRatio;
  if (config.resolution) payload.resolution = config.resolution;

  const response = await fetch('https://api.x.ai/v1/videos/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`xAI video generation failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as { request_id?: string };
  if (!data.request_id) {
    throw new Error('xAI video generation returned no request_id');
  }

  return { requestId: data.request_id };
}

export async function getVideoGenerationStatus(requestId: string, apiKey?: string) {
  const token = apiKey || env.XAI_API_KEY || env.VIDEO_PROVIDER_API_KEY;
  if (!token) {
    throw new Error('Missing video provider API key');
  }

  const result = await fetch(`https://api.x.ai/v1/videos/${requestId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!result.ok) {
    const body = await result.text();
    throw new Error(`xAI video status failed: ${result.status} ${body}`);
  }

  const data = (await result.json()) as {
    status?: 'pending' | 'done' | 'expired' | string;
    video?: { url?: string };
  };

  if (data.status === 'done' && !data.video?.url) {
    throw new Error('xAI video status returned done without a video URL');
  }

  return {
    status: data.status ?? 'pending',
    url: data.video?.url
  };
}
