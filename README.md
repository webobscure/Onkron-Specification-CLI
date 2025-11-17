# Automatization - Product Data Synchronization Tool

Система автоматизации для синхронизации данных о продуктах между MySQL базой данных и магазинами Shopify в разных странах.

## 📋 Описание проекта

Проект представляет собой набор скриптов для автоматизации обновления характеристик продуктов (вес, материал, цвет, высота, максимальная нагрузка) между внутренней базой данных и международными магазинами Shopify.

### Основные возможности

- ✅ Синхронизация веса продуктов с конвертацией единиц измерения (кг ↔ фунты)
- ✅ Многоязычная локализация характеристик (материалы)
- ✅ Автоматическая конвертация размеров (мм → дюймы)
- ✅ Перевод цветов на английский язык
- ✅ Поддержка 7 стран: US, UK, FR, IT, ES, DE, PL
- ✅ Логирование ошибок и детальная отчетность

## 🏗️ Архитектура

### Структура проекта

```
Automatization/
├── dist/                           # Скомпилированные JavaScript файлы
│   ├── index.js                   # Базовый скрипт конвертации веса
│   ├── updateWeightShopify.js     # Обновление веса в Shopify (ES)
│   ├── updateWeightShopifyUS.js   # Обновление веса в Shopify (US) с конвертацией в фунты
│   ├── updateMaterial.js          # Многоязычный перевод материалов
│   ├── updateLoad.js              # Обновление максимальной нагрузки
│   ├── updateHeight.js            # Конвертация высоты (мм → дюймы)
│   ├── updateColor.js             # Перевод цветов
│   └── delete.js                  # Удаление записей из БД
├── node_modules/                  # Зависимости
├── failed_products_*.log          # Логи ошибок по странам
├── .env                           # Конфигурация (API ключи, БД)
├── .gitignore
├── package.json
└── package-lock.json
```

## 🚀 Установка

### Требования

- Node.js >= 14.x
- npm >= 6.x
- MySQL 5.7+
- Доступ к Shopify Admin API

### Шаги установки

1. Клонировать репозиторий:
```bash
git clone <repository-url>
cd Automatization
```

2. Установить зависимости:
```bash
npm install
```

3. Настроить файл `.env` (см. раздел "Конфигурация")

4. Собрать проект (если используются TypeScript исходники):
```bash
npm run build
```

## ⚙️ Конфигурация

### Файл `.env`

Создайте файл `.env` в корне проекта со следующими параметрами:

```env
# MySQL Database
host=your-db-host
user=your-db-user
database=your-db-name
password=your-db-password

# Shopify API
SHOPIFY_API_VERSION=2025-04

# Shopify US Store
SHOPIFY_US_STORE=your-store-name
SHOPIFY_US_ACCESS_TOKEN=shpat_xxxxx
SHOPIFY_US_API_KEY=xxxxx

# Shopify ES Store
SHOPIFY_ES_STORE=your-store-name
SHOPIFY_ES_ACCESS_TOKEN=shpat_xxxxx
SHOPIFY_ES_API_KEY=xxxxx

# Shopify UK Store
SHOPIFY_UK_STORE=your-store-name
SHOPIFY_UK_ACCESS_TOKEN=shpat_xxxxx
SHOPIFY_UK_API_KEY=xxxxx

# Shopify FR Store
SHOPIFY_FR_STORE=your-store-name
SHOPIFY_FR_ACCESS_TOKEN=shpat_xxxxx
SHOPIFY_FR_API_KEY=xxxxx

# Shopify IT Store
SHOPIFY_IT_STORE=your-store-name
SHOPIFY_IT_ACCESS_TOKEN=shpat_xxxxx
SHOPIFY_IT_API_KEY=xxxxx

# Shopify DE Store
SHOPIFY_DE_STORE=your-store-name
SHOPIFY_DE_ACCESS_TOKEN=shpat_xxxxx
SHOPIFY_DE_API_KEY=xxxxx

# Shopify PL Store
SHOPIFY_PL_STORE=your-store-name
SHOPIFY_PL_ACCESS_TOKEN=shpat_xxxxx
SHOPIFY_PL_API_KEY=xxxxx
```

## 📖 Использование

### Основные команды

```bash
# Запуск основного скрипта
npm start

# Запуск с автоперезагрузкой (разработка)
npm run nodemon

# Обновление максимальной нагрузки
npm run "update load"

# Обновление материалов (интерактивно)
npm run material

# Удаление записей из БД
npm run delete

# Компиляция TypeScript
npm run build

# Линтинг кода
npm run lint
```

### Скрипты и их назначение

#### 1. `updateWeightShopify.js` / `updateWeightShopifyUS.js`

**Назначение:** Синхронизация веса продуктов из БД в Shopify

**Особенности:**
- EU версия использует килограммы
- US версия конвертирует в фунты (кг × 2.2)
- Пропускает продукты без SKU или с нулевым весом
- Генерирует детальный отчет

**Запуск:**
```bash
node ./dist/updateWeightShopify.js      # для EU магазина
node ./dist/updateWeightShopifyUS.js    # для US магазина
```

