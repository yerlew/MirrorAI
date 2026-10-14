import Foundation
import Observation
import Security

/// tiny supabase client: password auth, postgrest queries, and the chat edge function.
/// no third-party deps on purpose.
enum Supabase {
    // set in Config.xcconfig; falls back to a local `supabase start` instance
    static let url = URL(string: Bundle.main.object(forInfoDictionaryKey: "SupabaseURL") as? String ?? "")
        ?? URL(string: "http://127.0.0.1:54321")!
    static let anonKey = Bundle.main.object(forInfoDictionaryKey: "SupabaseAnonKey") as? String ?? ""

    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()
    static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.keyEncodingStrategy = .convertToSnakeCase
        return e
    }()

    struct APIError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    static func request(_ path: String, method: String = "GET", query: [URLQueryItem] = [], body: Data? = nil,
                        token: String?, extraHeaders: [String: String] = [:]) -> URLRequest {
        var comps = URLComponents(url: url.appending(path: path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { comps.queryItems = query }
        var req = URLRequest(url: comps.url!)
        req.httpMethod = method
        req.httpBody = body
        req.setValue(anonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(token ?? anonKey)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        extraHeaders.forEach { req.setValue($1, forHTTPHeaderField: $0) }
        return req
    }

    static func send<T: Decodable>(_ req: URLRequest) async throws -> T {
        let (data, res) = try await URLSession.shared.data(for: req)
        guard let http = res as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let msg = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])
                .flatMap { $0["msg"] ?? $0["message"] ?? $0["error_description"] } as? String
            throw APIError(message: msg ?? "request failed")
        }
        return try decoder.decode(T.self, from: data)
    }

    /// GET /rest/v1/<table>?<query>
    static func select<T: Decodable>(_ table: String, _ query: [URLQueryItem], token: String?) async throws -> [T] {
        try await send(request("rest/v1/\(table)", query: query, token: token))
    }

    static func insert<T: Decodable>(_ table: String, _ row: some Encodable, token: String?) async throws -> T {
        let req = request("rest/v1/\(table)", method: "POST", body: try encoder.encode(row), token: token,
                          extraHeaders: ["Prefer": "return=representation", "Accept": "application/vnd.pgrst.object+json"])
        return try await send(req)
    }
}

struct AuthSession: Codable {
    var accessToken: String
    var refreshToken: String
    var expiresAt: Date
    var user: AuthUser
    struct AuthUser: Codable { var id: UUID; var email: String? }
}

@MainActor
@Observable
final class SessionStore {
    private(set) var session: AuthSession?
    var userId: UUID? { session?.user.id }
    var email: String? { session?.user.email }

    private struct TokenResponse: Decodable {
        var accessToken: String
        var refreshToken: String
        var expiresIn: Double
        var user: AuthSession.AuthUser
    }

    private struct SignupResponse: Decodable {
        var accessToken: String?
        var refreshToken: String?
        var expiresIn: Double?
        var user: AuthSession.AuthUser?
    }

    func restore() async {
        guard let data = Keychain.read(), let saved = try? JSONDecoder().decode(AuthSession.self, from: data) else { return }
        session = saved
        _ = try? await validToken()
    }

    func signIn(email: String, password: String) async throws {
        try await token(grant: "password", body: ["email": email, "password": password])
    }

    func signUp(email: String, password: String) async throws {
        let req = Supabase.request("auth/v1/signup", method: "POST",
                                   body: try JSONEncoder().encode(["email": email, "password": password]), token: nil)
        // with email confirmation off this returns a session; otherwise the user confirms by email, then logs in
        let res: SignupResponse = try await Supabase.send(req)
        if let token = res.accessToken, let refresh = res.refreshToken, let expires = res.expiresIn, let user = res.user {
            store(TokenResponse(accessToken: token, refreshToken: refresh, expiresIn: expires, user: user))
        }
    }

    func signOut() {
        session = nil
        Keychain.delete()
    }

    /// access token, refreshed if it expires within a minute
    func validToken() async throws -> String? {
        guard let s = session else { return nil }
        if s.expiresAt.timeIntervalSinceNow > 60 { return s.accessToken }
        do {
            try await token(grant: "refresh_token", body: ["refresh_token": s.refreshToken])
        } catch {
            signOut()
            throw error
        }
        return session?.accessToken
    }

    private func token(grant: String, body: [String: String]) async throws {
        let req = Supabase.request("auth/v1/token", method: "POST", query: [URLQueryItem(name: "grant_type", value: grant)],
                                   body: try JSONEncoder().encode(body), token: nil)
        store(try await Supabase.send(req))
    }

    private func store(_ res: TokenResponse) {
        let s = AuthSession(accessToken: res.accessToken, refreshToken: res.refreshToken,
                            expiresAt: Date().addingTimeInterval(res.expiresIn), user: res.user)
        session = s
        if let data = try? JSONEncoder().encode(s) { Keychain.write(data) }
    }
}

enum Keychain {
    private static let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "com.yerlew.mirrorai",
        kSecAttrAccount as String: "session",
    ]

    static func read() -> Data? {
        var q = query
        q[kSecReturnData as String] = true
        var out: AnyObject?
        return SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess ? out as? Data : nil
    }

    static func write(_ data: Data) {
        delete()
        var q = query
        q[kSecValueData as String] = data
        SecItemAdd(q as CFDictionary, nil)
    }

    static func delete() {
        SecItemDelete(query as CFDictionary)
    }
}
