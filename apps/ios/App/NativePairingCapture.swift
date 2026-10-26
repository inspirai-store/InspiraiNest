import AVFoundation
import SwiftUI
import UIKit

private final class NativePairingPreviewLayer: UIView {
  override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
  var preview: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
}

struct NativePairingCapture: UIViewControllerRepresentable {
  let active: Bool
  let onCode: (String) -> Bool
  let onUnavailable: () -> Void
  func makeUIViewController(context: Context) -> Controller {
    Controller(onCode: onCode, onUnavailable: onUnavailable)
  }
  func updateUIViewController(_ controller: Controller, context: Context) {
    controller.setActive(active)
  }
  static func dismantleUIViewController(_ controller: Controller, coordinator: ()) {
    controller.setActive(false)
  }
  final class Controller: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let session = AVCaptureSession()
    private let captureQueue = DispatchQueue(label: "native.pairing.capture")
    private let onCode: (String) -> Bool
    private let onUnavailable: () -> Void
    private var active = false
    private var appeared = false
    private var requesting = false
    private var accepted = false
    // Configuration and start/stop operations are confined to captureQueue.
    private var configured = false
    private var lastCode = ""
    private var lastCodeAt = Date.distantPast
    init(onCode: @escaping (String) -> Bool, onUnavailable: @escaping () -> Void) {
      self.onCode = onCode
      self.onUnavailable = onUnavailable
      super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func loadView() { view = NativePairingPreviewLayer() }
    override func viewDidLoad() {
      super.viewDidLoad()
      let preview = (view as! NativePairingPreviewLayer).preview
      preview.session = session
      preview.videoGravity = .resizeAspectFill
    }
    override func viewDidAppear(_ animated: Bool) {
      super.viewDidAppear(animated)
      appeared = true
      updateCapture()
    }
    override func viewWillDisappear(_ animated: Bool) {
      super.viewWillDisappear(animated)
      appeared = false
      updateCapture()
    }
    override func viewDidLayoutSubviews() {
      super.viewDidLayoutSubviews()
      let orientation = view.window?.windowScene?.interfaceOrientation ?? .portrait
      let value: AVCaptureVideoOrientation
      switch orientation {
      case .landscapeLeft: value = .landscapeLeft
      case .landscapeRight: value = .landscapeRight
      case .portraitUpsideDown: value = .portraitUpsideDown
      default: value = .portrait
      }
      let connection = (view as! NativePairingPreviewLayer).preview.connection
      if connection?.isVideoOrientationSupported == true { connection?.videoOrientation = value }
    }
    func setActive(_ value: Bool) {
      active = value
      updateCapture()
    }
    private func updateCapture() {
      guard active && appeared && !accepted else {
        captureQueue.async { [session] in if session.isRunning { session.stopRunning() } }
        return
      }
      switch AVCaptureDevice.authorizationStatus(for: .video) {
      case .authorized: start()
      case .notDetermined:
        guard !requesting else { return }
        requesting = true
        AVCaptureDevice.requestAccess(for: .video) { [weak self] _ in
          DispatchQueue.main.async {
            self?.requesting = false
            self?.updateCapture()
          }
        }
      default: onUnavailable()
      }
    }
    private func start() {
      captureQueue.async { [weak self] in
        guard let self else { return }
        if !self.configured {
          guard
            let camera = AVCaptureDevice.default(
              .builtInWideAngleCamera, for: .video, position: .back),
            let input = try? AVCaptureDeviceInput(device: camera), self.session.canAddInput(input)
          else {
            DispatchQueue.main.async { self.onUnavailable() }
            return
          }
          self.session.beginConfiguration()
          self.session.addInput(input)
          let output = AVCaptureMetadataOutput()
          guard self.session.canAddOutput(output) else {
            self.session.commitConfiguration()
            DispatchQueue.main.async { self.onUnavailable() }
            return
          }
          self.session.addOutput(output)
          output.setMetadataObjectsDelegate(self, queue: .main)
          guard output.availableMetadataObjectTypes.contains(.qr) else {
            self.session.commitConfiguration()
            DispatchQueue.main.async { self.onUnavailable() }
            return
          }
          output.metadataObjectTypes = [.qr]
          self.session.commitConfiguration()
          self.configured = true
        }
        if !self.session.isRunning { self.session.startRunning() }
      }
    }
    func metadataOutput(
      _ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject],
      from connection: AVCaptureConnection
    ) {
      guard active && appeared && !accepted,
        let code = objects.compactMap({ ($0 as? AVMetadataMachineReadableCodeObject)?.stringValue })
          .first,
        code != lastCode || Date().timeIntervalSince(lastCodeAt) > 1.2
      else { return }
      lastCode = code
      lastCodeAt = Date()
      accepted = onCode(code)
      if accepted {
        lastCode = ""
        setActive(false)
      }
    }
    deinit { captureQueue.async { [session] in if session.isRunning { session.stopRunning() } } }
  }
}
