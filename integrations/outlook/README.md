# Outlook для vilar

Модуль подключает личный тестовый ящик Outlook.com через Microsoft Graph и MCP-сервер Softeria. Нужны Node.js 20 или новее и npm.

Из этой папки выполните:

```sh
npm ci --ignore-scripts
export VILAR_OUTLOOK_ACCOUNT='your-test-mailbox@outlook.com'
./outlook login
```

Откройте страницу Microsoft из подсказки и подтвердите вход под указанным адресом. Учетные данные хранятся в личной конфигурации пользователя VPS отдельно для каждого ящика.

Для подключения из приложения запустите `./outlook serve` как MCP-сервер по стандартным потокам ввода и вывода. Передайте ту же переменную окружения. Для проверки чтения вызовите `list-mail-folder-messages` с `mailFolderId: inbox` и `top: 1`. Пустой список тоже подтверждает доступ. Для проверки записи создайте черновик без получателей через `create-draft-email` и проверьте папку «Черновики».

После установки зависимостей `npm test` проверяет пять команд через MCP и локальный HTTP-сервер, имитирующий Microsoft Graph. Для этого прогона используются временный каталог и тестовый токен.

Доступны чтение, подготовка нового черновика и ответа в цепочке, отправка выбранного черновика. За согласование текста и адресата с руководителем перед отправкой отвечает вызывающее приложение. Набор разрешений можно посмотреть через `./outlook permissions`.

Зависимость: [Softeria MS-365 MCP Server](https://github.com/Softeria/ms-365-mcp-server).

Event intake on the existing Outlook callback is opt-in. The callback process must be able
to import the adapter from this directory and uses VILAR_MAIL_PUSH_DIR and
VILAR_MAIL_CLIENT_STATE. The mail worker must use the same state directory. Before
enabling mail, verify that calendar-only notifications still work with mail disabled.
Run the public contract test with python3 test_mail_push.py from this directory.

To end a temporary Inbox subscription, use mail_push.py unsubscribe --expected-id ID
with its original mail state directory and HTTPS callback. The command checks the
recorded ID, resource, callback and change type before deletion and verifies a
provider 404 before removing the local subscription record.

The temporary rule uses the exact existing URL with ?vilar_mail_pilot=1.
preflight reads the authenticated user and subscription inventory without writing
local state. The app ID comes from MS365_MCP_CLIENT_ID or the existing calendar
rule on the unmarked URL for the same user. A foreign or ambiguous rule, missing
ownership evidence or an incomplete inventory stops the request.
subscribe defaults to 45 minutes. Override with --ttl-minutes (45 through 720).
After a lost create response, recover verifies the exact marked rule and restores
its ID. A missing match after an uncertain create blocks a second POST. When the
ID file is lost, unsubscribe without --expected-id can resolve the same unique
marked rule and confirm its removal. An expired test with an unresolved intent
can be examined without restarting intake.
