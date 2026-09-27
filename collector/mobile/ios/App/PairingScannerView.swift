import AVFoundation
import PhotosUI
import SwiftUI
import Vision

struct PairingQRCode: Equatable {
    let server: String
    let key: String

    private struct Payload: Decodable {
        let `protocol`: String
        let version: Int
        let server: String
        let key: String
        let role: String
        let expiresAt: String
    }

    static func parse(_ raw: String, now: Date = Date()) throws -> Self {
        guard raw.utf8.count <= 4096,
              let payload = try? JSONDecoder().decode(Payload.self, from: Data(raw.utf8)),
              payload.protocol == "personal-library-pairing", payload.version == 1 else {
            throw QRPairingError.invalid
        }
        guard payload.role == "owner" else { throw QRPairingError.worker }
        guard (32...200).contains(payload.key.utf8.count),
              payload.key.utf8.allSatisfy({ (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95 }),
              let origin = try? ServerOrigin(payload.server) else { throw QRPairingError.invalid }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let expiry = formatter.date(from: payload.expiresAt)
            ?? ISO8601DateFormatter().date(from: payload.expiresAt)
        guard let expiry else { throw QRPairingError.invalid }
        guard expiry > now else { throw QRPairingError.expired }
        return Self(server: origin.value, key: payload.key)
    }
}

private enum QRPairingError: LocalizedError {
    case invalid, worker, expired

    var errorDescription: String? {
        switch self {
        case .invalid: return "这不是有效的资料库手机配对二维码。"
        case .worker: return "这是电脑采集端二维码，请在网页生成手机管理端二维码。"
        case .expired: return "配对二维码已过期，请在网页重新生成。"
        }
    }
}

struct PairingScannerView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var selectedPhoto: PhotosPickerItem?
    @State private var error: String?
    let onScan: (PairingQRCode) -> Void

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Text("扫描网页「授权设备」中的手机管理端二维码")
                    .font(.footnote).foregroundStyle(.secondary)
                PairingCameraView(onCode: accept, onError: { error = $0 })
                    .frame(maxWidth: .infinity, maxHeight: 360)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .accessibilityLabel("二维码相机取景框")
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                PhotosPicker(selection: $selectedPhoto, matching: .images) {
                    Label("从相册识别二维码", systemImage: "photo")
                }
                Spacer(minLength: 0)
            }
            .padding()
            .navigationTitle("扫码配对")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("取消") { dismiss() } } }
            .onChange(of: selectedPhoto) { item in
                guard let item else { return }
                Task { await recognize(item) }
            }
        }
    }

    @discardableResult private func accept(_ raw: String) -> Bool {
        do { onScan(try PairingQRCode.parse(raw)); return true }
        catch { self.error = error.localizedDescription; return false }
    }

    private func recognize(_ item: PhotosPickerItem) async {
        do {
            guard let data = try await item.loadTransferable(type: Data.self), data.count <= 15_000_000 else {
                throw QRPairingError.invalid
            }
            let request = VNDetectBarcodesRequest()
            request.symbologies = [.qr]
            try VNImageRequestHandler(data: data).perform([request])
            guard let raw = request.results?.first(where: { $0.symbology == .qr })?.payloadStringValue else {
                throw QRPairingError.invalid
            }
            accept(raw)
        } catch { self.error = error.localizedDescription }
        selectedPhoto = nil
    }
}

private final class CameraPreview: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
}

private struct PairingCameraView: UIViewControllerRepresentable {
    let onCode: (String) -> Bool
    let onError: (String) -> Void

    func makeUIViewController(context: Context) -> CameraController {
        CameraController(onCode: onCode, onError: onError)
    }
    func updateUIViewController(_ controller: CameraController, context: Context) {}
}

private final class CameraController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let session = AVCaptureSession()
    private let captureQueue = DispatchQueue(label: "library.pairing.camera")
    private let onCode: (String) -> Bool
    private let onError: (String) -> Void
    private var configured = false
    private var accepted = false

    init(onCode: @escaping (String) -> Bool, onError: @escaping (String) -> Void) {
        self.onCode = onCode; self.onError = onError
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func loadView() { view = CameraPreview() }
    override func viewDidLoad() {
        super.viewDidLoad()
        let preview = (view as! CameraPreview).previewLayer
        preview.session = session
        preview.videoGravity = .resizeAspectFill
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: start()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] allowed in
                DispatchQueue.main.async {
                    if allowed { self?.start() }
                    else { self?.onError("请在系统设置中允许相机访问，或从相册识别二维码。") }
                }
            }
        default: onError("请在系统设置中允许相机访问，或从相册识别二维码。")
        }
    }
    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        captureQueue.async { [session] in if session.isRunning { session.stopRunning() } }
    }
    private func start() {
        guard !accepted else { return }
        if !configured {
            guard let camera = AVCaptureDevice.default(for: .video),
                  let input = try? AVCaptureDeviceInput(device: camera), session.canAddInput(input) else {
                onError("相机暂不可用，可以从相册识别二维码。")
                return
            }
            session.beginConfiguration()
            session.addInput(input)
            let output = AVCaptureMetadataOutput()
            guard session.canAddOutput(output) else {
                session.commitConfiguration()
                onError("无法开启二维码识别。")
                return
            }
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = [.qr]
            session.commitConfiguration()
            configured = true
        }
        captureQueue.async { [session] in if !session.isRunning { session.startRunning() } }
    }
    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard !accepted, let code = (objects.first as? AVMetadataMachineReadableCodeObject)?.stringValue else { return }
        accepted = onCode(code)
    }
}
