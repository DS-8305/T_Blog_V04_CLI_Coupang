export type ProfileResult = {
  latestInfoDate: string; title: string; body: string; tags: string[];
  sources: Array<{ name: string; title: string; date: string; url: string }>;
  reviewMemo?: string;
};

export function parseProfileResult(value: unknown): ProfileResult {
  const r = value as ProfileResult | null;
  const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
  const date = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
  if (!r || !date(r.latestInfoDate) || !text(r.title) || !text(r.body)
    || !Array.isArray(r.tags) || !r.tags.length || !r.tags.every(text)
    || !Array.isArray(r.sources) || !r.sources.length || !r.sources.every(s => s && text(s.name) && text(s.title)
      && (s.date === '' || date(s.date)) && typeof s.url === 'string' && /^https?:\/\//.test(s.url) && URL.canParse(s.url))
    || (r.reviewMemo !== undefined && typeof r.reviewMemo !== 'string')) {
    throw new Error('Invalid profile-result.json: date, title, body, tags and source metadata are required.');
  }
  return r;
}

export function formatProfileSources(sources: ProfileResult['sources']): string {
  return sources.map(s => [s.name,s.title,s.date,s.url].filter(Boolean).join(' | ')).join('\n');
}

export function profileBodyText(content: string): string {
  return content.replace(/\[TITLE\][\s\S]*?\[\/TITLE\]/g, '')
    .replace(/\[\/?(?:H2|BOLD)\]|\[HR\]|\[IMAGE:[^\]]+\]/g, '').replace(/\r\n/g,'\n').trim();
}