**Логика работы:**
1. Получает все product_id из БД
2. Для каждого продукта извлекает SKU и вес
3. Ищет продукт в Shopify по SKU
4. Обновляет вес через Shopify Admin API
5. Логирует ошибки в `failed_products_*.log`

#### 2. `updateMaterial.js`

**Назначение:** Перевод материалов на разные языки

**Поддерживаемые материалы:**
- Холоднокатаная сталь (SPCC cold rolled steel)
- Нержавеющая сталь (Stainless steel)
- Алюминий (Aluminum)
- Пластик (Plastic)
- Бук (Beech)
- Резина (Rubber)
- Стекло (Glass)

**Поддерживаемые языки:**
- 2: US/UK (английский)
- 3: FR (французский)
- 4: IT (итальянский)
- 5: ES (испанский)
- 6: DE (немецкий)
- 7: UK (английский)
- 8: PL (польский)

**Запуск:**
```bash
npm run material
```

**Интерактивный выбор:**
```
Выберите страну для обновления материалов:
2: US
3: FR
4: IT
5: ES
6: DE
7: UK
8: PL
Введите номер страны (2-8): _
```

#### 3. `updateLoad.js`

**Назначение:** Конвертация максимальной нагрузки из кг в фунты

**Формула:** `weight_lbs = weight_kg × 2.2`

**Целевое поле:** `specifications_id = 786`

#### 4. `updateHeight.js`

**Назначение:** Конвертация высоты из миллиметров в дюймы

**Формула:** `height_inches = height_mm × 0.04`

**Целевое поле:** `specifications_id = 60`

#### 5. `updateColor.js`

**Назначение:** Перевод цветов с русского на английский

**Маппинг цветов:**
- Белый → White
- Черный → Black
- Серый/Серебристый → Silver
- Синий → Blue
- Красный → Red

#### 6. `delete.js`

**Назначение:** Удаление записей из таблицы specifications


## 🗄️ Структура БД

### Таблица `products_specifications`

| Поле | Тип | Описание |
|------|-----|----------|
| `products_id` | INT | ID продукта |
| `language_id` | INT | ID языка (1=RU, 2=EN, 3=FR, и т.д.) |
| `specification` | VARCHAR | Значение характеристики |
| `specifications_id` | INT | Тип характеристики |

### Важные `specifications_id`:

- `60` - Высота
- `61` - Материал
- `751` - SKU
- `766` - Вес нетто
- `786` - Максимальная нагрузка

## 📊 Отчетность и логирование

### Логи ошибок

При выполнении скриптов создаются файлы логов:
- `failed_products_us.log`
- `failed_products_es.log`
- `failed_products_uk.log`
- `failed_products_it.log`
- `failed_products_pl.log`

**Формат записи:**
```json
[
  {
    "reason": "Продукт с SKU ABC123 не найден"
  }
]
```

### Консольные отчеты

Пример отчета:
```
=== ОТЧЕТ ===
Всего продуктов обработано: 150
Успешно обновлено: 142
Пропущено: 5
Ошибок: 3
Обновление всех продуктов завершено
```

## 🔧 Технологии

### Основные зависимости

- **axios** ^1.13.2 - HTTP клиент для Shopify API
- **mysql2** ^3.9.1 - MySQL драйвер с поддержкой promises
- **dotenv** ^16.5.0 - Управление переменными окружения
- **async** ^3.2.5 - Управление асинхронными операциями
- **readline** ^1.3.0 - Интерактивный ввод в консоли
- **nodemon** ^3.0.3 - Автоперезагрузка при разработке

## ⚠️ Важные замечания

### Безопасность

### Ограничения Shopify API

- Лимит: 250 продуктов за запрос
- Rate limiting: 2 запроса/секунду (стандартный план)
- Рекомендуется добавить задержки между запросами

### SQL Injection

⚠️ **Критическое:** Некоторые скрипты используют string interpolation для SQL запросов. Необходимо перейти на prepared statements:



## 🐛 Известные проблемы

1. **Хардкод креденшиалов** в `delete.js`
2. **SQL Injection уязвимости** в нескольких скриптах
3. **Отсутствие обработки rate limiting** Shopify API
4. **Нет retry механизма** при сетевых ошибках
5. **Закомментированный код** в `index.js` (строка 33)

## 📝 Примеры использования

### Обновление веса для всех продуктов в US магазине

```bash
npm start
# Или напрямую:
node ./dist/updateWeightShopifyUS.js
```

### Перевод материалов на итальянский

```bash
npm run material
# Выберите: 4 (IT)
```

### Массовое удаление спецификаций

```bash
npm run delete
# ⚠️ Осторожно: удаляет все материалы для language_id = 6 (DE)
```

## 🤝 Вклад в проект

При добавлении нового функционала:

1. Используйте `.env` для всех конфигураций
2. Применяйте prepared statements для SQL
3. Добавляйте логирование ошибок
4. Обновляйте README.md

## 📄 Лицензия

ISC

## 👥 Автор

Alex Ginovyan

---

**Последнее обновление:** Ноябрь 2025  
**Версия:** 1.0.0
