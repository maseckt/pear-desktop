import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { test, expect } from '@playwright/test';
import { build } from 'vite';

import { i18nImporter } from '../vite-plugins/i18n-importer.mts';
import { modulePath } from './helpers/module-path.js';

const root = path.resolve(import.meta.dirname, '..');

test('real generated loaders load only fallback/active locale, reject inherited keys, last selection wins', async ({}, testInfo) => {
  const output = testInfo.outputPath('fixture');
  const generated = i18nImporter();
  await build({
    configFile: false,
    logLevel: 'error',
    resolve: { alias: { '@': path.join(root, 'src') } },
    plugins: [
      {
        name: 'lazy-i18n-fixture',
        resolveId(id) {
          if (
            id === 'fixture' ||
            modulePath(id) === modulePath(path.join(root, 'fixture'))
          )
            return '\0fixture';
          if (id === 'virtual:i18n') return '\0languages';
        },
        load(id) {
          if (id === '\0languages') return generated;
          if (id !== '\0fixture') return;
          return `
          import i18next from 'i18next';
          import {loadI18n,setLanguage,t} from ${JSON.stringify(modulePath(path.join(root, 'src/i18n/index.ts')))};
          import {loadLanguageResource} from 'virtual:i18n';
          export {loadI18n,setLanguage,loadLanguageResource};
          export const snapshot=()=>({language:i18next.language,loaded:Object.keys(i18next.store.data),label:t('plugins.synced-lyrics.menu.export-label')});
        `;
        },
      },
    ],
    build: {
      outDir: output,
      emptyOutDir: true,
      lib: { entry: 'fixture', formats: ['es'], fileName: () => 'fixture.mjs' },
    },
  });
  const fixture = await import(
    pathToFileURL(path.join(output, 'fixture.mjs')).href
  );
  await fixture.loadI18n();
  expect(fixture.snapshot().loaded).toEqual(['en']);
  expect(await fixture.loadLanguageResource('__proto__')).toBeUndefined();
  expect(await fixture.loadLanguageResource('constructor')).toBeUndefined();
  await fixture.setLanguage('ru');
  expect(fixture.snapshot()).toEqual({
    language: 'ru',
    loaded: ['en', 'ru'],
    label: 'Экспорт текста (.lrc)',
  });
  await Promise.all([fixture.setLanguage('fr'), fixture.setLanguage('en')]);
  expect(fixture.snapshot().language).toBe('en');
  await fixture.setLanguage('../../etc/passwd');
  expect(fixture.snapshot().language).toBe('en');
  expect(fixture.snapshot().loaded).not.toContain('ar');
});
