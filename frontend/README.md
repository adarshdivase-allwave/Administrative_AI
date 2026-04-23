# AV Inventory — Frontend

React 18 + Vite + TypeScript + Tailwind + shadcn/ui (manual) + AWS Amplify.

## Project layout

```
frontend/
├─ public/                    Static assets (favicon, PWA icons)
├─ src/
│  ├─ auth/                   Sign-in, forgot-password, ProtectedRoute, session monitor
│  ├─ components/
│  │  ├─ ui/                  shadcn-style primitives (Button, Input, Card, Dialog, …)
│  │  ├─ chatbot-widget.tsx   Floating Gemini assistant
│  │  └─ command-palette.tsx  Cmd+K
│  ├─ layout/                 AppLayout, Sidebar, Topbar, nav-config
│  ├─ pages/                  Route components — Dashboard, Inventory, HSN, Import est., placeholders
│  ├─ stores/                 Zustand: auth-store, ui-store (theme, sidebar, palette)
│  ├─ lib/                    amplify-client, env, cn (tailwind merge)
│  ├─ styles/globals.css      Design tokens + Tailwind base
│  ├─ App.tsx                 Router + providers
│  └─ main.tsx                Entry
├─ index.html
├─ vite.config.ts             Vite + PWA plugin + manualChunks
├─ tailwind.config.ts         Token-driven, dark mode via class
├─ tsconfig.json              Strict TS + path aliases (`@/*`, `@shared/*`)
└─ package.json
```

## Design system

- **Tokens**: CSS variables in `src/styles/globals.css` drive all semantic colors.
  Light/dark switching happens via `class="dark"` on `<html>` — the UI store sets it.
- **UI primitives**: shadcn/ui-style components under `src/components/ui/` — Button,
  Input, Label, Card, Dialog, DropdownMenu, Select, Separator, Skeleton, Tabs, Table,
  Badge, Toast. No shadcn CLI required; each file is self-contained.
- **Icons**: `lucide-react`.
- **Forms**: react-hook-form + zod. Every form has type-safe validation schemas.
- **Data**: AWS Amplify v6 (`generateClient<Schema>()`) — fully typed against the
  backend data schema in `../amplify/data/resource.ts`.

## Authentication + authorization

- Cognito via `aws-amplify/auth`. Sign-in supports direct + MFA + new-password-required.
- `ProtectedRoute` guards enforce authenticated access + optional role requirements.
  Cognito groups (`Admin` / `Logistics` / `Purchase` / `Sales`) ride in the ID token;
  `useAuthStore` parses them and exposes `hasRole()` / `isAdmin()`.
- Session expiry: the `SessionExpiryMonitor` tracks pointer + keyboard activity and
  shows a warning dialog ~5 min before the configured idle TTL. Auto-signs out at
  expiry.

## India-compliance hooks

All India-specific logic is imported from `@shared/*` (the same backend utilities):

- `@shared/fy` — `fyLabel(new Date())` shows "FY 2025-26" on the topbar.
- `@shared/currency` — `formatInr(1234567.89)` renders with Indian lakhs grouping.
- `@shared/gstin` — client-side GSTIN regex + Mod-36 checksum validation.
- `@shared/hsn` — real-time format validation on HSN input fields.
- `@shared/numbering` — invoice/DC/GRN/PO number validation for forms.
- `@shared/eway-bill` — e-Way Bill threshold logic for DC forms.

## Running locally

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev          # http://localhost:5173
```

For the data layer to work you also need `ampx sandbox` running at the repo root
(writes `amplify_outputs.json` that the Amplify client auto-loads).

```bash
# In another terminal at repo root:
cd ..
APP_ENV=dev npm run sandbox
```

## Build

```bash
npm run build        # tsc --noEmit, then vite build → dist/
npm run preview      # serve the production bundle locally
```

### Windows WDAC note

If your machine has Windows Defender Application Control blocking unsigned native
`.node` binaries (common on managed corporate Windows machines), `vite build` may
fail with "Cannot find module @rollup/rollup-win32-x64-msvc". This is a local
environment issue, not a code issue — the same build runs cleanly on Amplify
Hosting / any standard CI. Workarounds:

1. Build via Amplify Hosting CI (push to your connected branch — it'll build fine).
2. Build inside WSL2 where the WDAC policy doesn't apply:
   ```bash
   wsl -d Ubuntu
   cd /mnt/c/Users/User/Desktop/'Admisntrative AI'/frontend
   npm run build
   ```
3. On unlocked machines, `npm install` alone is sufficient.

## Included vertical slices

### ✅ Fully implemented (production-grade)

1. **Auth shell** — sign-in with MFA, forgot-password flow, ProtectedRoute, session
   expiry warning.
2. **App layout** — role-scoped collapsible sidebar, topbar with FY badge, theme
   switcher, user menu.
3. **Dashboard** — role-aware metric cards, live alerts tray (AppSync subscription),
   12-month stock movement chart, 7-day event timeline.
4. **Inventory list** — TanStack Table v8 with row virtualization, global serial
   search, category + status filters, Admin-only purchase price column.
5. **HSN Lookup Tool** — calls the `hsn-validator` Lambda; real-time client-side
   format validation + Gemini-backed AI suggestion with source citation chip.
6. **Import cost estimator** — live forex + full India landed-cost pipeline
   (FOB → CIF → Customs → SWS → Assessable → IGST → Landed).
7. **Command palette** — Cmd/Ctrl+K, role-scoped navigation + keyboard nav.
8. **Chatbot widget** — floating Gemini assistant with grounding citations.
9. **PWA** — manifest, service worker, installable on Android/iOS, offline shell.

### 🛠 Placeholder pages (backend ready, UI pending)

GRN, DC, POs, Vendors, Clients, Projects, Invoices, Bills, Depreciation,
Tally export, BOQ, Transfers, Service tickets, Godowns, Products, Users,
Audit log, System settings, Activity feed, Reports.

Each placeholder page documents what that screen will do. All the data models
and Lambdas exist in the backend — only the UI vertical slice is pending.

## Testing

```bash
npm test
```

Uses Node 20's built-in test runner (not Vitest — see the root README for why
on Windows WDAC machines).

## Path aliases

- `@/*` → `frontend/src/*`
- `@shared/*` → `shared/*` (the root shared utilities)
