# Android

Текущий срез — PWA: откройте Hive в Chrome на телефоне → меню → **Добавить на главный экран**. Так видно рой, туннели и можно писать агентам.

Нативный APK (когда понадобится магазин или пуш):

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "MAG Hive" ru.mag.hive --web-dir out
npm run build
npx cap add android
npx cap sync
```

Дальше сборка в Android Studio. Hive — обычное HTTPS-приложение, отдельный backend на телефоне не нужен: агенты живут на Linux/Windows, телефон — наблюдатель.
