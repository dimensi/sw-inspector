# Попробовать новые функции в Safari

Ночные проверки прошли в Chrome. Эти короткие шаги проверяют установленное расширение в Safari; подробные непроверенные случаи остаются в [TESTING.md](TESTING.md).

## Подготовка

Открой [SW Inspector.app](</tmp/sw-inspector-a1-signed/Build/Products/Debug/SW Inspector.app>). **Перезапусти Safari и открой новый Web Inspector** для нужной тестовой страницы → **SW Inspector**. На этой вкладке Safari нажми значок расширения, затем **Refresh** в панели. После каждой перезагрузки или перехода нажимай **Refresh** в панели. Если появилась подсказка **Allow access to this tab**, снова нажми значок расширения, затем **Refresh**.

## Service Workers

1. Открой [worker test page](http://localhost:4174/sw-inspector-worker/). Нажми **Serve worker v1** → **Register fixture worker** → **Seed fixture**. Перезагрузи страницу и нажми **Refresh** в панели.
2. В **Registration** выбери адрес с `/sw-inspector-worker/`. Нажми **Check for update** → **Confirm**. Ожидается **Update check completed. Activation is not guaranteed.**
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

## Необязательно: прежние проверки кеша

Проверки перезагрузки со старой целью и остановки пакетного удаления уже подтверждены. Оставшиеся доступ/клавиатура и редкие сбои перечислены в TESTING; повторять всё для знакомства с новыми функциями не нужно. Перед **Delete all caches…** нажми **Inspect fixture caches**: `otherCacheCount` должен быть `0`, а подтверждение должно содержать только имена `sw-inspector-fixture-*`.
