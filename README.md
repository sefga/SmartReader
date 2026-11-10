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
- [Развёртывание на Vercel, Netlify и GitHub Pages](app/docs/deployment.md)

Локальная читалка поддерживает выбор и перетаскивание TXT/Markdown и аудио, запись звука вкладки Chrome/Edge и автосохранение записи. Можно скачать только MP3 или один автономный HTML со встроенным аудио и подсветкой. Генерация озвучки через TTS API и автоматическая публикация на сайте не подключены.
