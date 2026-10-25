import UIKit
import WebKit
import Capacitor

struct NativeRect: Decodable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    var valid: Bool {
        [x, y, width, height].allSatisfy { $0.isFinite && abs($0) <= 20_000 } && width >= 0 && height >= 0
    }
}
struct NativeViewport: Decodable {
    let width: Double
    let height: Double
    var valid: Bool { width.isFinite && height.isFinite && width > 0 && height > 0 && width <= 20_000 && height <= 20_000 }
}
enum AvatarColor: String, Decodable { case white, violet, green, orange, blue, pink }
enum NativeSurface: String, Decodable { case chat, computer }
struct NativeNavigation: Decodable {
    let rect: NativeRect
    let title: String
    let subtitle: String?
    let backLabel: String?
    let backVisible: Bool
    let detailsVisible: Bool
    let detailsLabel: String?
    let selectedSurface: NativeSurface?
    let computerVisible: Bool?
    let settingsVisible: Bool?
    let avatarColor: AvatarColor?
    let group: Bool?
}
struct NativeComposer: Decodable {
    let rect: NativeRect
    let visible: Bool
    let focusRequest: Int?
    let draft: String
    let placeholder: String
    let disabled: Bool
    let submitDisabled: Bool
    let submitLabel: String
    let stopVisible: Bool
    let stopDisabled: Bool
    let stopLabel: String?
    let attachmentVisible: Bool?
    let attachmentDisabled: Bool?
    let attachmentLabel: String?
}
struct NativePresentation: Decodable {
    let version: Int
    let sessionId: String
    let scopeId: String
    let revision: Int
    let draftSequence: Int
    let visible: Bool
    let viewport: NativeViewport
    let navigation: NativeNavigation
    let composer: NativeComposer
    var valid: Bool {
        let labels = [navigation.title, navigation.subtitle, navigation.backLabel, navigation.detailsLabel,
                      composer.placeholder, composer.submitLabel, composer.stopLabel, composer.attachmentLabel]
        return version == 1 && !sessionId.isEmpty && sessionId.utf16.count <= 128 && scopeId.utf16.count <= 256 &&
            revision >= 0 && draftSequence >= 0 && viewport.valid && navigation.rect.valid && composer.rect.valid &&
            (composer.focusRequest ?? 0) >= 0 && (composer.focusRequest ?? 0) <= 9_007_199_254_740_991 &&
            composer.draft.utf16.count <= 60_000 && labels.allSatisfy { ($0?.utf16.count ?? 0) <= 256 }
    }
}

final class HermesBridgeViewController: CAPBridgeViewController {
    private let controls = HermesNativeControlsPlugin()
    private var navigationDelegate: NativeNavigationDelegate?
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(controls)
        if let webView, let existing = webView.navigationDelegate,
           let messages = existing as? WKScriptMessageHandler {
            let controller = webView.configuration.userContentController
            controller.removeScriptMessageHandler(forName: "bridge")
            controller.add(NativeBridgeMessages(downstream: messages, controls: controls), name: "bridge")
            let delegate = NativeNavigationDelegate(downstream: existing, controls: controls)
            navigationDelegate = delegate
            webView.navigationDelegate = delegate
        }
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        controls.layoutControls()
    }
}

private final class NativeBridgeMessages: NSObject, WKScriptMessageHandler {
    private let downstream: WKScriptMessageHandler
    private weak var controls: HermesNativeControlsPlugin?

    init(downstream: WKScriptMessageHandler, controls: HermesNativeControlsPlugin) {
        self.downstream = downstream
        self.controls = controls
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if let body = message.body as? [String: Any], body["type"] as? String == "message",
           body["pluginId"] as? String == "HermesNativeControls",
           let method = body["methodName"] as? String, method == "present" || method == "hide" {
            let url = message.frameInfo.request.url
            controls?.enqueue(callbackID: body["callbackId"] as? String ?? "", method: method,
                              trustedFrame: message.frameInfo.isMainFrame && url?.scheme == "capacitor" && url?.host == "localhost")
        }
        downstream.userContentController(userContentController, didReceive: message)
    }
}

