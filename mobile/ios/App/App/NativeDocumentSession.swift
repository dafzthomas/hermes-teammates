import Foundation

final class NativeDocumentSession {
    private let lock = NSLock()
    private var generation: UInt64 = 0
    private var ready = false
    private var sessionID: String?
    private var retiredSessions = Set<String>()
    private struct CallKey: Hashable {
        let callbackID: String
        let method: String
    }
    private struct QueuedCall {
        let generation: UInt64?
    }
    private var queuedCalls: [CallKey: [QueuedCall]] = [:]

    func enqueue(callbackID: String, method: String, trustedFrame: Bool) {
        lock.lock()
        defer { lock.unlock() }
        let key = CallKey(callbackID: callbackID, method: method)
        queuedCalls[key, default: []].append(QueuedCall(generation: ready && trustedFrame ? generation : nil))
    }

    func dequeue(callbackID: String, method: String) -> UInt64? {
        lock.lock()
        defer { lock.unlock() }
        let key = CallKey(callbackID: callbackID, method: method)
        guard var calls = queuedCalls[key], !calls.isEmpty else { return nil }
        let call = calls.removeFirst()
        queuedCalls[key] = calls.isEmpty ? nil : calls
        return call.generation
    }

    func isCurrent(generation: UInt64) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return ready && self.generation == generation
    }

    func invalidate() {
        lock.lock()
        defer { lock.unlock() }
        generation &+= 1
        ready = false
        if let sessionID { retiredSessions.insert(sessionID) }
        sessionID = nil
    }

    func didCommit() {
        lock.lock()
        defer { lock.unlock() }
        ready = true
    }

    func accept(sessionID: String, generation: UInt64) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard ready, self.generation == generation, !retiredSessions.contains(sessionID) else { return false }
        self.sessionID = sessionID
        return true
    }
}
