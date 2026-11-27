# Telemost room client

Открытая часть интеграции: вход гостем в комнату, WebM-аватар,
перехват аудио и STT, создание встречи через API и поиск ссылки в Outlook/ICS.

## Что здесь есть

- `bot.py` — headless-бот комнаты: вход, аватар, захват дорожек, транскрипт.
- `telemost_inject.js` — инъекция камеры/микрофона и перехват WebRTC-аудио.
- `stt.py` — Yandex SpeechKit / Groq Whisper.
- `create_meeting.py`, `find_link.py` — создание комнаты и поиск ссылки.
- `tasks.py` — экспорт поручений из уже утверждённого `protocol.approved.json`.
- `core_event.py` — сборка события `meeting` для `POST /v1/events`, атомарный outbox и чтение квитанции.
- `test_core_event.py` — проверка формы события, повтора после потери ответа и конфликта данных.
- `stt.py` — Groq Whisper; HTTP-ошибка отличается от успешной пустой расшифровки.
- `test_stt.py` — loopback-проверка HTTP-статусов Groq без ключа и комнаты.
- `selftest.py`, `mock_join_test.py` — синтетические проверки без реальной комнаты.

## Чего здесь нет

Генерация протокола, промпты, схема внутренней БД, допуск и разбор поручений
живут в закрытом ядре. Клиент комнаты передаёт событие через
`integrations/sources/client.py`.

## Запуск

```bash
python3 -m unittest integrations/sources/test_client.py
python3 integrations/telemost/selftest.py
python3 integrations/telemost/mock_join_test.py
```

Для живого входа нужны Playwright/Chromium, OAuth-токен Телемоста и ключ STT.
Секреты — только в окружении, не в Git. `config.example.env` содержит пустые
placeholder'ы.
