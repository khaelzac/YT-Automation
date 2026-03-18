import { env } from '../../config/env';
import { fetchWithTimeout } from '../../lib/fetch-timeout';

const MIN_SCRIPT_WORDS = 1400;
const MAX_SCRIPT_WORDS = 2000;
const MAX_RETRIES = 1;

const nichePrompts: Record<string, string> = {
  horror: 'Write a suspenseful horror narration with escalating tension and a chilling payoff.',
  finance: 'Write a concise personal-finance educational script with practical advice and examples.',
  motivation: 'Write an energetic motivational script with a strong hook and actionable takeaway.',
  tech: 'Write a crisp tech explainer with current context, clarity, and practical relevance.'
};

type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function tokenizeTitle(title: string): string[] {
  return normalizeTitle(title).split(' ').filter(Boolean);
}

function titlesAreTooSimilar(a: string, b: string): boolean {
  const normalizedA = normalizeTitle(a);
  const normalizedB = normalizeTitle(b);

  if (!normalizedA || !normalizedB) return false;
  if (normalizedA === normalizedB) return true;
  if (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA)) return true;

  const tokensA = new Set(tokenizeTitle(a));
  const tokensB = new Set(tokenizeTitle(b));
  if (tokensA.size === 0 || tokensB.size === 0) return false;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection += 1;
  }

  const overlap = intersection / Math.max(tokensA.size, tokensB.size);
  return overlap >= 0.7;
}

function extractSection(text: string, section: 'TITLE' | 'HOOK' | 'SCRIPT' | 'CTA'): string | null {
  const regex = new RegExp(`${section}:\\s*([\\s\\S]*?)(?=\\n(?:TITLE|HOOK|SCRIPT|CTA):\\s*|$)`, 'i');
  const match = text.match(regex);
  return match?.[1]?.trim() || null;
}

function hasRequiredFormat(text: string): boolean {
  return (
    /^TITLE:\s*\S+/im.test(text) &&
    /^HOOK:\s*\S+/im.test(text) &&
    /^SCRIPT:\s*\S+/im.test(text) &&
    /^CTA:\s*\S+/im.test(text)
  );
}

function hasTitlePipeFormat(title: string): boolean {
  const parts = title.split('|').map((part) => part.trim()).filter(Boolean);
  return parts.length === 2;
}

function sentenceCount(text: string): number {
  return text
    .split(/[.!?](?:\s|$)/)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

function getValidationIssues(text: string, previousTitles: string[]): string[] {
  const issues: string[] = [];

  if (!hasRequiredFormat(text)) {
    issues.push('Use the exact required format with TITLE, HOOK, SCRIPT, CTA labels.');
  }

  const title = extractSection(text, 'TITLE');
  const scriptBody = extractSection(text, 'SCRIPT');
  const scriptWords = scriptBody ? countWords(scriptBody) : 0;

  if (!title) {
    issues.push('TITLE must be present and non-empty.');
  } else {
    if (!hasTitlePipeFormat(title)) {
      issues.push('TITLE must be in this exact format: Main Curiosity Title | Secondary SEO Title.');
    }

    const isRepeatedOrSimilar = previousTitles.some((previous) => titlesAreTooSimilar(previous, title));
    if (isRepeatedOrSimilar) {
      issues.push('TITLE is repeated or too similar to a previous title. Create a fully new concept and title.');
    }
  }

  const hook = extractSection(text, 'HOOK');
  if (!hook) {
    issues.push('HOOK must be present and non-empty.');
  } else {
    const hookSentences = sentenceCount(hook);
    if (hookSentences < 2 || hookSentences > 4) {
      issues.push(`HOOK must be 2-4 sentences. Current sentence count: ${hookSentences}.`);
    }
  }

  if (!scriptBody) {
    issues.push('SCRIPT must be present and non-empty.');
  } else if (scriptWords < MIN_SCRIPT_WORDS) {
    issues.push(
      `SCRIPT is too short (${scriptWords} words). Expand to ${MIN_SCRIPT_WORDS}-${MAX_SCRIPT_WORDS} words.`
    );
  } else if (scriptWords > MAX_SCRIPT_WORDS) {
    issues.push(
      `SCRIPT is too long (${scriptWords} words). Keep it within ${MIN_SCRIPT_WORDS}-${MAX_SCRIPT_WORDS} words.`
    );
  }

  return issues;
}

export function validateGeneratedScript(text: string, previousTitles: string[] = []) {
  const scriptBody = extractSection(text, 'SCRIPT');
  const scriptWords = scriptBody ? countWords(scriptBody) : 0;
  const issues = getValidationIssues(text, previousTitles);

  return {
    valid: issues.length === 0,
    scriptWords,
    issues
  };
}

async function createCompletion(messages: ChatMessage[], timeoutMs: number): Promise<string> {
  const response = await fetchWithTimeout(
    'https://api.groq.com/openai/v1/chat/completions',
    {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: env.GROQ_MODEL,
      temperature: 0.8,
      max_tokens: env.GROQ_MAX_TOKENS,
      messages
    })
    },
    timeoutMs
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Groq script generation failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return data.choices?.[0]?.message?.content?.trim() || 'Unable to generate script.';
}

