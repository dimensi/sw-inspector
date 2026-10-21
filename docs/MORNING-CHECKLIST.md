# Проверить все функции SW Inspector в Safari

Это короткий ручной smoke-тест установленного расширения. Сами шаги ниже ещё не подтверждают результат в Safari: ночные проверки и оставшиеся сложные случаи описаны в [TESTING.md](TESTING.md).

## Открытие и обновление

1. Открой [SW Inspector.app](</tmp/sw-inspector-a1-signed/Build/Products/Debug/SW Inspector.app>). **Перезапусти Safari и открой новый Web Inspector** для [worker test page](http://localhost:4174/sw-inspector-worker/) → **SW Inspector**. Нажми значок расширения на этой вкладке. Если появилась **Allow access to this tab**, после разрешения нажми **Refresh**. При открытии панели данные должны читаться автоматически; **Refresh** также обновляет их вручную.
2. На странице нажми **Seed fixture** → **Refresh** в панели. Перейди на **Network** в Web Inspector, на странице нажми **Cleanup fixture**, затем вернись в **SW Inspector**: тестовые кеши должны исчезнуть без ручного Refresh. Снова нажми **Seed fixture** и **Refresh**, чтобы восстановить данные.
3. После перехода или перезагрузки страницы нажимай **Refresh**. Если доступ потерян, нажми значок расширения на этой вкладке и повтори **Refresh**.

## Кеши, ответы и размер

1. В боковом **Cache Storage** сверни и раскрой список кешей, выбери `sw-inspector-fixture-entries`. В **Filter URLs** введи `fixture-query`, выбери `?v=1`: проверь URL, Method, Mode, Status, Content type и **Response headers**. До явной загрузки тело не показывается.
2. Нажми **Load text / JSON**: появится `Version 1`, выбранная строка сохранится. Щёлкни строку `?v=1` в таблице, затем стрелкой вниз выбери `?v=2` и явно загрузи его тело — ожидается `Version 2`. Очисти фильтр, чтобы вернуть остальные ключи; точное число вариантов `/fixture-vary` зависит от браузера.
3. На странице нажми **Seed preview fixture** → **Refresh**. В `sw-inspector-fixture-preview` выбери `/fixture-preview.json` → **Load text / JSON**: ожидается JSON с `Explicit JSON cache preview`. Затем выбери `/fixture-long-text.txt` → **Load text / JSON**: сначала загрузятся первые 48 KiB с предупреждением; **Load full response** должен показать конец `END OF PREVIEW FIXTURE`.
4. Нажми **Measure bodies** в выбранном кеше: появятся **known body bytes** и счётчики прочитанных/неизвестных/ошибочных ответов. В **Service Workers → Origin storage** есть **Estimated usage** и **Estimated quota** всего origin — это не размер кеша. Неизвестный размер не должен превращаться в ноль.

## Offline Resources

1. Открой **Offline Resources**, в **Same-origin URLs or paths, one per line** введи `/fixture-alpha` и на следующей строке `/definitely-not-cached` → **Check keys**.
2. Ожидаются **Present** и **Not present** соответственно. Это поиск ключей в кеше без сетевого запроса, а не гарантия работы страницы без интернета.

## Service Workers

1. Открой [worker test page](http://localhost:4174/sw-inspector-worker/). Нажми **Serve worker v1** → **Register fixture worker** → **Seed fixture**. Перезагрузи страницу и нажми **Refresh** в панели.
2. В **Service Workers** проверь **Page → Origin / Controller / State** и **Registration → Scope / Active / Waiting / Installing**. Регистрация сама по себе не означает управление страницей. В **Registration** выбери адрес с `/sw-inspector-worker/`. Нажми **Check for update** → **Confirm**. Ожидается **Update check completed. Activation is not guaranteed.**
3. На тестовой странице нажми **Serve worker v2**. В панели снова выбери регистрацию → **Check for update** → **Confirm** → **Refresh**. Должен появиться новый installing/waiting worker; controller текущей страницы может остаться прежним. Если установка ещё идёт, повтори только **Refresh**.
4. Выбери регистрацию → **Unregister** → **Confirm**. После **Refresh** регистрация исчезнет, но controller и кеши могут сохраниться — это ожидаемо. На странице **Inspect fixture caches** покажет тестовые кеши. Не проверяй удаление регистрации на рабочем сайте.

## Manifest

1. Открой [обычный manifest](http://127.0.0.1:4187/?case=valid), нажми значок расширения на этой вкладке, затем **Refresh** в панели.
2. Выбери **Manifest** → **Discover manifest** → **Load manifest**. Должны появиться поля и две строки объявлений иконок; это не проверка установки приложения.
3. Нажми **Show source**: появится исходный JSON. Иконки здесь не загружаются как изображения.
4. Открой [вариант с перенаправлением](http://127.0.0.1:4187/?case=redirect) → **Refresh** → **Discover manifest** → **Load manifest**. **Final URL** и вычисленный `start_url` должны содержать `/redirect/deeper/`.

Необязательно: [ошибочный JSON](http://127.0.0.1:4187/?case=invalid-json) после тех же кнопок должен показать локальную ошибку разбора; остальные данные инспектора остаются доступны.

## Messages

1. Вернись на [worker test page](http://localhost:4174/sw-inspector-worker/). После предыдущего Unregister снова нажми **Serve worker v1** → **Register fixture worker**, перезагрузи страницу → **Refresh**. Открой **Messages**, выбери регистрацию `/sw-inspector-worker/` и **Active**.
2. В **JSON payload** вставь `{"fixture":"echo","value":"hello"}`, включи **Request reply on supplied port** → **Send…** → **Confirm**. Выбери строку **reply**: в деталях должно быть `"hello"`.
3. Нажми **Start listening**. Вставь `{"fixture":"page-directed","value":"hello"}`, выключи запрос ответа → **Send…** → **Confirm**. Строка **incoming** должна иметь **Not correlated** в деталях.
4. **Clear log** очищает только видимую таблицу. Переключись на вкладку **Network** в Web Inspector и вернись: приём должен остановиться и не включиться сам. Для продолжения явно нажми **Start listening**; **Stop listening** останавливает приём.

Сообщения отправляются коду тестовой страницы и могут менять её состояние. На рабочем сайте не отправляй эти команды без понимания его протокола.

## Export и Diagnostics

1. После просмотра ответов, Manifest и Messages нажми **Export**. Открой `sw-inspector-report.json`: ожидаются метаданные текущего origin, workers и кешей; измерения и поиск ключей попадут туда, если их результаты ещё есть в текущей панели. После переходов для этой проверки можно повторить **Measure bodies** и **Check keys**. Тела ответов, текст preview, журнал/JSON сообщений и исходный Manifest в отчёт не входят. Перед передачей отчёта проверь URL и другие метаданные на чувствительные данные.
2. В **Diagnostics** нажми **Run bridge probe**. **Synchronous JSON** должен вернуть `probe: sync`, **Deferred job start** — `deferred-started`, **Deferred job poll** — завершённый результат `deferred`. **Returned Promise** с пометкой `not evaluated` — ожидаемая диагностическая строка. Проверка использует фиксированные выражения, вводить свой код не нужно.

## Удаление — только тестовые кеши

1. Вернись на [worker test page](http://localhost:4174/sw-inspector-worker/), нажми **Seed fixture** → **Refresh**. В `sw-inspector-fixture-entries` отфильтруй `fixture-query`, выбери `?v=1` → **Delete entry**. Дополнительного окна подтверждения нет: `?v=1` исчезнет, `?v=2` останется. Открой **Details** у результата, затем закрой его крестиком **Dismiss action result**.
2. Выбери `sw-inspector-fixture-alpha` → **Delete cache…** → **Cancel**: кеш должен остаться. Повтори → **Confirm**: исчезнет только выбранный кеш. **Details** показывает цель и результат; **Inspect fixture caches** на странице позволяет сверить остаток.
3. Снова **Seed fixture** → **Refresh**. Перед **Delete all caches…** обязательно нажми **Inspect fixture caches**: продолжай только при `otherCacheCount: 0`, пустом `otherCaches` и полном списке подтверждения из имён `sw-inspector-fixture-*`. Если есть чужой кеш — пакетное удаление пропусти. Сначала **Cancel** должен сохранить кеши; затем повтори и нажми **Delete listed caches**. Проверяй исход для каждого имени в **Details**, а не только исчезновение списка: сайт может создать кеш заново.
4. **Seed fixture** → **Refresh** оставит тестовую страницу готовой к дальнейшей работе. Редкие сбои, устаревшие цели и расширенная матрица доступа остаются в [TESTING.md](TESTING.md); повторять их для этого smoke-теста не требуется.
