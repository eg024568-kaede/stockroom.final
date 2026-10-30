# Stockroom

An inventory dashboard with full CRUD, built with **Express.js** and **SQLite** (Node's built-in `node:sqlite`, Node 22.13+ required).

## Features
- Create, read, update, and delete inventory items
- Dashboard summary: total value, product count, units in stock, items needing reorder
- Value-by-category chart and live search
- Administrator login with session cookie and logout
- Server-side validation, sample data seeded on first run

## Admin login
The dashboard is protected by an administrator login.

- Default username: `admin`
- Default password: `admin123`

Change them with environment variables (PowerShell):
```powershell
$env:ADMIN_USER="myadmin"; $env:ADMIN_PASS="a-strong-password"; npm start
```
All `/api/items` and `/api/stats` routes return `401` unless signed in.

## Run locally
```bash
npm install
npm start
```
Open http://localhost:3000. The database file (`stockroom.db`) is created automatically.

## API
| Method | Endpoint          | Purpose              |
|--------|-------------------|----------------------|
| GET    | /api/items?q=     | List / search items  |
| GET    | /api/items/:id    | Get one item         |
| POST   | /api/items        | Create item          |
| PUT    | /api/items/:id    | Update item          |
| DELETE | /api/items/:id    | Delete item          |
| GET    | /api/stats        | Dashboard summary    |