export async function generateScript(
  niche: string,
  previousTitles: string[] = [],
  timeoutMs = env.GROQ_REQUEST_TIMEOUT_MS
): Promise<string> {
  const normalizedNiche = niche.trim().toLowerCase();
  const basePrompt =
    nichePrompts[normalizedNiche] ??
    `Write a YouTube script for ${niche} with strong storytelling and retention beats.`;

  const previousTitlesBlock =
    previousTitles.length > 0
      ? [
          'Previously used titles (forbidden to repeat or closely resemble):',
          ...previousTitles.slice(0, 25).map((title) => `- ${title}`)
        ].join('\n')
      : 'No previous titles were provided.';

  const system = [
    'You are a professional YouTube automation scriptwriter.',
    '',
    'Your task is to generate a HIGH-RETENTION YouTube script that is at least 10 minutes long when narrated.',
    '',
    'STRICT REQUIREMENTS:',
    `1. The SCRIPT must be between ${MIN_SCRIPT_WORDS}-${MAX_SCRIPT_WORDS} words. If shorter, regenerate internally before responding.`,
    '2. TITLE format must be exactly: Main Curiosity Title | Secondary SEO Title.',
    '3. The title must be unique, click-worthy, non-repetitive, and not reused.',
    '4. Script must be structured for narration, emotionally engaging, include pattern interrupts, storytelling, and psychological hooks.',
    '5. Avoid generic AI phrasing and avoid repeating structures from past outputs. Use natural human tone.',
    '6. Output must follow the exact format below.',
    '7. Do not mention being an AI.',
    '8. Do not shorten the script.',
    '9. If output is incomplete due to limits, continue until complete.',
    '',
    'If previous titles are provided, generate a completely different title and concept.',
    '',
    `Topic/Niche: ${niche}.`,
    `Creative direction: ${basePrompt}`,
    `Target runtime: over 10 minutes (${MIN_SCRIPT_WORDS}-${MAX_SCRIPT_WORDS} words in SCRIPT section).`,
    'Do not copy examples, statistics, analogies, or hooks from earlier outputs.',
    previousTitlesBlock,
    '',
    'OUTPUT FORMAT:',
    '',
    'TITLE:',
    '<Main Curiosity Title | Secondary SEO Title>',
    '',
    'HOOK:',
    '<Emotional high-retention intro, 2-4 sentences>',
    '',
    'SCRIPT:',
    `<Full 10+ minute script, ${MIN_SCRIPT_WORDS}-${MAX_SCRIPT_WORDS} words>`,
    '',
    'CTA:',
    '<Strong call to action>'
  ].join('\n');

  if (!env.GROQ_API_KEY) {
    return [
      'TITLE:',
      `Inside the Quietest Fear | Why Silence Is the Loudest Warning`,
      '',
      'HOOK:',
      'A strange signal arrives at midnight, and everyone who hears it vanishes before dawn.',
      'Only one witness remains to explain what waited in the dark.',
      '',
      'SCRIPT:',
      `Groq API key is missing. Add GROQ_API_KEY to generate a ${MIN_SCRIPT_WORDS}+ word script.`,
      '',
      'CTA:',
      'If you want Part 2, comment your theory and subscribe for the next upload.'
    ].join('\n');
  }

  let messages: ChatMessage[] = [
    {
      role: 'system',
      content: system
    },
    {
      role: 'user',
      content: `Generate a new script for the ${niche} niche.`
    }
  ];

  let lastOutput = '';
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    lastOutput = await createCompletion(messages, timeoutMs);
    const issues = getValidationIssues(lastOutput, previousTitles);

    if (issues.length === 0) {
      return lastOutput;
    }

    messages = [
      ...messages,
      {
        role: 'assistant',
        content: lastOutput
      },
      {
        role: 'user',
        content: `Regenerate from scratch and fix all issues:\n- ${issues.join('\n- ')}`
      }
    ];
  }

  return lastOutput;
}