private final class NativeNavigationDelegate: NSObject, WKNavigationDelegate {
    private let downstream: WKNavigationDelegate
    private weak var controls: HermesNativeControlsPlugin?

    init(downstream: WKNavigationDelegate, controls: HermesNativeControlsPlugin) {
        self.downstream = downstream
        self.controls = controls
        super.init()
    }

    override func responds(to selector: Selector!) -> Bool {
        super.responds(to: selector) || downstream.responds(to: selector)
    }

    override func forwardingTarget(for selector: Selector!) -> Any? {
        downstream.responds(to: selector) ? downstream : super.forwardingTarget(for: selector)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        controls?.invalidateDocument()
        downstream.webView?(webView, didStartProvisionalNavigation: navigation)
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        controls?.documentDidCommit()
        downstream.webView?(webView, didCommit: navigation)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        controls?.invalidateDocument()
        downstream.webView?(webView, didFail: navigation, withError: error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        controls?.invalidateDocument()
        downstream.webView?(webView, didFailProvisionalNavigation: navigation, withError: error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        controls?.invalidateDocument()
        downstream.webViewWebContentProcessDidTerminate?(webView)
    }
}

@objc(HermesNativeControlsPlugin)
final class HermesNativeControlsPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "HermesNativeControlsPlugin"
    let jsName = "HermesNativeControls"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "present", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hide", returnType: CAPPluginReturnPromise)
    ]
    private var controls: NativeControlsView?
    private let document = NativeDocumentSession()

    @objc func present(_ call: CAPPluginCall) {
        guard let generation = document.dequeue(callbackID: call.callbackId, method: "present") else {
            call.resolve(["active": false])
            return
        }
        guard let options = call.options, JSONSerialization.isValidJSONObject(options),
              let data = try? JSONSerialization.data(withJSONObject: options), data.count <= 262_144,
              let state = try? JSONDecoder().decode(NativePresentation.self, from: data), state.valid else {
            call.reject("Invalid native controls presentation")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self, let webView = self.bridge?.webView,
                  webView.url?.scheme == "capacitor", webView.url?.host == "localhost" else {
                call.reject("Native controls require the local app document")
                return
            }
            guard self.document.accept(sessionID: state.sessionId, generation: generation) else {
                call.resolve(["active": false])
                return
            }
            if self.controls == nil {
                self.controls = NativeControlsView(host: webView) { [weak self] action in
                    self?.notifyListeners("action", data: action)
                }
            }
            call.resolve(["active": self.controls?.present(state) ?? false])
        }
    }
    @objc func hide(_ call: CAPPluginCall) {
        guard let generation = document.dequeue(callbackID: call.callbackId, method: "hide") else {
            call.resolve()
            return
        }
        DispatchQueue.main.async { [weak self] in
            if let self, self.document.isCurrent(generation: generation) { self.controls?.hide() }
            call.resolve()
        }
    }
    func enqueue(callbackID: String, method: String, trustedFrame: Bool) {
        document.enqueue(callbackID: callbackID, method: method, trustedFrame: trustedFrame)
    }
    func invalidateDocument() {
        document.invalidate()
        controls?.detach()
        controls = nil
    }
    func documentDidCommit() { document.didCommit() }
    func layoutControls() { controls?.layout() }
}

