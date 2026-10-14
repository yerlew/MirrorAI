import SwiftUI

struct BrowseView: View {
    @Environment(SessionStore.self) private var session
    @State private var characters: [Character] = []
    @State private var search = ""
    @State private var gender: GenderFilter = .all
    @State private var category: CategoryFilter = .recommended
    @AppStorage("noAiArt") private var noAiArt = false
    @State private var error: String?

    private let columns = [GridItem(.adaptive(minimum: 160), spacing: 12)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Picker("Gender", selection: $gender) {
                    ForEach(GenderFilter.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(CategoryFilter.allCases) { c in
                            Chip(label: c.label, selected: category == c) { category = c }
                        }
                    }
                }

                Toggle("No AI art", isOn: $noAiArt)
                    .foregroundStyle(Theme.muted)

                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(characters) { c in
                        NavigationLink(value: c) { CharacterCard(character: c) }
                            .buttonStyle(.plain)
                    }
                }
                if let error { Text(error).foregroundStyle(.red) }
                if characters.isEmpty && error == nil {
                    ContentUnavailableView("Nothing here yet", systemImage: "person.2", description: Text("Make the first one in Create."))
                }
            }
            .padding()
        }
        .background(Theme.background)
        .navigationTitle("For you")
        .navigationDestination(for: Character.self) { ChatView(character: $0) }
        .searchable(text: $search, prompt: "Search characters")
        .task(id: FilterKey(search: search, gender: gender, category: category, noAiArt: noAiArt)) { await load() }
        .refreshable { await load() }
    }

    private struct FilterKey: Equatable {
        var search: String
        var gender: GenderFilter
        var category: CategoryFilter
        var noAiArt: Bool
    }

    private func load() async {
        // "recommended" is popularity for now; swap in a real ranking later
        var query = [
            URLQueryItem(name: "select", value: "*"),
            URLQueryItem(name: "visibility", value: "eq.public"),
            URLQueryItem(name: "order", value: "chat_count.desc"),
            URLQueryItem(name: "limit", value: "60"),
        ]
        let q = search.trimmingCharacters(in: .whitespaces)
        if !q.isEmpty { query.append(URLQueryItem(name: "name", value: "ilike.*\(q)*")) }
        if gender != .all { query.append(URLQueryItem(name: "gender", value: "eq.\(gender.rawValue)")) }
        if category != .recommended { query.append(URLQueryItem(name: "categories", value: "cs.{\(category.rawValue)}")) }
        if noAiArt { query.append(URLQueryItem(name: "ai_art", value: "eq.false")) }
        query.append(URLQueryItem(name: "nsfw", value: "eq.false")) // the apps always keep the nsfw filter on (app store rules)
        do {
            characters = try await Supabase.select("character_cards", query, token: try await session.validToken())
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct Chip: View {
    let label: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.subheadline.weight(.medium))
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .foregroundStyle(selected ? Color.white : Theme.muted)
                .background(selected ? Theme.accent : Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(selected ? Theme.accent : Theme.line))
        }
        .buttonStyle(.plain)
    }
}

struct CharacterCard: View {
    let character: Character

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .bottom) {
                LinearGradient(colors: [Theme.surface2, Theme.accent.opacity(0.18)], startPoint: .topLeading, endPoint: .bottomTrailing)
                    .overlay(Text(character.name.prefix(1)).font(.system(size: 52, weight: .heavy)).foregroundStyle(Theme.accent))
                    .overlay {
                        if let url = character.avatarUrl {
                            AsyncImage(url: url) { $0.resizable().scaledToFill().blur(radius: character.nsfwCover == true ? 24 : 0) } placeholder: { Color.clear }
                        }
                    }
                HStack {
                    Label(character.chatCount.formatted(.number.notation(.compactName)), systemImage: "bubble.left.fill")
                        .font(.caption.weight(.semibold))
                        .shadow(radius: 3)
                    Spacer()
                    if let credit = character.artCredit {
                        Text("art: \(credit)").font(.caption2.weight(.semibold))
                            .padding(.horizontal, 8).padding(.vertical, 2)
                            .background(.black.opacity(0.55), in: Capsule())
                    }
                }
                .foregroundStyle(.white)
                .padding(8)
            }
            .aspectRatio(1, contentMode: .fit)
            .clipped()

            VStack(alignment: .leading, spacing: 4) {
                Text(character.name).font(.headline).lineLimit(1)
                if let tagline = character.tagline {
                    Text(tagline).font(.caption).foregroundStyle(Theme.muted).lineLimit(2)
                }
                if !character.creatorLabel.isEmpty {
                    Text("by \(character.creatorLabel)").font(.caption2).foregroundStyle(Theme.muted)
                }
                if !character.tags.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(character.tags.prefix(3), id: \.self) { tag in
                            Text(tag).font(.caption2).foregroundStyle(Theme.muted)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 5))
                        }
                    }
                    .lineLimit(1)
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.line))
    }
}
