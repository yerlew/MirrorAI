import SwiftUI

/// what the bot remembers about this chat. pinned facts are yours; the summary is written by the bot but you can fix it.
struct MemorySheet: View {
    let chatId: UUID
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var pinned = ""
    @State private var memory = ""
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                TextEditor(text: $pinned).frame(minHeight: 100)
            } header: {
                Text("Pinned")
            } footer: {
                Text("Things the bot must always remember. It never changes these.")
            }
            Section {
                TextEditor(text: $memory).frame(minHeight: 220)
            } header: {
                Text("What it remembers from older messages")
            } footer: {
                Text("The bot writes this as the chat grows. Fix anything it got wrong.")
            }
            if let error { Text(error).foregroundStyle(.red) }
        }
        .formStyle(.grouped)
        .navigationTitle("Memory")
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save() } } }
        }
        .task {
            let rows: [ChatMemory] = (try? await Supabase.select("chats", [
                URLQueryItem(name: "select", value: "memory,pinned"),
                URLQueryItem(name: "id", value: "eq.\(chatId.uuidString)"),
            ], token: try? await session.validToken())) ?? []
            pinned = rows.first?.pinned ?? ""
            memory = rows.first?.memory ?? ""
        }
    }

    private func save() async {
        do {
            let _: ChatMemory = try await Supabase.update("chats", [URLQueryItem(name: "id", value: "eq.\(chatId.uuidString)")],
                                                          ChatMemory(memory: memory, pinned: pinned), token: try await session.validToken())
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
