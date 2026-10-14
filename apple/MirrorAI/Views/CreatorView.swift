import SwiftUI

/// a bot creator's public page: profile, counts, their non-anonymous public bots, follow
struct CreatorView: View {
    let username: String
    @Environment(SessionStore.self) private var session
    @State private var creator: CreatorProfile?
    @State private var bots: [Character] = []
    @State private var following = false

    private let columns = [GridItem(.adaptive(minimum: 160), spacing: 12)]

    var body: some View {
        ScrollView {
            if let creator {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 14) {
                        Text(creator.label.prefix(1)).font(.title.bold()).foregroundStyle(Theme.accent)
                            .frame(width: 64, height: 64).background(Theme.accent.opacity(0.16), in: Circle())
                        VStack(alignment: .leading) {
                            Text(creator.label).font(.title2.bold())
                            if let u = creator.username { Text("@\(u)").foregroundStyle(Theme.muted) }
                        }
                        Spacer()
                        if let me = session.userId, me != creator.id {
                            Button(following ? "Following" : "Follow") { Task { await toggleFollow(me: me) } }
                                .buttonStyle(.borderedProminent)
                                .tint(following ? Theme.surface2 : Theme.accent)
                        }
                    }
                    if !creator.bio.isEmpty { Text(creator.bio) }
                    HStack(spacing: 20) {
                        stat(creator.followerCount, "followers")
                        stat(creator.botCount, "bots")
                        stat(creator.totalChats, "chats")
                    }
                    LazyVGrid(columns: columns, spacing: 12) {
                        ForEach(bots) { c in
                            NavigationLink { ChatView(character: c) } label: { CharacterCard(character: c) }.buttonStyle(.plain)
                        }
                    }
                }
                .padding()
            } else {
                ProgressView().padding()
            }
        }
        .background(Theme.background)
        .navigationTitle(creator?.label ?? "")
        .task { await load() }
    }

    private func stat(_ n: Int, _ label: String) -> some View {
        (Text(n.formatted(.number.notation(.compactName))).bold() + Text(" \(label)").foregroundColor(Theme.muted))
    }

    private func load() async {
        let token = try? await session.validToken()
        let rows: [CreatorProfile] = (try? await Supabase.select("creator_profiles", [URLQueryItem(name: "username", value: "eq.\(username)")], token: token)) ?? []
        guard let c = rows.first else { return }
        creator = c
        bots = (try? await Supabase.select("character_cards", [
            URLQueryItem(name: "creator_id", value: "eq.\(c.id.uuidString)"),
            URLQueryItem(name: "visibility", value: "eq.public"),
            URLQueryItem(name: "nsfw", value: "eq.false"),
            URLQueryItem(name: "order", value: "chat_count.desc"),
        ], token: token)) ?? []
        if token != nil {
            struct Follow: Decodable { var followeeId: UUID }
            let f: [Follow] = (try? await Supabase.select("follows", [URLQueryItem(name: "followee_id", value: "eq.\(c.id.uuidString)")], token: token)) ?? []
            following = !f.isEmpty
        }
    }

    private func toggleFollow(me: UUID) async {
        guard let creator, let token = try? await session.validToken() else { return }
        if following {
            try? await Supabase.delete("follows", [URLQueryItem(name: "followee_id", value: "eq.\(creator.id.uuidString)")], token: token)
        } else {
            struct Follow: Codable { var followerId: UUID; var followeeId: UUID }
            let _: Follow? = try? await Supabase.insert("follows", Follow(followerId: me, followeeId: creator.id), token: token)
        }
        following.toggle()
        self.creator?.followerCount += following ? 1 : -1
    }
}
