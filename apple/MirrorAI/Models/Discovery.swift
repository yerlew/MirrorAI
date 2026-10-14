import Foundation

/// filters for the for-you feed. add a case and it shows up on home and in the creator.
enum GenderFilter: String, CaseIterable, Identifiable {
    case all, male, female, nonbinary
    var id: String { rawValue }
    var label: String {
        switch self {
        case .all: "All"
        case .male: "Male"
        case .female: "Female"
        case .nonbinary: "Non-binary"
        }
    }
}

enum CategoryFilter: String, CaseIterable, Identifiable {
    case recommended, anime, realism, celebrity, dominant, submissive, oc
    var id: String { rawValue }
    var label: String { self == .oc ? "OC" : rawValue.capitalized }
    /// categories a creator can tag a character with
    static var pickable: [CategoryFilter] { allCases.filter { $0 != .recommended } }
}
