import SwiftUI

/// color tokens. views read these instead of hard-coding colors, so user themes later only swap the values.
enum Theme {
    static let accent = Color(red: 1.0, green: 0.31, blue: 0.64)       // #ff4fa3
    static let background = Color(red: 0.04, green: 0.04, blue: 0.05)  // #0a0a0c
    static let surface = Color(red: 0.08, green: 0.08, blue: 0.09)     // #141418
    static let surface2 = Color(red: 0.12, green: 0.12, blue: 0.14)    // #1e1e24
    static let line = Color(red: 0.16, green: 0.16, blue: 0.20)        // #2a2a32
    static let muted = Color(red: 0.62, green: 0.62, blue: 0.67)       // #9d9daa
}

extension View {
    /// pink-on-black look for a whole screen
    func mirrorTheme() -> some View {
        tint(Theme.accent)
            .preferredColorScheme(.dark)
    }
}
