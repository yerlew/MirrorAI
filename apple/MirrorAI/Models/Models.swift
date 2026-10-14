import Foundation

struct Character: Codable, Identifiable, Hashable {
    let id: UUID
    var creatorId: UUID
    var name: String
    var tagline: String?
    var avatarUrl: URL?
    var greeting: String
    var persona: String
    var scenario: String
    var tags: [String]
    var visibility: String
    var chatCount: Int
    var gender: String?
    var categories: [String]
    var aiArt: Bool
    var artCredit: String?
    var creator: Creator?

    struct Creator: Codable, Hashable {
        var displayName: String?
        var username: String?
        var label: String { displayName ?? username.map { "@\($0)" } ?? "" }
    }
}

struct NewCharacter: Encodable {
    var creatorId: UUID
    var name: String
    var tagline: String
    var avatarUrl: String?
    var greeting: String
    var persona: String
    var scenario: String
    var tags: [String]
    var visibility: String
    var gender: String?
    var categories: [String]
    var aiArt: Bool
    var artCredit: String?
}

struct ChatRef: Codable, Identifiable {
    let id: UUID
    var persona: PersonaName?
    struct PersonaName: Codable { var name: String }
}

/// public identity: shown on comments and on the bots you post
struct Profile: Codable, Identifiable {
    let id: UUID
    var username: String?
    var displayName: String?
    var label: String { displayName ?? username.map { "@\($0)" } ?? "" }
}

/// private "who i am in this chat" profile, only readable by its owner
struct Persona: Codable, Identifiable, Hashable {
    let id: UUID
    var userId: UUID
    var name: String
    var backstory: String
}

struct PersonaDraft: Encodable {
    var userId: UUID
    var name: String
    var backstory: String
}

/// extra backstory a persona has with one bot only
struct PersonaOverride: Codable {
    var personaId: UUID
    var characterId: UUID
    var userId: UUID
    var extraBackstory: String
}

struct Message: Codable, Identifiable, Equatable {
    enum Role: String, Codable { case user, assistant }
    var id: String
    var role: Role
    var content: String

    enum CodingKeys: String, CodingKey { case id, role, content }

    init(id: String = UUID().uuidString, role: Role, content: String) {
        self.id = id
        self.role = role
        self.content = content
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = String(try c.decode(Int.self, forKey: .id)) // bigint ids from postgres
        role = try c.decode(Role.self, forKey: .role)
        content = try c.decode(String.self, forKey: .content)
    }
}