private final class NativeFace: UIView {
    var color: AvatarColor = .white { didSet { setNeedsDisplay() } }
    var group = false { didSet { setNeedsDisplay() } }
    override func draw(_ rect: CGRect) {
        guard let context = UIGraphicsGetCurrentContext() else { return }
        if group {
            UIImage(systemName: "person.2.fill")?.withTintColor(.label, renderingMode: .alwaysOriginal).draw(in: bounds)
            return
        }
        context.scaleBy(x: bounds.width / 48, y: bounds.height / 48)
        let colors: [AvatarColor: UInt32] = [.white: 0xf4f4f4, .violet: 0xa179ee, .green: 0x55c67d,
                                           .orange: 0xf18b36, .blue: 0x4388f7, .pink: 0xf06c97]
        let rgb = colors[color] ?? 0xf4f4f4
        UIColor(red: CGFloat((rgb >> 16) & 255) / 255, green: CGFloat((rgb >> 8) & 255) / 255,
                blue: CGFloat(rgb & 255) / 255, alpha: 1).setFill()
        let path = UIBezierPath()
        path.move(to: CGPoint(x: 24, y: 3))
        path.addCurve(to: CGPoint(x: 43, y: 27), controlPoint1: CGPoint(x: 36, y: 3), controlPoint2: CGPoint(x: 44, y: 14))
        path.addCurve(to: CGPoint(x: 21, y: 44), controlPoint1: CGPoint(x: 42, y: 39), controlPoint2: CGPoint(x: 33, y: 46))
        path.addCurve(to: CGPoint(x: 5, y: 22), controlPoint1: CGPoint(x: 9, y: 43), controlPoint2: CGPoint(x: 3, y: 34))
        path.addCurve(to: CGPoint(x: 24, y: 3), controlPoint1: CGPoint(x: 6, y: 10), controlPoint2: CGPoint(x: 13, y: 3))
        path.close()
        path.fill()
        UIColor(white: 21 / 255, alpha: 1).setFill()
        UIBezierPath(roundedRect: CGRect(x: 16, y: 18, width: 4.5, height: 11), cornerRadius: 2.25).fill()
        UIBezierPath(roundedRect: CGRect(x: 28, y: 18, width: 4.5, height: 11), cornerRadius: 2.25).fill()
    }
}

private final class ComposerTextView: UITextView {
    var submit: (() -> Void)?
    override var keyCommands: [UIKeyCommand]? {
        let command = UIKeyCommand(title: "Send message", action: #selector(sendMessage), input: "\r", modifierFlags: .command)
        return (super.keyCommands ?? []) + [command]
    }
    @objc private func sendMessage() {
        if markedTextRange == nil { submit?() }
    }
}

private final class NativeControlsView: NSObject, UITextViewDelegate {
    private weak var host: WKWebView?
    private let emit: ([String: Any]) -> Void
    private var state: NativePresentation?
    private var sequence = 0
    private var lastFocusRequest = 0
    private let headerContent = UIView()
    private var header = UIView()
    private var identity = UIVisualEffectView()
    private var actions = UIVisualEffectView()
    private var backSurface = UIVisualEffectView()
    private var composer = UIVisualEffectView()
    private let face = NativeFace()
    private let title = UILabel()
    private let subtitle = UILabel()
    private let back = UIButton(type: .system)
    private let details = UIButton(type: .system)
    private let settings = UIButton(type: .system)
    private let tabs = UISegmentedControl(items: ["Chat", "Computer"])
    private let attachment = UIButton(type: .system)
    private let submit = UIButton(type: .system)
    private let stop = UIButton(type: .system)
    private let editor = ComposerTextView()
    private let placeholder = UILabel()

