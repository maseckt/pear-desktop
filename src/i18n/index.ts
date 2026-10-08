import i18next, { init, t as i18t, changeLanguage } from 'i18next';
import { availableLanguages, loadLanguageResource } from 'virtual:i18n';

export const APPLICATION_NAME =
  '\u0059\u006f\u0075\u0054\u0075\u0062\u0065\u0020\u004d\u0075\u0073\u0069\u0063';

export const loadI18n = async () => {
  const fallback = await loadLanguageResource('en');
  return await init({
    resources: { en: { translation: fallback ?? {} } },
    lng: 'en',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });
};

let languageGeneration = 0;
export const setLanguage = async (language: string) => {
  const generation = ++languageGeneration;
  const selected = availableLanguages.includes(language) ? language : 'en';
  if (!i18next.hasResourceBundle(selected, 'translation')) {
    const resource = await loadLanguageResource(selected);
    if (resource) i18next.addResourceBundle(selected, 'translation', resource);
  }
  if (generation !== languageGeneration) return;
  return await changeLanguage(selected);
};

export const t = i18t.bind(i18next);
