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
