import { describe, expect, it } from 'vitest';
import { htmlToText, isPrivateAddress, pickProjectLinks } from '@/lib/import/page-text';

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    'not-an-ip',
  ])('blocks %s', (ip) => expect(isPrivateAddress(ip)).toBe(true));
  it.each(['8.8.8.8', '172.32.0.1', '76.76.21.21', '2606:4700::1111'])('allows %s', (ip) =>
    expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe('pickProjectLinks', () => {
  const html = `<html><body>
    <a href="/">Home</a>
    <a href="/projects/tutor-bot">Tutor bot</a>
    <a href="/projects/tutor-bot#top">dup</a>
    <a href="https://example.com/work/payments/">Payments case study</a>
    <a href="/about">About me</a>
    <a href="/blog/2024/random-post">Post</a>
    <a href="https://other.com/projects/x">external</a>
    <a href="/resume.pdf">PDF</a>
    <a href="mailto:me@example.com">mail</a>
    <a href="/login">login</a>
  </body></html>`;

  it('keeps same-site project pages first and drops externals, assets and dupes', () => {
    const links = pickProjectLinks(html, 'https://example.com/');
    expect(links.slice(0, 2).sort()).toEqual([
      'https://example.com/projects/tutor-bot',
      'https://example.com/work/payments/',
    ]);
    expect(links).not.toContain('https://other.com/projects/x');
    expect(
      links.some((l) => l.endsWith('.pdf') || l.includes('login') || l.includes('mailto')),
    ).toBe(false);
    expect(links.filter((l) => l.includes('tutor-bot'))).toHaveLength(1);
    expect(links).not.toContain('https://example.com/');
  });

  it('respects the cap', () =>
    expect(pickProjectLinks(html, 'https://example.com/', 1)).toHaveLength(1));
});

describe('htmlToText', () => {
  it('extracts readable text without running scripts', () => {
    const page = htmlToText(
      `<html><head><title>Priya — Work</title><script>document.body.innerHTML='HACKED'</script></head>
       <body><nav>Menu</nav><main><h1>Tutor bot</h1><p>${'I built an AI tutor used by 12,000 students. '.repeat(10)}</p></main></body></html>`,
      'https://example.com/',
    );
    expect(page.title).toContain('Priya');
    expect(page.text).toContain('12,000 students');
    expect(page.text).not.toContain('HACKED');
  });
});
