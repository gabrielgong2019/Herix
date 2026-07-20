import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zh from './zh.json'
import ja from './ja.json'
import en from './en.json'
import ko from './ko.json'

i18n.use(initReactI18next).init({
  resources: { zh: { translation: zh }, ja: { translation: ja }, en: { translation: en }, ko: { translation: ko } },
  lng: localStorage.getItem('herix-merchant-lang') || 'zh',
  fallbackLng: 'zh',
  interpolation: { escapeValue: false },
})

export default i18n
