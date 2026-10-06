import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

import { test, expect } from '@playwright/test';
import { deepmerge, deepmergeCustom } from 'deepmerge-ts';
import { convert } from 'html-to-text';
import Sanscript from '@indic-transliteration/sanscript';

const require = createRequire(import.meta.url);
const sanscriptRequire = createRequire(
  require.resolve('@indic-transliteration/sanscript'),
);
const toml = sanscriptRequire('toml');

test('patched merge preserves configuration defaults, overrides and input ownership', () => {
  const defaults = {
    enabled: false,
    preferredProvider: 'LRCLib',
    nested: { keep: true, value: 1 },
    list: ['default'],
  };
  const saved = { enabled: true, nested: { value: 2 }, list: ['saved'] };
  const update = {
    preferredProvider: 'auto',
    nested: { value: 3 },
    list: ['new'],
  };
  const before = structuredClone([defaults, saved, update]);
  expect(deepmerge(defaults, saved, update)).toEqual({
    enabled: true,
    preferredProvider: 'auto',
    nested: { keep: true, value: 3 },
    list: ['default', 'saved', 'new'],
  });
  expect(
    deepmergeCustom({ mergeArrays: false })(defaults, saved, update),
  ).toEqual({
    enabled: true,
    preferredProvider: 'auto',
    nested: { keep: true, value: 3 },
    list: ['new'],
  });
  expect([defaults, saved, update]).toEqual(before);
  expect(deepmerge({ value: 1 }, { value: undefined })).toEqual({ value: 1 });
  expect(deepmerge({ value: 1 }, { value: null })).toEqual({ value: null });
});

test('html-to-text uses patched merge and preserves nested formatter options', () => {
  const htmlRequire = createRequire(require.resolve('html-to-text'));
  expect(htmlRequire.resolve('deepmerge-ts')).toBe(
    require.resolve('deepmerge-ts'),
  );
  expect(
    convert('<p>Hello <b>world</b>.</p><p>Next &amp; last.</p>', {
      wordwrap: false,
    }),
  ).toBe('Hello world.\n\nNext & last.');
  expect(
    convert('<p>Keep <a href="https://fixture.invalid/">label</a>.</p>', {
      selectors: [{ selector: 'a', options: { ignoreHref: true } }],
    }),
  ).toBe('Keep label.');
});

test('patched TOML retains all 84 installed transliteration map contracts', () => {
  const root = path.dirname(
    sanscriptRequire.resolve('@indic-transliteration/common_maps/package.json'),
  );
  const maps = {};
  for (const directory of ['brahmic', 'roman']) {
    for (const file of readdirSync(path.join(root, directory))) {
      maps[`${directory}/${file}`] = toml.parse(
        readFileSync(path.join(root, directory, file)),
      );
    }
  }
  maps['_devanagari_vowel_to_marks.toml'] = toml.parse(
    readFileSync(path.join(root, '_devanagari_vowel_to_marks.toml')),
  );
  const canonical = (value) =>
    value && typeof value === 'object'
      ? Array.isArray(value)
        ? value.map(canonical)
        : Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical(value[key])]),
          )
      : value;
  expect(Object.keys(maps)).toHaveLength(84);
  // Baseline from toml 2.3.6, with its erroneous "undefined" skip key corrected
  // to the actual empty TOML key. No other map contents may change.
  expect(
    createHash('sha256')
      .update(JSON.stringify(canonical(maps)))
      .digest('hex'),
  ).toBe('ea438463d220f8b27cfb88866b0c9871c5bb814f08490d3192af3361f845ad2d');
  expect(toml.parse('[skip]\n"" = ""').skip).toEqual({ '': '' });
  expect(() => toml.parse('key = [')).toThrow();
  expect(Sanscript.t('नमस्ते', 'devanagari', 'iast')).toBe('namaste');
  expect(Sanscript.t('namaste', 'iast', 'devanagari')).toBe('नमस्ते');
});

test('recursive merge and malicious TOML are bounded without prototype corruption', () => {
  // Keep security payloads isolated and time-bounded even if a vulnerable version
  // is accidentally restored. Use JSON literals for portable Windows paths.
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `
    const assert = require('node:assert/strict');
    const { deepmerge, deepmergeCustom } = require(${JSON.stringify(require.resolve('deepmerge-ts'))});
    for (const merge of [deepmerge, deepmergeCustom({ mergeArrays: false })]) {
      const a = { name: 'first' }, b = { name: 'last' }; a.self = a; b.self = b;
      const merged = merge(a, b);
      assert.equal(merged.name, 'last'); assert.equal(merged.self, merged);
    }
    const toml = require(${JSON.stringify(sanscriptRequire.resolve('toml'))});
    for (const source of [
      '[a.b]\\ny = 1\\n[a.b.y.__proto__.__proto__]\\npearFixturePolluted = "yes"',
      'aa = 1\\n[[a]]\\n[aa.__proto__.__proto__]\\npearFixturePolluted = "yes"',
      '[a.b]\\ny = 1\\n[a.b.y.__proto__.__proto__.pearFixturePolluted]\\nval = "yes"'
    ]) {
      assert.throws(() => toml.parse(source));
      assert.equal(Object.hasOwn(Object.prototype, 'pearFixturePolluted'), false);
    }
    for (const source of ['a=' + '['.repeat(3000) + '1' + ']'.repeat(3000),
      'a=' + '{a='.repeat(3000) + '1' + '}'.repeat(3000)]) {
      assert.throws(() => toml.parse(source), error => !(error instanceof RangeError) && /nesting depth/i.test(error.message) && Number.isInteger(error.line));
    }
    console.log('security regressions passed');
  `,
    ],
    { timeout: 5000, encoding: 'utf8', maxBuffer: 65536 },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe('security regressions passed');
});
