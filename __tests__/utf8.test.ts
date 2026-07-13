/**
 * @format
 *
 * The self-contained UTF-8 codec must round-trip arbitrary strings, including
 * multi-byte and non-BMP (emoji) characters, on every JS engine.
 */
import {bytesToUtf8, utf8ToBytes} from '../src/crypto/utf8';

describe('utf8 codec', () => {
  const cases: Array<[string, string]> = [
    ['empty', ''],
    ['ascii', 'hello world 123'],
    ['latin-1', 'café résumé'],
    ['cjk', '鉄道網'],
    ['emoji (surrogate pair)', 'recover 🛡️ me 👥'],
    ['json-ish', '{"nickname":"Mãe","n":5}'],
  ];

  test.each(cases)('round-trips %s', (_name, input) => {
    expect(bytesToUtf8(utf8ToBytes(input))).toBe(input);
  });

  test('encodes ASCII as one byte per char', () => {
    expect(utf8ToBytes('abc')).toEqual(Uint8Array.from([97, 98, 99]));
  });

  test('encodes multi-byte characters to their UTF-8 length', () => {
    // é is 2 bytes, 鉄 is 3 bytes, 🛡 is 4 bytes.
    expect(utf8ToBytes('é').length).toBe(2);
    expect(utf8ToBytes('鉄').length).toBe(3);
    expect(utf8ToBytes('🛡').length).toBe(4);
  });
});
