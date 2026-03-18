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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollForVideoUrl(requestId: string, apiKey: string): Promise<string> {
  const pollIntervalMs = 5000;
  const timeoutMs = 180000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await fetch(`https://api.x.ai/v1/videos/${requestId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`
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

    if (data.status === 'done') {
      if (!data.video?.url) {
        throw new Error('xAI video status returned done without a video URL');
      }
      return data.video.url;
    }

    if (data.status === 'expired') {
      throw new Error('xAI video generation request expired');
    }

    await sleep(pollIntervalMs);
  }

  throw new Error('xAI video generation timed out');
}

export async function generateVideoFromScript(script: string, niche: string): Promise<string> {
  const apiKey = env.XAI_API_KEY || env.VIDEO_PROVIDER_API_KEY;
  if (!apiKey) {
    return `https://video-assets.local/${encodeURIComponent(niche)}/${Date.now()}.mp4`;
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

  return pollForVideoUrl(data.request_id, apiKey);
}
