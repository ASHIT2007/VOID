import { describe, expect, it } from 'vitest';
import { mapDuckDuckGoImages, parseBraveImageHtml, relevantArticleFile } from '../../agent/tools/image-search.js';

describe('Wikipedia article image relevance', () => {
  it('rejects a single-word homonym linked from a multi-word entity article', () => {
    expect(relevantArticleFile('File:Naruto Whirlpools taken 4-21-2008.jpg', 'Naruto Uzumaki')).toBe(false);
  });

  it('accepts files that carry the complete entity identity', () => {
    expect(relevantArticleFile('File:NarutoUzumakiKishimoto.jpg', 'Naruto Uzumaki')).toBe(true);
    expect(relevantArticleFile('File:NarutoUzumakiPartIIKishimoto.jpg', 'Naruto Uzumaki')).toBe(true);
  });
});

describe('keyless web-image fallback mapping', () => {
  it('keeps attributable full-size images and rejects thumbnails without source pages', () => {
    const images = mapDuckDuckGoImages([
      {
        image: 'https://images.example/seven-swordsmen.jpg',
        thumbnail: 'https://proxy.example/seven-swordsmen-thumb.jpg',
        title: 'Seven Ninja Swordsmen of the Mist',
        url: 'https://example.com/seven-swordsmen',
        source: 'Example',
        width: 1600,
        height: 900,
      },
      {
        image: 'https://images.example/tiny.jpg',
        title: 'Tiny result',
        url: 'https://example.com/tiny',
        width: 100,
        height: 80,
      },
      {
        image: 'https://images.example/no-source.jpg',
        title: 'Missing source page',
        width: 1200,
        height: 800,
      },
    ], 'Seven Ninja Swordsmen of the Mist', 4);

    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      title: 'Seven Ninja Swordsmen of the Mist',
      sourceDomain: 'example.com',
      query: 'Seven Ninja Swordsmen of the Mist',
      fallbackUrl: 'https://proxy.example/seven-swordsmen-thumb.jpg',
    });
  });

  it('parses attributable original and proxy URLs from Brave image records', () => {
    const html = `results:[{title:"Killer Bee in Naruto",url:"https://naruto.example/killer-b",source:"naruto.example",thumbnail:{src:"https://imgs.search.brave.com/thumb",alt:null,height:300,width:500},properties:{url:"https://cdn.example/killer-b.webp",resized:"https://imgs.search.brave.com/resized",placeholder:"x",height:900,width:1600,format:null}}]`;
    expect(parseBraveImageHtml(html, 'Killer Bee Naruto', 4)).toEqual([expect.objectContaining({
      url: 'https://cdn.example/killer-b.webp',
      fallbackUrl: 'https://imgs.search.brave.com/resized',
      title: 'Killer Bee in Naruto',
      sourceUrl: 'https://naruto.example/killer-b',
      sourceDomain: 'naruto.example',
      width: 1600,
      height: 900,
    })]);
  });
});
