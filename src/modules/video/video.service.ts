import { env } from '../../config/env';

export async function generateVideoFromScript(script: string, niche: string): Promise<string> {
  if (!env.VIDEO_PROVIDER_API_KEY) {
    return `https://video-assets.local/${encodeURIComponent(niche)}/${Date.now()}.mp4`;
  }

  // Replace this adapter with your selected provider contract.
  const response = await fetch('https://api.video-provider.example/v1/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.VIDEO_PROVIDER_API_KEY}`
    },
    body: JSON.stringify({
      script,
      style: niche
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Video generation failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as { assetUrl?: string };
  if (!data.assetUrl) {
    throw new Error('Video generation returned no asset URL');
  }

  return data.assetUrl;
}
