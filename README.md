# Mirror AI

AI character chat, built to beat polybuzz: characters that remember you, a real character builder, no ad spam, and the same chats on iPhone, Mac and the web.

```
apple/      SwiftUI app, one target for iOS 17+ and macOS 14+
web/        Next.js website
supabase/   Postgres schema + the `chat` edge function that talks to Claude
```

## How it fits together

All three clients talk to one Supabase project. They read characters, chats and messages straight from Postgres (row-level security keeps people in their own chats). Sending a message goes through the `chat` edge function, which holds the Claude API key, builds the prompt from the character's persona plus the chat's long-term memory, streams the reply back, and saves it. Every 20 messages past the last 40, it folds the older ones into a running memory summary, so long chats don't forget.

## Setup

### 1. Supabase

1. Make a project at supabase.com.
2. Install the CLI (`brew install supabase/tap/supabase`), then from this repo:
   ```sh
   supabase init          # once; keeps the existing migrations
   supabase link --project-ref YOUR-PROJECT-REF
   supabase db push
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   supabase functions deploy chat
   ```
3. Optional: `supabase secrets set CHAT_MODEL=...` to change the model (default `claude-opus-5-5`).
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
npm run dev
```
