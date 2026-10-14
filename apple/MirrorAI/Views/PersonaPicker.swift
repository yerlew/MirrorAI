import SwiftUI

/// shown only at the start of a chat: pick who you are, optionally add backstory just for this bot
struct PersonaPicker: View {
    let character: Character
    @Binding var selection: UUID?
    @Environment(SessionStore.self) private var session
    @State private var personas: [Persona] = []
    @State private var profileLabel = ""
    @State private var creating = false
    @State private var extra = ""
    @State private var extraSaved = ""
    @State private var editingExtra = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Who are you in this chat?").font(.headline)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    option(title: profileLabel.isEmpty ? "Just me" : profileLabel, subtitle: "your profile name", selected: selection == nil) { selection = nil }
                    ForEach(personas) { p in
                        option(title: p.name, subtitle: p.backstory.isEmpty ? "no backstory" : p.backstory, selected: selection == p.id) { selection = p.id }
                    }
                    Button { creating = true } label: {
                        Label("New", systemImage: "plus").frame(width: 90, height: 64)
                            .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.accent)
                }
            }

            if let persona = personas.first(where: { $0.id == selection }) {
                HStack {
                    Text(extraSaved.isEmpty ? "Add backstory \(persona.name) has only with \(character.name)" : "\(persona.name) has extra backstory with \(character.name)")
                        .font(.caption).foregroundStyle(Theme.muted)
                    Spacer()
                    Button(editingExtra ? "Close" : "Edit") { editingExtra.toggle() }.font(.caption)
                }
                if editingExtra {
                    TextEditor(text: $extra)
                        .frame(minHeight: 90)
                        .scrollContentBackground(.hidden)
                        .padding(6)
                        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 10))
                    Button("Save for this bot") { Task { await saveExtra(persona) } }
                        .buttonStyle(.borderedProminent)
                        .disabled(extra == extraSaved)
                }
            }
        }
        .padding()
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.line))
        .task { await load() }
        .task(id: selection) { await loadExtra() }
        .sheet(isPresented: $creating) {
            NavigationStack {
                PersonaEditor(persona: nil) { saved in
                    personas.append(saved)
                    selection = saved.id
                }
            }
        }
    }

    private func option(title: String, subtitle: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.semibold)).lineLimit(1)
                Text(subtitle).font(.caption2).foregroundStyle(Theme.muted).lineLimit(2)
            }
            .frame(width: 150, height: 64, alignment: .topLeading)
            .padding(10)
            .background(selected ? Theme.accent.opacity(0.18) : Theme.surface2, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(selected ? Theme.accent : Theme.line))
        }
        .buttonStyle(.plain)
    }

    private func load() async {
        guard let token = try? await session.validToken(), let uid = session.userId else { return }
        personas = (try? await Supabase.select("personas", [URLQueryItem(name: "order", value: "created_at")], token: token)) ?? []
        let me: [Profile] = (try? await Supabase.select("profiles", [URLQueryItem(name: "id", value: "eq.\(uid.uuidString)")], token: token)) ?? []
        profileLabel = me.first?.label ?? ""
    }

    private func loadExtra() async {
        extra = ""
        extraSaved = ""
        editingExtra = false
        guard let selection, let token = try? await session.validToken() else { return }
        let rows: [PersonaOverride] = (try? await Supabase.select("persona_overrides", [
            URLQueryItem(name: "persona_id", value: "eq.\(selection.uuidString)"),
            URLQueryItem(name: "character_id", value: "eq.\(character.id.uuidString)"),
        ], token: token)) ?? []
        extra = rows.first?.extraBackstory ?? ""
        extraSaved = extra
    }

    private func saveExtra(_ persona: Persona) async {
        guard let token = try? await session.validToken(), let uid = session.userId else { return }
        let row = PersonaOverride(personaId: persona.id, characterId: character.id, userId: uid, extraBackstory: extra)
        if let _: PersonaOverride = try? await Supabase.insert("persona_overrides", row, token: token, upsert: true) {
            extraSaved = extra
            editingExtra = false
        }
    }
}
