import SwiftUI

struct CreateCharacterView: View {
    @Environment(SessionStore.self) private var session
    @State private var name = ""
    @State private var tagline = ""
    @State private var avatarUrl = ""
    @State private var persona = ""
    @State private var scenario = ""
    @State private var greeting = ""
    @State private var tags = ""
    @State private var visibility = "public"
    @State private var gender = ""
    @State private var categories: Set<CategoryFilter> = []
    @State private var aiArt = false
    @State private var artCredit = ""
    @State private var nsfw = false
    @State private var nsfwCover = false
    @State private var anonymous = false
    @State private var saving = false
    @State private var error: String?
    @State private var created: Character?

    var body: some View {
        Form {
            Section("Basics") {
                TextField("Name", text: $name)
                TextField("Tagline", text: $tagline)
                Picker("Gender", selection: $gender) {
                    Text("Unspecified").tag("")
                    ForEach(GenderFilter.allCases.filter { $0 != .all }) { Text($0.label).tag($0.rawValue) }
                }
            }
            Section("Categories") {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(CategoryFilter.pickable) { c in
                            Chip(label: c.label, selected: categories.contains(c)) {
                                if categories.contains(c) { categories.remove(c) } else { categories.insert(c) }
                            }
                        }
                    }
                }
            }
            Section("Art") {
                TextField("Avatar image URL (optional)", text: $avatarUrl)
                Toggle("This art is AI-generated", isOn: $aiArt)
                if !aiArt { TextField("Artist credit, e.g. @artist (optional)", text: $artCredit) }
            }
            Section("Persona: who they are, how they talk") {
                TextEditor(text: $persona).frame(minHeight: 120)
            }
            Section("Scenario (optional)") {
                TextEditor(text: $scenario).frame(minHeight: 60)
            }
            Section("Greeting: their first message") {
                TextEditor(text: $greeting).frame(minHeight: 60)
            }
            Section {
                Toggle("This bot is 18+", isOn: $nsfw)
                if !nsfw { Toggle("The cover image is 18+", isOn: $nsfwCover) }
                Toggle("Post anonymously", isOn: $anonymous)
            } footer: {
                Text("18+ bots only show on the website for adults who turned the filter off. Anonymous hides your name and profile on this bot.")
            }
            Section {
                TextField("Tags, comma separated", text: $tags)
                Picker("Visibility", selection: $visibility) {
                    Text("Public").tag("public")
                    Text("Unlisted").tag("unlisted")
                    Text("Private").tag("private")
                }
            }
            Section {
                Button(saving ? "Saving…" : "Create", action: save)
                    .disabled(saving || name.isEmpty || persona.isEmpty)
                if let error { Text(error).foregroundStyle(.red) }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("New character")
        .navigationDestination(item: $created) { ChatView(character: $0) }
    }

    private func save() {
        saving = true
        error = nil
        Task {
            defer { saving = false }
            do {
                guard let token = try await session.validToken(), let userId = session.userId else {
                    error = "Log in from the Account tab first."
                    return
                }
                let row = NewCharacter(
                    creatorId: userId, name: name, tagline: tagline,
                    avatarUrl: avatarUrl.isEmpty ? nil : avatarUrl,
                    greeting: greeting, persona: persona, scenario: scenario,
                    tags: tags.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty },
                    visibility: visibility,
                    gender: gender.isEmpty ? nil : gender,
                    categories: categories.map(\.rawValue).sorted(),
                    aiArt: aiArt,
                    artCredit: aiArt || artCredit.isEmpty ? nil : artCredit,
                    nsfw: nsfw,
                    nsfwCover: nsfw || nsfwCover,
                    anonymous: anonymous)
                created = try await Supabase.insert("characters", row, token: token)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
