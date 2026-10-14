import SwiftUI

@main
struct MirrorAIApp: App {
    @State private var session = SessionStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .mirrorTheme()
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
            NavigationStack { ProfileView() }
                .tabItem { Label("Profile", systemImage: "person.crop.circle") }
        }
    }
}
