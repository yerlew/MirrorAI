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
    @State private var saving = false
    @State private var error: String?
    @State private var created: Character?

    var body: some View {
        Form {
            Section("Basics") {
                TextField("Name", text: $name)
                TextField("Tagline", text: $tagline)
                TextField("Avatar image URL (optional)", text: $avatarUrl)
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
                    visibility: visibility)
                created = try await Supabase.insert("characters", row, token: token)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
