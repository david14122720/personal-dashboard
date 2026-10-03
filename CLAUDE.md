# Personal Dashboard

## Project Overview
Private personal control center integrating finance, habits, goals, tasks, calendar, subscriptions, debts, net worth, and notes.

## Technical Stack
- **Frontend**: Next.js (Static Export) + Tailwind CSS
- **Backend**: Rust (Axum)
- **Database**: PostgreSQL (hosted on Dokploy)

## Infrastructure
- **GitHub Repository**: `david14122720/personal-dashboard`
- **Dokploy Project**: `personal-dashboard` (ID: `rhEdyH6jxqpycCp2vk9Ao`)
- **Local DB Access**: `192.168.50.120:5434`

## Development rules
- **Use the production database for development and testing** (owner decision, 2026-10-03): there is no valuable data yet, everything is test data. Connection: `postgres://pdbuser:pdbpass123@192.168.50.120:5434/pdbname`.
- Keep it clean: any test data belongs to a throwaway user (created with the backend's `--create-user`), and that user is deleted at the end of the session (every row cascades from `users(id)`).
- Working against production does **not** authorize destructive schema migrations: those still need explicit approval.
