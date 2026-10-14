import SwiftUI

struct ChatView: View {
    let character: Character
    @Environment(SessionStore.self) private var session
    @State private var chatId: UUID?
    @State private var messages: [Message] = []
    @State private var draft = ""
    @State private var sending = false
    @State private var error: String?
    @State private var personaId: UUID?
    @State private var chattingAs = ""
    @State private var confirmRestart = false
    @State private var showMemory = false
    @State private var reported = false

    private var starting: Bool { chatId == nil && messages.isEmpty }

    var body: some View {
        if character.nsfw == true {
            ContentUnavailableView("\(character.name) is 18+", systemImage: "eye.slash",
                                   description: Text("18+ bots are only available on the website."))
        } else {
            chat
        }
    }

    private var chat: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 10) {
                        if starting && session.userId != nil {
                            PersonaPicker(character: character, selection: $personaId)
                        }
                        if let username = character.creatorUsername, character.anonymous != true {
                            NavigationLink("by \(character.creatorLabel)") { CreatorView(username: username) }
                                .font(.caption).foregroundStyle(Theme.accent)
                        }
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
        .toolbar {
            ToolbarItem {
                Menu("More", systemImage: "ellipsis.circle") {
                    if chatId != nil {
                        Button("Memory", systemImage: "brain") { showMemory = true }
                        Button("Restart chat", systemImage: "arrow.counterclockwise") { confirmRestart = true }
                            .disabled(sending)
                    }
                    Menu("Report", systemImage: "flag") {
                        ForEach(Self.reportReasons, id: \.0) { reason in
                            Button(reason.1) { Task { await report(reason.0) } }
                        }
                    }
                }
            }
        }
        .sheet(isPresented: $showMemory) {
            if let chatId { NavigationStack { MemorySheet(chatId: chatId) } }
        }
        .alert("Thanks, we got the report.", isPresented: $reported) {}
        .safeAreaInset(edge: .top) {
            if chatId != nil, !chattingAs.isEmpty {
                Text("chatting as \(chattingAs)").font(.caption).foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity).padding(.vertical, 4).background(.bar)
            }
        }
        .confirmationDialog("Start over?", isPresented: $confirmRestart) {
            Button("Restart chat", role: .destructive) {
                chatId = nil
                messages = []
                error = nil
            }
        } message: {
            Text("This chat's history stays saved, but the bot starts fresh and you can pick a persona again.")
        }
        .task { await resume() }
    }

    /// pick up the most recent chat with this character
    private func resume() async {
        guard let token = try? await session.validToken() else { return }
        let chats: [ChatRef] = (try? await Supabase.select("chats", [
            URLQueryItem(name: "select", value: "id,persona:personas(name)"),
            URLQueryItem(name: "character_id", value: "eq.\(character.id.uuidString)"),
            URLQueryItem(name: "order", value: "updated_at.desc"),
            URLQueryItem(name: "limit", value: "1"),
        ], token: token)) ?? []
        guard let chat = chats.first else { return }
        chatId = chat.id
        if let name = chat.persona?.name { chattingAs = name } else { chattingAs = await profileLabel(token: token) }
        messages = (try? await Supabase.select("messages", [
            URLQueryItem(name: "select", value: "id,role,content"),
            URLQueryItem(name: "chat_id", value: "eq.\(chat.id.uuidString)"),
            URLQueryItem(name: "order", value: "id"),
        ], token: token)) ?? []
    }

    static let reportReasons: [(String, String)] = [
        ("mislabeled_nsfw", "Adult content not marked 18+"),
        ("minor_sexualized", "Sexualizes a minor"),
        ("illegal", "Illegal content"),
        ("harassment", "Harassment or targets a real person"),
        ("spam", "Spam"),
        ("other", "Something else"),
    ]

    private func report(_ reason: String) async {
        guard let token = try? await session.validToken(), let uid = session.userId else { return }
        struct Report: Encodable { var reporterId: UUID; var characterId: UUID; var reason: String }
        struct Ack: Decodable { var id: Int }
        let _: Ack? = try? await Supabase.insert("reports", Report(reporterId: uid, characterId: character.id, reason: reason), token: token)
        reported = true
    }

    private func profileLabel(token: String) async -> String {
        guard let uid = session.userId else { return "" }
        let rows: [Profile] = (try? await Supabase.select("profiles", [URLQueryItem(name: "id", value: "eq.\(uid.uuidString)")], token: token)) ?? []
        return rows.first?.label ?? ""
    }

    private func personaName(token: String) async -> String? {
        guard let personaId else { return nil }
        let rows: [Persona] = (try? await Supabase.select("personas", [URLQueryItem(name: "id", value: "eq.\(personaId.uuidString)")], token: token)) ?? []
        return rows.first?.name
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
                for try await event in streamChat(characterId: character.id, chatId: chatId, personaId: personaId, content: content, token: token) {
                    switch event {
                    case .chat(let id):
                        if chatId != id {
                            chatId = id
                            if let name = await personaName(token: token) { chattingAs = name } else { chattingAs = await profileLabel(token: token) }
                        }
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
