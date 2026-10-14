import SwiftUI

struct ProfileView: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        Group {
            if session.userId == nil { LoginForm() } else { SignedInProfile() }
        }
        .navigationTitle("Profile")
    }
}

/// public profile + private personas
private struct SignedInProfile: View {
    @Environment(SessionStore.self) private var session
    @State private var profile: Profile?
    @State private var personas: [Persona] = []
    @State private var editing: PersonaEditorItem?
    @State private var status: String?

    var body: some View {
        Form {
            if let binding = Binding($profile) {
                Section {
                    TextField("Display name", text: binding.displayName.orEmpty)
                    TextField("Username", text: binding.username.orEmpty)
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        #endif
                    Button("Save profile", action: saveProfile)
                    if let status { Text(status).font(.caption).foregroundStyle(Theme.muted) }
                } header: {
                    Text("Profile")
                } footer: {
                    Text("Public. This is the name on your comments and the bots you post.")
                }
            }

            Section {
                ForEach(personas) { p in
                    Button { editing = PersonaEditorItem(persona: p) } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(p.name).font(.headline)
                            Text(p.backstory.isEmpty ? "No backstory" : p.backstory)
                                .font(.caption).foregroundStyle(Theme.muted).lineLimit(2)
                        }
                    }
                    .buttonStyle(.plain)
                }
                Button("New persona", systemImage: "plus") { editing = PersonaEditorItem(persona: nil) }
            } header: {
                Text("Personas")
            } footer: {
                Text("Private, only you can see these. Pick one when you start a chat so the bot knows who you are.")
            }

            Section {
                Button("Log out", role: .destructive) { session.signOut() }
            }
        }
        .formStyle(.grouped)
        .task { await load() }
        .sheet(item: $editing) { item in
            NavigationStack {
                PersonaEditor(persona: item.persona) { saved in
                    if let i = personas.firstIndex(where: { $0.id == saved.id }) { personas[i] = saved } else { personas.append(saved) }
                } onDelete: { id in
                    personas.removeAll { $0.id == id }
                }
            }
        }
    }

    private func load() async {
        guard let token = try? await session.validToken(), let uid = session.userId else { return }
        profile = (try? await Supabase.select("profiles", [URLQueryItem(name: "id", value: "eq.\(uid.uuidString)")], token: token) as [Profile])?.first
        personas = (try? await Supabase.select("personas", [URLQueryItem(name: "order", value: "created_at")], token: token)) ?? []
    }

    private func saveProfile() {
        guard let profile else { return }
        Task {
            do {
                struct Changes: Encodable { var displayName: String?; var username: String? }
                let token = try await session.validToken()
                let changes = Changes(displayName: profile.displayName, username: profile.username?.lowercased().nilIfEmpty)
                let _: Profile = try await Supabase.update("profiles", [URLQueryItem(name: "id", value: "eq.\(profile.id.uuidString)")], changes, token: token)
                status = "Saved"
            } catch {
                status = "Username: 3-24 chars, a-z 0-9 _ only, and not taken"
            }
        }
    }
}

struct PersonaEditorItem: Identifiable {
    let id = UUID()
    let persona: Persona?
}

struct PersonaEditor: View {
    let persona: Persona?
    var onSave: (Persona) -> Void
    var onDelete: ((UUID) -> Void)? = nil
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var backstory = ""
    @State private var error: String?

    var body: some View {
        Form {
            TextField("Name the bot will call you", text: $name)
            Section("Backstory") {
                TextEditor(text: $backstory).frame(minHeight: 160)
            }
            if let error { Text(error).foregroundStyle(.red) }
            if let persona, let onDelete {
                Button("Delete persona", role: .destructive) {
                    Task {
                        try? await Supabase.delete("personas", [URLQueryItem(name: "id", value: "eq.\(persona.id.uuidString)")], token: try? await session.validToken())
                        onDelete(persona.id)
                        dismiss()
                    }
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle(persona == nil ? "New persona" : "Edit persona")
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) { Button("Save", action: save).disabled(name.isEmpty) }
        }
        .onAppear {
            name = persona?.name ?? ""
            backstory = persona?.backstory ?? ""
        }
    }

    private func save() {
        Task {
            do {
                guard let token = try await session.validToken(), let uid = session.userId else { return }
                let draft = PersonaDraft(userId: uid, name: name, backstory: backstory)
                let saved: Persona
                if let persona {
                    saved = try await Supabase.update("personas", [URLQueryItem(name: "id", value: "eq.\(persona.id.uuidString)")], draft, token: token)
                } else {
                    saved = try await Supabase.insert("personas", draft, token: token)
                }
                onSave(saved)
                dismiss()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

private struct LoginForm: View {
    @Environment(SessionStore.self) private var session
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                TextField("Email", text: $email)
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    #endif
                SecureField("Password", text: $password)
                    .textContentType(.password)
            }
            Section {
                Button("Log in") { run { try await session.signIn(email: email, password: password) } }
                Button("Sign up") { run { try await session.signUp(email: email, password: password) } }
                if let error { Text(error).foregroundStyle(.red) }
            }
            .disabled(busy || email.isEmpty || password.count < 8)
        }
        .formStyle(.grouped)
    }

    private func run(_ action: @escaping () async throws -> Void) {
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do { try await action() } catch { self.error = error.localizedDescription }
        }
    }
}

extension Binding where Value == String? {
    /// edit an optional string in a TextField, storing "" as nil
    var orEmpty: Binding<String> {
        Binding<String>(get: { wrappedValue ?? "" }, set: { wrappedValue = $0.isEmpty ? nil : $0 })
    }
}

extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
