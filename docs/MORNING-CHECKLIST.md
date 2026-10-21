# Попробовать новые функции в Safari

Ночные проверки прошли в Chrome. Эти короткие шаги проверяют установленное расширение в Safari; подробные непроверенные случаи остаются в [TESTING.md](TESTING.md).

## Подготовка

Открой [SW Inspector.app](</tmp/sw-inspector-a1-signed/Build/Products/Debug/SW Inspector.app>). В Safari открой тестовую страницу ниже, нажми значок SW Inspector на этой вкладке и открой Web Inspector → **SW Inspector**. После каждой перезагрузки или перехода нажимай **Refresh** в панели. Если появилась подсказка **Allow access to this tab**, снова нажми значок расширения, затем **Refresh**.

## Service Workers

1. Открой [worker test page](http://localhost:4174/sw-inspector-worker/). Нажми **Serve worker v1** → **Register fixture worker** → **Seed fixture**. Перезагрузи страницу и нажми **Refresh** в панели.
2. В **Registration** выбери адрес с `/sw-inspector-worker/`. Нажми **Check for update** → **Confirm**. Ожидается **Update check completed. Activation is not guaranteed.**
3. На тестовой странице нажми **Serve worker v2**. В панели снова выбери регистрацию → **Check for update** → **Confirm** → **Refresh**. Должен появиться новый installing/waiting worker; controller текущей страницы может остаться прежним. Если установка ещё идёт, повтори только **Refresh**.
4. Выбери регистрацию → **Unregister** → **Confirm**. После **Refresh** регистрация исчезнет, но controller и кеши могут сохраниться — это ожидаемо. На странице **Inspect fixture caches** покажет тестовые кеши. Не проверяй удаление регистрации на рабочем сайте.

## Необязательно: прежние проверки кеша

Проверки перезагрузки со старой целью и остановки пакетного удаления уже подтверждены. Оставшиеся доступ/клавиатура и редкие сбои перечислены в TESTING; повторять всё для знакомства с новыми функциями не нужно. Перед **Delete all caches…** нажми **Inspect fixture caches**: `otherCacheCount` должен быть `0`, а подтверждение должно содержать только имена `sw-inspector-fixture-*`.
