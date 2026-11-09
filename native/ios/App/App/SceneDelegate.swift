import UIKit
import Capacitor
import WebKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = GuavaBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// The web view as Guava Poker needs it on iPhone:
/// - no up/down/done bar above the keyboard (the page has its own buttons), and
/// - behind the keyboard, the colour of whatever the page shows at the bottom of the
///   screen (a sheet, the table, the nav), not the dark launch colour, so no band
///   shows around the keyboard's rounded corners or under the page.
class GuavaBridgeViewController: CAPBridgeViewController {
    private var launchColor: UIColor?

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        launchColor = view.backgroundColor
        if let webView = webView { Self.hideAccessoryBar(in: webView) }
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(keyboardWillShow),
                           name: UIResponder.keyboardWillShowNotification, object: nil)
        center.addObserver(self, selector: #selector(keyboardDidHide),
                           name: UIResponder.keyboardDidHideNotification, object: nil)
    }

    // Reads the background at the bottom of the page: the first element there with a
    // solid colour, else the root. A 1x1 canvas turns any CSS colour format into RGB.
    private static let bottomColorScript = """
    (function () {
      var ctx = document.createElement('canvas').getContext('2d');
      function rgb(c) {
        if (!c) return null;
        ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1);
        var d = ctx.getImageData(0, 0, 1, 1).data;
        return d[3] > 200 ? [d[0], d[1], d[2]] : null;
      }
      var el = document.elementFromPoint(innerWidth / 2, innerHeight - 2);
      for (; el; el = el.parentElement) {
        var c = rgb(getComputedStyle(el).backgroundColor);
        if (c) return c;
      }
      return rgb(getComputedStyle(document.body).backgroundColor)
        || rgb(getComputedStyle(document.documentElement).backgroundColor);
    })()
    """

    @objc private func keyboardWillShow() {
        guard let webView = webView else { return }
        Self.hideAccessoryBar(in: webView)
        webView.evaluateJavaScript(Self.bottomColorScript) { [weak self] result, _ in
            guard let parts = result as? [NSNumber], parts.count == 3 else { return }
            let color = UIColor(red: CGFloat(parts[0].doubleValue) / 255,
                                green: CGFloat(parts[1].doubleValue) / 255,
                                blue: CGFloat(parts[2].doubleValue) / 255, alpha: 1)
            self?.paintBehindPage(color)
        }
    }

    @objc private func keyboardDidHide() {
        if let color = launchColor { paintBehindPage(color) }
    }

    private func paintBehindPage(_ color: UIColor) {
        view.backgroundColor = color
        webView?.backgroundColor = color
        webView?.scrollView.backgroundColor = color
    }

    // WKWebView's keyboard bar comes from its content view's inputAccessoryView.
    // Swap that view to a subclass that returns nil (what the Capacitor Keyboard plugin does).
    private static func hideAccessoryBar(in webView: WKWebView) {
        guard let content = webView.scrollView.subviews.first(where: {
            String(describing: type(of: $0)).hasPrefix("WKContent")
        }) else { return }
        let base: AnyClass = type(of: content)
        let baseName = NSStringFromClass(base)
        if baseName.hasSuffix("_GuavaNoBar") { return }
        let name = baseName + "_GuavaNoBar"
        var cls: AnyClass? = NSClassFromString(name)
        if cls == nil, let made = objc_allocateClassPair(base, name, 0) {
            let selector = #selector(getter: UIResponder.inputAccessoryView)
            let noBar: @convention(block) (AnyObject) -> UIView? = { _ in nil }
            if let method = class_getInstanceMethod(UIView.self, selector) {
                class_addMethod(made, selector, imp_implementationWithBlock(noBar),
                                method_getTypeEncoding(method))
            }
            objc_registerClassPair(made)
            cls = made
        }
        if let cls = cls { object_setClass(content, cls) }
    }
}
