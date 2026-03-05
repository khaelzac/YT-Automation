export type MetadataResult = {
  title: string;
  description: string;
  tags: string[];
};

function extractSection(text: string, section: 'TITLE' | 'HOOK' | 'SCRIPT' | 'CTA'): string | null {
  const regex = new RegExp(`${section}:\\s*([\\s\\S]*?)(?=\\n(?:TITLE|HOOK|SCRIPT|CTA):\\s*|$)`, 'i');
  const match = text.match(regex);
  return match?.[1]?.trim() || null;
}

export function generateMetadata(script: string, niche: string): MetadataResult {
  const lines = script
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const parsedTitle = extractSection(script, 'TITLE')?.replace(/^title:\s*/i, '').trim();
  const parsedHook = extractSection(script, 'HOOK');
  const parsedScriptBody = extractSection(script, 'SCRIPT');

  const core = (parsedTitle || lines[0] || 'Must-Watch Story').slice(0, 70);
  const title = `${core} | ${niche}`.slice(0, 95);

  const description = [
    `Niche: ${niche}`,
    '',
    [parsedHook, parsedScriptBody].filter(Boolean).join('\n\n').slice(0, 3400) || lines.slice(0, 6).join(' '),
    '',
    'Subscribe for automated releases and weekly uploads.'
  ]
    .join('\n')
    .slice(0, 4000);

  const baseTags = [niche.toLowerCase(), 'youtube automation', 'ai video'];
  const extracted = Array.from(
    new Set(
      script
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length > 4)
        .slice(0, 12)
    )
  );

  return {
    title,
    description,
    tags: Array.from(new Set([...baseTags, ...extracted])).slice(0, 20)
  };
}
