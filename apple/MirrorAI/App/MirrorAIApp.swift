import SwiftUI

@main
struct MirrorAIApp: App {
    @State private var session = SessionStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .task { await session.restore() }
        }
    }
}

struct RootView: View {
    var body: some View {
        TabView {
            NavigationStack { BrowseView() }
                .tabItem { Label("Explore", systemImage: "sparkles") }
            NavigationStack { CreateCharacterView() }
                .tabItem { Label("Create", systemImage: "plus.circle") }
            NavigationStack { AccountView() }
                .tabItem { Label("Account", systemImage: "person.crop.circle") }
        }
    }
}
