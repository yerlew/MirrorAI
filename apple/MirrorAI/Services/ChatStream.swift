import Foundation

enum ChatEvent: Decodable {
    case chat(id: UUID)
    case delta(String)
    case done
    case error(String)

    private enum Keys: String, CodingKey { case type, chatId = "chat_id", text, message }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        switch try c.decode(String.self, forKey: .type) {
        case "chat": self = .chat(id: try c.decode(UUID.self, forKey: .chatId))
        case "delta": self = .delta(try c.decode(String.self, forKey: .text))
        case "done": self = .done
        default: self = .error((try? c.decode(String.self, forKey: .message)) ?? "something broke")
        }
    }
}

/// posts to the chat edge function and yields its server-sent events as they arrive
/// personaId only matters when starting a new chat (chatId nil)
func streamChat(characterId: UUID, chatId: UUID?, personaId: UUID?, content: String, token: String) -> AsyncThrowingStream<ChatEvent, Error> {
    AsyncThrowingStream { continuation in
        let task = Task {
            do {
                var body: [String: String] = ["character_id": characterId.uuidString, "content": content]
                if let chatId { body["chat_id"] = chatId.uuidString } else if let personaId { body["persona_id"] = personaId.uuidString }
                let req = Supabase.request("functions/v1/chat", method: "POST", body: try JSONEncoder().encode(body), token: token)
                let (bytes, res) = try await URLSession.shared.bytes(for: req)
                guard (res as? HTTPURLResponse)?.statusCode == 200 else {
                    throw Supabase.APIError(message: "request failed (\((res as? HTTPURLResponse)?.statusCode ?? 0))")
                }
                for try await line in bytes.lines where line.hasPrefix("data: ") {
                    let event = try JSONDecoder().decode(ChatEvent.self, from: Data(line.dropFirst(6).utf8))
                    continuation.yield(event)
                }
                continuation.finish()
            } catch {
                continuation.finish(throwing: error)
            }
        }
        continuation.onTermination = { _ in task.cancel() }
    }
}
