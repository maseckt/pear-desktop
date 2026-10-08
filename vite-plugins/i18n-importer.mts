import { readFileSync } from 'node:fs';
import { basename, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { globSync } from 'glob';
import { Project } from 'ts-morph';

const __dirname = dirname(fileURLToPath(import.meta.url));
const globalProject = new Project({
  tsConfigFilePath: resolve(__dirname, '..', 'tsconfig.json'),
  skipAddingFilesFromTsConfig: true,
  skipLoadingLibFiles: true,
  skipFileDependencyResolution: true,
});

export const i18nImporter = () => {
  const srcPath = resolve(__dirname, '..', 'src');
  const plugins = globSync(['src/i18n/resources/*.json']).map((path) => {
    const nameWithExt = basename(path);
    const name = nameWithExt.replace(extname(nameWithExt), '');

    return { name, path };
  });

  const src = globalProject.createSourceFile(
    'vm:i18n',
    (writer) => {
      const labels = Object.fromEntries(
        plugins.map(({ name, path }) => {
          const json = JSON.parse(readFileSync(path, 'utf8')) as {
            language?: { name?: string; 'local-name'?: string };
          };
          return [
            name,
            {
              name: json.language?.name ?? 'Unknown',
              localName: json.language?.['local-name'] ?? 'Unknown',
            },
          ];
        }),
      );
      writer.writeLine(
        `export const languageLabels = ${JSON.stringify(labels)};`,
      );
      writer.writeLine(
        'export const availableLanguages = Object.keys(languageLabels);',
      );
      writer.writeLine('const loaders = new Map([');
      for (const { name, path } of plugins) {
        const absolutePath = resolve(srcPath, '..', path).replace(/\\/g, '/');

        writer.writeLine(
          `  [${JSON.stringify(name)}, () => import(${JSON.stringify(absolutePath)}).then((mod) => mod.default)],`,
        );
      }
      writer.writeLine(']);');
      writer.writeLine(
        'export const loadLanguageResource = async (name) => loaders.get(name)?.();',
      );
      writer.blankLine();
    },
    { overwrite: true },
  );

  return src.getText();
};
