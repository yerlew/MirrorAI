import SwiftUI

/// every bot you've talked to, newest first. only you can see this list.
struct ChatsView: View {
    @Environment(SessionStore.self) private var session
    @State private var rows: [(character: Character, updatedAt: String)] = []
    @State private var loaded = false
    @State private var pendingDelete: Character?

    var body: some View {
        List {
            ForEach(rows, id: \.character.id) { row in
                NavigationLink(value: row.character) {
                    HStack(spacing: 12) {
                        Text(row.character.name.prefix(1)).font(.headline).foregroundStyle(Theme.accent)
                            .frame(width: 40, height: 40).background(Theme.accent.opacity(0.16), in: Circle())
                        VStack(alignment: .leading) {
                            Text(row.character.name).font(.headline)
                            Text(row.updatedAt.prefix(10)).font(.caption).foregroundStyle(Theme.muted)
                        }
                    }
                }
                .swipeActions {
                    Button("Delete", role: .destructive) { pendingDelete = row.character }
                }
                .contextMenu {
                    Button("Delete chats", role: .destructive) { pendingDelete = row.character }
                }
            }
        }
        .overlay {
            if loaded && rows.isEmpty {
                ContentUnavailableView("No chats yet", systemImage: "bubble.left.and.bubble.right",
                                       description: Text(session.userId == nil ? "Log in from Profile to start chatting." : "Bots you chat with show up here."))
            }
        }
        .navigationTitle("Chats")
        .navigationDestination(for: Character.self) { ChatView(character: $0) }
        .task { await load() }
        .refreshable { await load() }
        .confirmationDialog("Delete all your chats with \(pendingDelete?.name ?? "")?", isPresented: Binding(
            get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }
        ), titleVisibility: .visible) {
            Button("Delete for good", role: .destructive) { if let c = pendingDelete { Task { await delete(c) } } }
        }
    }

    private func load() async {
        defer { loaded = true }
        guard let token = try? await session.validToken() else { rows = []; return }
        let chats: [ChatSummary] = (try? await Supabase.select("chats", [
            URLQueryItem(name: "select", value: "character_id,updated_at"),
            URLQueryItem(name: "order", value: "updated_at.desc"),
            URLQueryItem(name: "limit", value: "500"),
        ], token: token)) ?? []
        var latest: [(UUID, String)] = []
        for c in chats where !latest.contains(where: { $0.0 == c.characterId }) { latest.append((c.characterId, c.updatedAt)) }
        guard !latest.isEmpty else { rows = []; return }
        let ids = latest.map { $0.0.uuidString.lowercased() }.joined(separator: ",")
        let cards: [Character] = (try? await Supabase.select("character_cards", [URLQueryItem(name: "id", value: "in.(\(ids))")], token: token)) ?? []
        rows = latest.compactMap { id, at in cards.first { $0.id == id }.map { ($0, at) } }
    }

    private func delete(_ c: Character) async {
        guard let token = try? await session.validToken() else { return }
        try? await Supabase.delete("chats", [URLQueryItem(name: "character_id", value: "eq.\(c.id.uuidString)")], token: token)
        rows.removeAll { $0.character.id == c.id }
    }
}
