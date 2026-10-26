#if DEBUG
  import CoreImage.CIFilterBuiltins
  import SwiftUI
  import UIKit

  @MainActor struct NativePairingReview: View {
    let configuration: NativeReviewConfiguration
    @StateObject private var model: NativePairingModel
    @StateObject private var library = NativeLibraryModel()
    @State private var module: NativeAppModule = .devices
    @State private var closed = false
    init(configuration: NativeReviewConfiguration) {
      self.configuration = configuration
      let flags = ProcessInfo.processInfo.arguments
      let model = NativePairingModel(
        name: UIDevice.current.userInterfaceIdiom == .pad ? "我的 iPad" : "我的 iPhone",
        dependencies: .init(pair: { _, _, _ in
          if flags.contains("--review-pairing-slow") {
            try await Task.sleep(nanoseconds: 2_000_000_000)
          }
          if flags.contains("--review-pairing-fail") || configuration.page == "S14" {
            throw CollectorError.http(401)
          }
        }))
      model.key = "review42"
      if ["P28", "P29", "S12"].contains(configuration.page) { model.openScanner() }
      if configuration.page == "S14" {
        model.key = ""
        _ = model.accept(NativePairingFixture.code(expiry: Date(timeIntervalSince1970: 0)))
      }
      if configuration.page == "P30" { _ = model.accept(NativePairingFixture.code()) }
      if flags.contains("--review-pairing-offline") { model.setOffline(true) }
      _model = StateObject(wrappedValue: model)
    }
    var body: some View {
      NativePairingShell(
        model: model, module: $module, library: library, close: { closed = true },
        reviewCamera: true, reviewDenied: configuration.page == "S12",
        cameraTheme: configuration.appearance ?? .light
      )
      .environment(\.colorScheme, configuration.appearance ?? .light)
      .task {
        if configuration.page == "P29" { model.photos = true }
      }
      .overlay {
        if closed {
          NativeText("设备", size: 24, bold: true).frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(.systemBackground)).accessibilityIdentifier("pairing.closed")
        }
      }
    }
  }

  enum NativePairingFixture {
    static let secret = "review-only-code-000000000000000000000000000"
    static func code(
      expiry: Date = Date().addingTimeInterval(3600), role: String = "owner",
      server: String = "https://library.inspirai.store"
    ) -> String {
      let data = try! JSONSerialization.data(
        withJSONObject: [
          "protocol": "personal-library-pairing", "version": 1, "server": server, "key": secret,
          "role": role, "expiresAt": ISO8601DateFormatter().string(from: expiry),
        ], options: [.sortedKeys])
      return String(data: data, encoding: .utf8)!
    }
    static func image(_ raw: String = code()) -> Data {
      let filter = CIFilter.qrCodeGenerator()
      filter.message = Data(raw.utf8)
      filter.correctionLevel = "M"
      let code = filter.outputImage!
      let image = code.composited(
        over: CIImage(color: .white).cropped(to: code.extent.insetBy(dx: -4, dy: -4))
      )
      .transformed(by: CGAffineTransform(scaleX: 6, y: 6))
      let cg = CIContext().createCGImage(image, from: image.extent)!
      return UIImage(cgImage: cg).pngData()!
    }
  }
#endif
