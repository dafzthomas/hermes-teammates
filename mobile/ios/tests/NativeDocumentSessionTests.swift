import Foundation

@main
struct NativeDocumentSessionTests {
    static func main() {
        let document = NativeDocumentSession()
        document.enqueue(callbackID: "before-commit", method: "present", trustedFrame: true)
        document.didCommit()
        precondition(document.dequeue(callbackID: "before-commit", method: "present") == nil)

        // WebKit receives the old document's first call; Capacitor has not invoked the plugin yet.
        document.enqueue(callbackID: "1", method: "present", trustedFrame: true)
        document.enqueue(callbackID: "2", method: "hide", trustedFrame: true)
        document.invalidate()
        document.didCommit()
        let delayedFirstPresentation = document.dequeue(callbackID: "1", method: "present")!
        precondition(!document.accept(sessionID: "never-previously-presented", generation: delayedFirstPresentation))
        precondition(!document.isCurrent(generation: document.dequeue(callbackID: "2", method: "hide")!))

        // A new JS realm can reuse callback IDs while old bridge work is still queued.
        document.enqueue(callbackID: "reused", method: "present", trustedFrame: true)
        document.invalidate()
        document.didCommit()
        document.enqueue(callbackID: "reused", method: "present", trustedFrame: true)
        let old = document.dequeue(callbackID: "reused", method: "present")!
        let current = document.dequeue(callbackID: "reused", method: "present")!
        precondition(!document.accept(sessionID: "old", generation: old))
        precondition(document.accept(sessionID: "current", generation: current))
        precondition(document.dequeue(callbackID: "reused", method: "present") == nil)

        document.enqueue(callbackID: "untrusted", method: "present", trustedFrame: false)
        document.enqueue(callbackID: "untrusted", method: "present", trustedFrame: true)
        precondition(document.dequeue(callbackID: "untrusted", method: "present") == nil)
        precondition(document.isCurrent(generation: document.dequeue(callbackID: "untrusted", method: "present")!))
        precondition(document.dequeue(callbackID: "uncaptured", method: "present") == nil)

        document.enqueue(callbackID: "main-queue", method: "present", trustedFrame: true)
        let beforeMainQueue = document.dequeue(callbackID: "main-queue", method: "present")!
        document.invalidate()
        document.invalidate()
        precondition(!document.accept(sessionID: "current", generation: beforeMainQueue))
        document.didCommit()
        document.enqueue(callbackID: "new", method: "present", trustedFrame: true)
        let afterCrash = document.dequeue(callbackID: "new", method: "present")!
        precondition(!document.accept(sessionID: "current", generation: afterCrash))
        precondition(document.accept(sessionID: "after-crash", generation: afterCrash))
        print("Native document lifecycle regressions passed")
    }
}
