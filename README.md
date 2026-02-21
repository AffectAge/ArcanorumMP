# WeGo Global MVP

Авторитарная WeGo-игра без комнат: вход по домену/стране сразу в общий матч.

## Стек

- Client: React, Tailwind CSS, Radix UI, MapLibre, XState, TanStack Query, lucide-react, Socket.IO client
- Server: Node.js + Express, Socket.IO, XState, Zod, JWT (httpOnly cookie), Prisma
- DB: SQLite
- Shared: общие Zod-схемы и типы

## Структура

- `apps/client` - UI и карта
- `apps/server` - авторитарный игровой сервер
- `packages/shared` - общие контракты

## Быстрый старт

1. Скопируйте `apps/server/.env.example` в `apps/server/.env`.
2. Выполните:

```bash
npm install
npm run prisma:generate --workspace apps/server
npm run prisma:migrate --workspace apps/server -- --name init
npm run dev
```

4. Клиент: `http://localhost:5173`
5. Сервер: `http://localhost:4000`

## Как работает цикл WeGo

- `planning`: сбор приказов + статусы готовности
- `resolve`: стартует при `all ready` или по таймеру (auto-ready по таймауту)
- `commit`: фиксация хода и переход к следующему `planning`

## Ключевые API

- `GET /api/countries`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/game/state`
- `POST /api/game/orders`
- `POST /api/game/ready`

## Сокеты

- Событие сервера: `game:state`

