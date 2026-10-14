import SwiftUI

struct AccountView: View {
    @Environment(SessionStore.self) private var session
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        Form {
            if let current = session.email {
                Section { LabeledContent("Logged in as", value: current) }
                Button("Log out", role: .destructive) { session.signOut() }
            } else {
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
        }
        .formStyle(.grouped)
        .navigationTitle("Account")
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
