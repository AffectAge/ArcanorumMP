# Arcanorum

## WeGo Sandbox

This project now includes:

- Vite + React client (`src/`)
- Colyseus authoritative server (`server/`)
- Country registration/login API (`/api/register`, `/api/login`, `/api/countries`)
- PostgreSQL persistence via Prisma (`prisma/schema.prisma`)
- A basic WeGo phase loop: `planning -> lock -> resolve -> apply`
- Client order submission via `commit_orders`
- Fullscreen MapLibre map after authentication

## Run

0. Setup environment variables (`.env`):

```bash
cp .env.example .env
```

Set your PostgreSQL credentials in `DATABASE_URL`.

1. Generate Prisma client:

```bash
npm run db:generate
```

2. Create/update DB schema:

```bash
npm run db:push
```

or with migration files:

```bash
npm run db:migrate
```

1. Start server:

```bash
npm run server
```

2. Start client (new terminal):

```bash
npm run dev
```

By default, the client connects to `ws://localhost:2567`.
By default, auth API uses `http://localhost:2567`.

Set a custom endpoint through:

```bash
VITE_COLYSEUS_URL=ws://your-host:2567
VITE_API_URL=http://your-host:2567
```

## Notes

- `WegoRoom` is in `server/rooms/WegoRoom.js`.
- Auth/session store is in `server/authStore.js` (database-backed).
- Prisma client bootstrap is in `server/db.js`.
- `zustand` client networking store is in `src/store/wegoStore.js`.
- UI demo is in `src/App.jsx`.

# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
