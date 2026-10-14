import SwiftUI

struct BrowseView: View {
    @Environment(SessionStore.self) private var session
    @State private var characters: [Character] = []
    @State private var search = ""
    @State private var error: String?

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: 12)]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 12) {
                ForEach(characters) { c in
                    NavigationLink(value: c) { CharacterCard(character: c) }
                        .buttonStyle(.plain)
                }
            }
            .padding()
            if let error { Text(error).foregroundStyle(.red).padding() }
            if characters.isEmpty && error == nil {
                ContentUnavailableView("No characters yet", systemImage: "person.2", description: Text("Make the first one in Create."))
            }
        }
        .navigationTitle("Explore")
        .navigationDestination(for: Character.self) { ChatView(character: $0) }
        .searchable(text: $search, prompt: "Search characters")
        .task(id: search) { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        var query = [
            URLQueryItem(name: "select", value: "*"),
            URLQueryItem(name: "visibility", value: "eq.public"),
            URLQueryItem(name: "order", value: "chat_count.desc"),
            URLQueryItem(name: "limit", value: "60"),
        ]
        let q = search.trimmingCharacters(in: .whitespaces)
        if !q.isEmpty { query.append(URLQueryItem(name: "name", value: "ilike.*\(q)*")) }
        do {
            characters = try await Supabase.select("characters", query, token: try await session.validToken())
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct CharacterCard: View {
    let character: Character

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            AsyncImage(url: character.avatarUrl) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Text(character.name.prefix(1)).font(.largeTitle.bold()).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity).background(.quaternary)
            }
            .aspectRatio(1, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            Text(character.name).font(.headline).lineLimit(1)
            if let tagline = character.tagline {
                Text(tagline).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            Label("\(character.chatCount)", systemImage: "bubble.left").font(.caption2).foregroundStyle(.secondary)
        }
        .padding(10)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 16))
    }
}
