import { describe, expect, it } from 'vitest';
import { parseBraveSearchHtml, parseDuckDuckGoHtml } from '../../agent/tools/web-search.js';

describe('DuckDuckGo keyless web-search parsing', () => {
  it('returns decoded source pages and snippets from the HTML results page', () => {
    const html = `
      <div class="result results_links">
        <h2><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnaruto.example%2FKiller_Bee&amp;rut=abc">Killer Bee &amp; Gyuki</a></h2>
        <a class="result__snippet" href="https://naruto.example/Killer_Bee">Killer Bee is the Eight-Tails&#39; jinchuriki.</a>
      </div>
      <div class="result results_links">
        <h2><a class="result__a" href="https://example.org/second">Second source</a></h2>
        <div class="result__snippet">Independent profile and episode guide.</div>
      </div>`;

    expect(parseDuckDuckGoHtml(html, 5)).toEqual([
      {
        title: 'Killer Bee & Gyuki',
        url: 'https://naruto.example/Killer_Bee',
        content: "Killer Bee is the Eight-Tails' jinchuriki.",
      },
      {
        title: 'Second source',
        url: 'https://example.org/second',
        content: 'Independent profile and episode guide.',
      },
    ]);
  });

  it('returns source pages from Brave server-rendered snippets', () => {
    const html = `
      <div class="snippet dynamic" data-pos="0" data-type="web">
        <a href="https://naruto.example/killer-b" class="result-link">
          <div class="title search-snippet-title line-clamp-1">Killer B | Narutopedia</div>
        </a>
        <div class="generic-snippet"><div class="content desktop-default">Killer B is a shinobi from Kumogakure.</div></div>
      </div>`;

    expect(parseBraveSearchHtml(html, 5)).toEqual([{
      title: 'Killer B | Narutopedia',
      url: 'https://naruto.example/killer-b',
      content: 'Killer B is a shinobi from Kumogakure.',
    }]);
  });
});
