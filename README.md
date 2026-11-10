# speechread

Публичный проект. Онлайн-версия — **speechread**:

- **[speechread.netlify.app](https://speechread.netlify.app/)**
- **[speechread.vercel.app](https://speechread.vercel.app/)**
- **[GitHub Pages](https://sefga.github.io/speechread/)**

На каждом сайте нажмите «Открыть читалку без регистрации» или добавьте к адресу `reader/`. Материалы и прогресс хранятся отдельно для каждого домена в вашем браузере.

Приложение находится в папке `app/`.

- [Запуск и инструкция по использованию](app/README.md)
- [Проверка готовности и недостающие возможности](app/docs/readiness.md)
- [Как работает синхронизация текста и аудио](app/docs/synchronization.md)
- [Развёртывание на Vercel, Netlify и GitHub Pages](app/docs/deployment.md)

Сейчас это локальная читалка со встроенной записью звука выбранной вкладки Chrome/Edge и экспортом статьи с аудио для личного архива. Генерация озвучки через TTS API и автоматическая публикация на сайте не подключены.