    init(host: WKWebView, emit: @escaping ([String: Any]) -> Void) {
        self.host = host
        self.emit = emit
        super.init()
        face.isOpaque = false
        face.isAccessibilityElement = false
        title.font = UIFont.preferredFont(forTextStyle: .subheadline)
        title.adjustsFontForContentSizeCategory = true
        title.lineBreakMode = .byTruncatingTail
        subtitle.font = UIFont.preferredFont(forTextStyle: .caption2)
        subtitle.adjustsFontForContentSizeCategory = true
        subtitle.textColor = .secondaryLabel
        configure(back, symbol: "chevron.left", title: nil, label: "Back", action: #selector(backAction))
        configure(details, symbol: "info.circle", title: nil, label: "Details", action: #selector(detailsAction))
        configure(settings, symbol: "gearshape", title: nil, label: "Bot settings", action: #selector(settingsAction))
        configure(attachment, symbol: "plus", title: nil, label: "Add attachment", action: #selector(attachmentAction))
        configure(submit, symbol: "arrow.up", title: nil, label: "Send message", action: #selector(submitAction))
        configure(stop, symbol: "stop.fill", title: nil, label: "Stop", action: #selector(stopAction))
        tabs.addTarget(self, action: #selector(surfaceAction), for: .valueChanged)
        tabs.accessibilityLabel = "Conversation surface"
        editor.delegate = self
        editor.backgroundColor = .clear
        editor.font = UIFont.preferredFont(forTextStyle: .body)
        editor.adjustsFontForContentSizeCategory = true
        editor.textColor = .label
        editor.textContainerInset = UIEdgeInsets(top: 7, left: 2, bottom: 7, right: 2)
        editor.isScrollEnabled = true
        editor.keyboardDismissMode = .interactive
        editor.accessibilityLabel = "Message"
        editor.submit = { [weak self] in self?.submitAction() }
        placeholder.font = editor.font
        placeholder.adjustsFontForContentSizeCategory = true
        placeholder.textColor = .placeholderText
        placeholder.isUserInteractionEnabled = false
        placeholder.isAccessibilityElement = false
        rebuildSurfaces()
        NotificationCenter.default.addObserver(self, selector: #selector(accessibilityChanged), name: UIAccessibility.reduceTransparencyStatusDidChangeNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(accessibilityChanged), name: UIAccessibility.reduceMotionStatusDidChangeNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(layoutChanged), name: UIContentSizeCategory.didChangeNotification, object: nil)
    }
    deinit { NotificationCenter.default.removeObserver(self) }

    private func configure(_ button: UIButton, symbol: String?, title: String?, label: String, action: Selector) {
        if let symbol { button.setImage(UIImage(systemName: symbol), for: .normal) }
        button.setTitle(title, for: .normal)
        button.accessibilityLabel = label
        button.tintColor = .label
        button.addTarget(self, action: action, for: .touchUpInside)
    }
    private func surface() -> UIVisualEffectView {
        let result: UIVisualEffectView
        if #available(iOS 26.0, *), !UIAccessibility.isReduceTransparencyEnabled {
            let effect = UIGlassEffect(style: .regular)
            effect.isInteractive = !UIAccessibility.isReduceMotionEnabled
            result = UIVisualEffectView(effect: effect)
        } else {
            result = UIVisualEffectView(effect: nil)
            result.backgroundColor = .secondarySystemBackground
        }
        result.layer.cornerRadius = 26
        result.clipsToBounds = true
        result.overrideUserInterfaceStyle = .dark
        return result
    }
    private func rebuildSurfaces() {
        header.removeFromSuperview()
        composer.removeFromSuperview()
        identity.removeFromSuperview()
        actions.removeFromSuperview()
        backSurface.removeFromSuperview()
        identity = surface()
        actions = surface()
        backSurface = surface()
        composer = surface()
        [face, title, subtitle].forEach { identity.contentView.addSubview($0) }
        [tabs, details, settings].forEach { actions.contentView.addSubview($0) }
        backSurface.contentView.addSubview(back)
        [editor, placeholder, attachment, submit, stop].forEach { composer.contentView.addSubview($0) }
        [identity, actions, backSurface].forEach { headerContent.addSubview($0) }
        if #available(iOS 26.0, *) {
            let effect = UIGlassContainerEffect()
            effect.spacing = 4
            let group = UIVisualEffectView(effect: effect)
            group.contentView.addSubview(headerContent)
            header = group
        } else { header = headerContent }
        header.overrideUserInterfaceStyle = .dark
        header.isHidden = true
        composer.isHidden = true
        host?.addSubview(header)
        host?.addSubview(composer)
    }
    @objc private func accessibilityChanged() {
        rebuildSurfaces()
        if let state { _ = present(state) }
    }
    @objc private func layoutChanged() { layout() }
    func hide() {
        header.isHidden = true
        composer.isHidden = true
        editor.resignFirstResponder()
    }
    func detach() {
        hide()
        state = nil
        editor.text = ""
        header.removeFromSuperview()
        composer.removeFromSuperview()
    }
    func present(_ next: NativePresentation) -> Bool {
        let sameScope = state?.sessionId == next.sessionId && state?.scopeId == next.scopeId
        if sameScope, let state, next.revision < state.revision { return !header.isHidden }
        if !sameScope { sequence = 0; editor.undoManager?.removeAllActions() }
        if state?.sessionId != next.sessionId { lastFocusRequest = 0 }
        state = next
        guard next.visible else { hide(); return false }
        header.isHidden = false
        composer.isHidden = !next.composer.visible
        if composer.isHidden { editor.resignFirstResponder() }
        let nav = next.navigation
        let input = next.composer
        title.text = nav.title
        subtitle.text = nav.subtitle
        subtitle.isHidden = (nav.subtitle ?? "").isEmpty
        face.color = nav.avatarColor ?? .white
        face.group = nav.group ?? false
        backSurface.isHidden = !nav.backVisible
        back.accessibilityLabel = nav.backLabel ?? "Back"
        details.isHidden = !nav.detailsVisible
        details.accessibilityLabel = nav.detailsLabel ?? "Details"
        settings.isHidden = !(nav.settingsVisible ?? false)
        tabs.isHidden = !(nav.computerVisible ?? false)
        tabs.selectedSegmentIndex = nav.selectedSurface == .computer ? 1 : 0
        attachment.isHidden = !(input.attachmentVisible ?? false)
        attachment.isEnabled = !(input.attachmentDisabled ?? false)
        attachment.accessibilityLabel = input.attachmentLabel ?? "Add attachment"
        stop.isHidden = !input.stopVisible
        stop.isEnabled = !input.stopDisabled
        stop.accessibilityLabel = input.stopLabel ?? "Stop"
        submit.isEnabled = !input.submitDisabled
        submit.accessibilityLabel = input.submitLabel
        submit.setImage(UIImage(systemName: input.stopVisible ? "arrow.turn.up.right" : "arrow.up"), for: .normal)
        submit.accessibilityHint = input.stopVisible ? "Send steering to the active run" : nil
        editor.isEditable = !input.disabled
        editor.accessibilityLabel = input.placeholder
        placeholder.text = input.placeholder
        if (!sameScope || next.draftSequence >= sequence), editor.text != input.draft,
           editor.markedTextRange == nil || !sameScope {
            let selection = editor.selectedRange
            editor.text = input.draft
            editor.selectedRange = NSRange(location: min(selection.location, input.draft.utf16.count), length: 0)
        }
        placeholder.isHidden = !editor.text.isEmpty
        layout()
        let focusRequest = input.focusRequest ?? 0
        if !composer.isHidden, editor.isEditable, focusRequest > lastFocusRequest, editor.becomeFirstResponder() {
            lastFocusRequest = focusRequest
            editor.selectedRange = NSRange(location: editor.text.utf16.count, length: 0)
        }
        return true
    }
    private func frame(_ rect: NativeRect, viewport: NativeViewport) -> CGRect {
        guard let host else { return .zero }
        let scale = host.bounds.width / viewport.width
        return CGRect(x: rect.x * scale, y: rect.y * scale, width: rect.width * scale, height: rect.height * scale)
    }
    func layout() {
        guard let state, state.visible, let host else { return }
        header.frame = frame(state.navigation.rect, viewport: state.viewport)
        headerContent.frame = header.bounds
        composer.frame = frame(state.composer.rect, viewport: state.viewport)
        host.bringSubviewToFront(header)
        host.bringSubviewToFront(composer)
        let width = header.bounds.width
        let height = header.bounds.height
        let actionWidth: CGFloat = (tabs.isHidden ? 0 : 126) + (details.isHidden ? 0 : 44) + (settings.isHidden ? 0 : 44)
        let backWidth: CGFloat = backSurface.isHidden ? 0 : 44
        let textWidth = (state.navigation.title as NSString).size(withAttributes: [.font: title.font!]).width
        let identityWidth = min(min(220, max(96, textWidth + 50)), max(60, width - actionWidth - backWidth - 20))
        let identityX = min(max(backWidth + 6, (width - identityWidth) / 2), width - actionWidth - identityWidth - 6)
        let pillHeight: CGFloat = UIApplication.shared.preferredContentSizeCategory.isAccessibilityCategory ? min(height, 56) : 44
        identity.frame = CGRect(x: identityX, y: (height - pillHeight) / 2, width: identityWidth, height: pillHeight)
        backSurface.frame = CGRect(x: 2, y: (height - 44) / 2, width: backWidth, height: 44)
        back.frame = backSurface.bounds
        actions.isHidden = actionWidth == 0
        actions.frame = CGRect(x: width - actionWidth - 2, y: (height - 44) / 2, width: actionWidth, height: 44)
        var x: CGFloat = 0
        if !tabs.isHidden { tabs.frame = CGRect(x: x, y: 5, width: 126, height: 34); x += 126 }
        if !details.isHidden { details.frame = CGRect(x: x, y: 0, width: 44, height: 44); x += 44 }
        if !settings.isHidden { settings.frame = CGRect(x: x, y: 0, width: 44, height: 44) }
        face.frame = CGRect(x: 9, y: (pillHeight - 24) / 2, width: 24, height: 24)
        title.frame = CGRect(x: 39, y: subtitle.isHidden ? (pillHeight - 22) / 2 : 4, width: max(0, identityWidth - 47), height: subtitle.isHidden ? 24 : 22)
        subtitle.frame = CGRect(x: 39, y: pillHeight - 18, width: max(0, identityWidth - 47), height: 14)
        guard !composer.isHidden else { return }
        let w = composer.bounds.width
        let h = composer.bounds.height
        attachment.frame = CGRect(x: 2, y: (h - 44) / 2, width: 44, height: 44)
        submit.frame = CGRect(x: w - 46, y: (h - 44) / 2, width: 44, height: 44)
        stop.frame = CGRect(x: w - 90, y: (h - 44) / 2, width: 44, height: 44)
        let left: CGFloat = attachment.isHidden ? 10 : 46
        editor.frame = CGRect(x: left, y: 3, width: max(20, w - left - (stop.isHidden ? 48 : 92)), height: max(34, h - 6))
        placeholder.frame = CGRect(x: left + 7, y: (h - 24) / 2, width: max(0, editor.bounds.width - 14), height: 24)
    }
    private func action(_ type: String) {
        guard let state, !header.isHidden else { return }
        var event: [String: Any] = ["type": type, "scopeId": state.scopeId, "sessionId": state.sessionId, "sequence": sequence]
        if type == "draft" || type == "submit" { event["draft"] = editor.text ?? "" }
        emit(event)
    }
    func textViewDidChange(_ textView: UITextView) {
        sequence += 1
        placeholder.isHidden = !editor.text.isEmpty
        action("draft")
    }
    func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
        (textView.text as NSString).length - range.length + (text as NSString).length <= 60_000
    }
    @objc private func submitAction() {
        guard submit.isEnabled, editor.isEditable, editor.markedTextRange == nil else { return }
        sequence += 1
        action("submit")
    }
    @objc private func stopAction() { if stop.isEnabled { action("stop") } }
    @objc private func backAction() { action("back") }
    @objc private func detailsAction() { action("details") }
    @objc private func settingsAction() { action("settings") }
    @objc private func attachmentAction() { if attachment.isEnabled { action("attachment") } }
    @objc private func surfaceAction() { action(tabs.selectedSegmentIndex == 1 ? "computer" : "chat") }
}
