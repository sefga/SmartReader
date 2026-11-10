# speechread

Публичный проект. Онлайн-версия — **speechread**:

- **[speechread.netlify.app](https://speechread.netlify.app/)**
- **[speechread.vercel.app](https://speechread.vercel.app/)**
- **[GitHub Pages](https://sefga.github.io/speechread/)**

Читалка открывается сразу. Материалы и прогресс хранятся отдельно для каждого домена в вашем браузере.

Приложение находится в папке `app/`.

- [Запуск и инструкция по использованию](app/README.md)
- [Проверка готовности и недостающие возможности](app/docs/readiness.md)
- [Как работает синхронизация текста и аудио](app/docs/synchronization.md)
- [Все способы разметки: браузер, OpenAI, Gemini, JSON и промпты](app/docs/synchronization-methods.md)
- [Развёртывание на Vercel, Netlify и GitHub Pages](app/docs/deployment.md)

Читалка поддерживает выбор и перетаскивание TXT/Markdown и аудио, запись звука вкладки Chrome/Edge и автосохранение записи. По умолчанию распознавание работает локально в браузере; по желанию доступны OpenAI/Gemini со своим API-ключом, вставка JSON и промпты для другого чата. Можно скачать только MP3 или один автономный HTML со встроенным аудио и подсветкой. Генерация озвучки через TTS API и автоматическая публикация статей не подключены.
