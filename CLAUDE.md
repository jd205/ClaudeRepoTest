# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run setup       # First-time setup: install deps + Prisma migrate + generate client
npm run dev         # Start dev server with Turbopack at http://localhost:3000
npm run dev:daemon  # Start dev server in background (logs to logs.txt)
npm run build       # Production build
npm run lint        # ESLint
npm run test        # Vitest test suite
npx vitest run src/lib/__tests__/file-system.test.ts  # Run a single test file
npm run db:reset    # Reset SQLite database to initial state
```

## Environment

Requires a `.env` file at the root:
```
ANTHROPIC_API_KEY=""  # Optional — if blank, a mock provider is used automatically
JWT_SECRET=""         # Optional — defaults to "development-secret-key" if unset
```

The mock provider returns static component examples (Counter, Form, Card) and caps agentic steps at 4 (real provider allows up to 40).

## Architecture

UIGen is a Next.js 15 (App Router) app that lets users generate React components via AI chat, with live preview.

### Virtual File System

The central abstraction is an **in-memory virtual file system** (`src/lib/file-system.ts`) — no files are written to disk. All AI-generated code lives here and is serialized to JSON for database storage. The `FileSystemContext` (`src/lib/contexts/`) exposes this to the UI.

### AI Agent Loop

1. User sends a message via `ChatInterface`
2. POST to `/api/chat/route.ts` with messages + current virtual FS state
3. The route uses the Vercel AI SDK (`streamText`) with the Anthropic provider (`src/lib/provider.ts`) — model: `claude-haiku-4-5`
4. The AI has two tools: `str_replace_editor` (create/read/update files) and `file_manager` (directory ops), both defined in `src/lib/tools/`
   - `str_replace_editor` commands: `view`, `create`, `str_replace`, `insert`
   - `file_manager` commands: `rename`, `delete`
5. Steps stream back; the AI is instructed to always produce `/App.jsx` as the entry point
6. On completion, the final file system + messages are persisted to the database (if authenticated)

`/api/chat` is intentionally public (no auth required) to support anonymous users. Only `/api/projects` and `/api/filesystem` require authentication.

### Preview

`PreviewFrame` compiles JSX in-browser via `src/lib/transform/jsx-transformer.ts`:
1. Each `.jsx/.tsx` file is Babel-transformed and turned into a Blob URL
2. An [importmap](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap) is injected so `import` statements resolve to those Blob URLs
3. Third-party npm packages (non-relative, non-`@/` imports) are resolved automatically via `https://esm.sh/<pkg>`
4. CSS imports are stripped from JS and injected as `<style>` tags; Tailwind CSS is loaded via CDN
5. The whole thing runs in a sandboxed `<iframe>` — no server round-trip for preview updates

**Generated code conventions** (enforced by the system prompt in `src/lib/prompts/generation.tsx`):
- Entry point is always `/App.jsx` with a default export
- Local imports must use the `@/` alias (e.g. `import Foo from '@/components/Foo'`), not relative paths
- Styling uses Tailwind CSS classes, not inline styles or CSS modules

### Auth

JWT-based (`jose` + `bcrypt`), 7-day expiration, HTTP-only cookies. Anonymous use is supported. Middleware at `src/middleware.ts` handles routing.

### Database

SQLite via Prisma. Two models: `User` and `Project`. Projects store `messages` (JSON string) and `files` (serialized virtual FS). Schema at `prisma/schema.prisma`. Prisma client is generated to `src/generated/prisma` (not the default location). A singleton pattern in `src/lib/prisma.ts` prevents multiple instances in dev mode.

### Key Directories

- `src/app/` — Next.js routes and API handlers
- `src/components/` — UI split into `auth/`, `chat/`, `editor/`, `preview/`, `ui/` (shadcn)
- `src/lib/` — Core logic: auth, file system, AI provider, tools, prompts, contexts
- `src/actions/` — Next.js server actions
- `src/hooks/` — React hooks

### Contexts

Two central providers wrap the app:
- **`FileSystemProvider`** / `useFileSystem()` — manages virtual FS state, dispatches tool call results, tracks selected file
- **`ChatProvider`** / `useChat()` — wraps Vercel AI SDK's `useChat`, integrates with `FileSystemContext`, handles anonymous work persistence

### Testing

Vitest + React Testing Library. Config in `vitest.config.mts` (jsdom environment). Server action tests use `@vitest-environment node`. Use `vi.mock()` for `server-only`, `next/headers`, and contexts.

### Anonymous Work Tracking

`src/lib/anon-work-tracker.ts` stores in-progress anonymous work in `sessionStorage`. When an anonymous user signs in or registers, this data is transferred to their new project so work isn't lost.

### Path Alias

`@/*` maps to `src/*` in the Next.js app. Inside the **virtual FS** (generated components), `@/` maps to the virtual root `/` — handled by the import map transformer, not tsconfig.
