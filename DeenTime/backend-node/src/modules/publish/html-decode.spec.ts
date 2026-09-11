import { describe, expect, it } from 'vitest';
import { htmlDecode, stripHtml } from './html-decode.js';

describe('htmlDecode', () => {
  it('decodes named and numeric references like WebUtility.HtmlDecode', () => {
    expect(htmlDecode('&copy; &#169; &#xA9; &#x1F600; &yuml; &middot;&nbsp;&apos;&quot;&lt;&gt;')).toBe('© © © 😀 ÿ · \'"<>');
    expect(htmlDecode('&lang;&rang; &euro; &hellip;')).toBe('〈〉 € …');
  });

  it('leaves unknown, malformed and out-of-range references untouched', () => {
    expect(htmlDecode('&unknown; &; &#; &#xyz; &#55296; &#1114112; &amp')).toBe('&unknown; &; &#; &#xyz; &#55296; &#1114112; &amp');
    expect(htmlDecode('a && b &amp;&amp; &Amp;')).toBe('a && b && &Amp;');
    expect(htmlDecode('no entities')).toBe('no entities');
  });
});

describe('stripHtml', () => {
  it('replaces tags with spaces, decodes entities and trims', () => {
    expect(stripHtml('<p>Assalamu &amp; <b>welcome</b> &copy; 2026</p>')).toBe('Assalamu &  welcome  © 2026');
    expect(stripHtml('  © 2026 Demo Mosque · IqamaTime  ')).toBe('© 2026 Demo Mosque · IqamaTime');
    expect(stripHtml('<br/>')).toBe('');
  });

  it('returns an empty string for missing or blank footers', () => {
    expect(stripHtml(null)).toBe('');
    expect(stripHtml(undefined)).toBe('');
    expect(stripHtml('   ')).toBe('');
  });
});
