# Mirror AI

AI character chat, built to beat polybuzz: characters that remember you, a real character builder, no ad spam, and the same chats on iPhone, Mac and the web.

```
apple/      SwiftUI app, one target for iOS 17+ and macOS 14+
web/        Next.js website
supabase/   Postgres schema + the `chat` edge function that talks to Claude
```

## How it fits together

All three clients talk to one Supabase project. They read characters, chats and messages straight from Postgres (row-level security keeps people in their own chats). Sending a message goes through the `chat` edge function, which holds the Claude API key, builds the prompt from the character's persona plus the chat's long-term memory, streams the reply back, and saves it. The last 80-120 messages always go in word for word; older ones get folded into a running memory summary, plus facts you pin yourself, so long chats don't forget. 18+ bots run on an OpenRouter model instead of Claude.

## Setup

### 1. Supabase

1. Make a project at supabase.com.
2. Install the CLI (`brew install supabase/tap/supabase`), then from this repo:
   ```sh
   supabase init          # once; keeps the existing migrations
   supabase link --project-ref YOUR-PROJECT-REF
   supabase db push
   supabase secrets set OPENROUTER_API_KEY=sk-or-...
   supabase functions deploy chat
   supabase functions deploy feedback
   ```
3. Optional: `supabase secrets set SFW_MODEL=...` / `NSFW_MODEL=...` to pick the OpenRouter model for normal and 18+ bots (defaults `deepseek/deepseek-chat` and `sao10k/l3.3-euryale-70b`). Setting `ANTHROPIC_API_KEY` moves normal bots onto Claude (`CHAT_MODEL`, default `claude-opus-5-5`); 18+ bots always stay on OpenRouter.
   For feedback emails: `RESEND_API_KEY` and `FEEDBACK_EMAIL`.
   Re-run `supabase db push` and `supabase functions deploy chat` whenever you pull new changes.
4. For quick testing, turn off "Confirm email" under Authentication → Providers → Email.

### 2. Apple app (Xcode)

```sh
brew install xcodegen
cd apple
cp MirrorAI/Config.example.xcconfig MirrorAI/Config.xcconfig   # fill in URL + anon key
xcodegen
open MirrorAI.xcodeproj
```

Pick the "My Mac" or an iPhone simulator destination and run. The `.xcodeproj` is generated from `project.yml`, so edit that rather than the project file.

### 3. Website

```sh
cd web
cp .env.example .env.local   # fill in URL + anon key
npm install
npm run dev                  # then open http://localhost:3000
```
