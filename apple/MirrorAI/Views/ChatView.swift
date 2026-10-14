import SwiftUI

struct ChatView: View {
    let character: Character
    @Environment(SessionStore.self) private var session
    @State private var chatId: UUID?
    @State private var messages: [Message] = []
    @State private var draft = ""
    @State private var sending = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 10) {
                        if !character.greeting.isEmpty { Bubble(text: character.greeting, isUser: false) }
                        ForEach(messages) { m in Bubble(text: m.content, isUser: m.role == .user).id(m.id) }
                        if let error { Text(error).font(.caption).foregroundStyle(.red) }
                    }
                    .padding()
                }
                .onChange(of: messages) { if let last = messages.last { proxy.scrollTo(last.id, anchor: .bottom) } }
            }
            Divider()
            HStack(alignment: .bottom, spacing: 8) {
                TextField("Message \(character.name)", text: $draft, axis: .vertical)
                    .lineLimit(1...5)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(send)
                Button(action: send) { Image(systemName: "arrow.up.circle.fill").font(.title2) }
                    .disabled(sending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .keyboardShortcut(.return, modifiers: .command)
            }
            .padding()
        }
        .navigationTitle(character.name)
        .task { await resume() }
    }

    /// pick up the most recent chat with this character
    private func resume() async {
        guard let token = try? await session.validToken() else { return }
        let chats: [ChatRef] = (try? await Supabase.select("chats", [
            URLQueryItem(name: "select", value: "id"),
            URLQueryItem(name: "character_id", value: "eq.\(character.id.uuidString)"),
            URLQueryItem(name: "order", value: "updated_at.desc"),
            URLQueryItem(name: "limit", value: "1"),
        ], token: token)) ?? []
        guard let chat = chats.first else { return }
        chatId = chat.id
        messages = (try? await Supabase.select("messages", [
            URLQueryItem(name: "select", value: "id,role,content"),
            URLQueryItem(name: "chat_id", value: "eq.\(chat.id.uuidString)"),
            URLQueryItem(name: "order", value: "id"),
        ], token: token)) ?? []
    }

    private func send() {
        let content = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty, !sending else { return }
        draft = ""
        error = nil
        sending = true
        messages.append(Message(role: .user, content: content))
        let reply = Message(role: .assistant, content: "")
        messages.append(reply)

        Task {
            defer { sending = false }
            do {
                guard let token = try await session.validToken() else {
                    error = "Log in from the Account tab first."
                    messages.removeAll { $0.id == reply.id }
                    return
                }
                for try await event in streamChat(characterId: character.id, chatId: chatId, content: content, token: token) {
                    switch event {
                    case .chat(let id): chatId = id
                    case .delta(let text):
                        if let i = messages.firstIndex(where: { $0.id == reply.id }) { messages[i].content += text }
                    case .done: break
                    case .error(let message): error = message
                    }
                }
            } catch {
                self.error = error.localizedDescription
            }
            messages.removeAll { $0.id == reply.id && $0.content.isEmpty }
        }
    }
}

struct Bubble: View {
    let text: String
    let isUser: Bool

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 40) }
            Text(text.isEmpty ? "…" : LocalizedStringKey(text)) // markdown, so *actions* render italic
                .textSelection(.enabled)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .foregroundStyle(isUser ? Color.white : Color.primary)
                .background(isUser ? Theme.accent : Theme.surface, in: RoundedRectangle(cornerRadius: 18))
            if !isUser { Spacer(minLength: 40) }
        }
    }
}
