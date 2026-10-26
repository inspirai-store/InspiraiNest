import AVFoundation
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct NativeRecordPickedFile: Identifiable {
  let id = UUID()
  let url: URL
  let name: String
  let mime: String
}
/// Copy inside the provider callback: the provider removes its temporary URL on return.
struct NativeRecordPhotoPicker: UIViewControllerRepresentable {
  let limit: Int
  let completed: ([NativeRecordPickedFile], String?) -> Void
  func makeCoordinator() -> Coordinator { Coordinator(completed) }
  func makeUIViewController(context: Context) -> PHPickerViewController {
    var config = PHPickerConfiguration(photoLibrary: .shared())
    config.selectionLimit = max(1, limit); config.filter = .any(of: [.images, .videos])
    config.preferredAssetRepresentationMode = .current; config.selection = .ordered
    let picker = PHPickerViewController(configuration: config); picker.delegate = context.coordinator
    return picker
  }
  func updateUIViewController(_ view: PHPickerViewController, context: Context) {}
  final class Coordinator: NSObject, PHPickerViewControllerDelegate {
    let completed: ([NativeRecordPickedFile], String?) -> Void
    init(_ completed: @escaping ([NativeRecordPickedFile],String?) -> Void) { self.completed = completed }
    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
      Task {
        var files: [NativeRecordPickedFile] = []; var message: String?
        // Sequential loading keeps picker order and bounds peak memory.
        for result in results {
          let provider = result.itemProvider
          guard let identifier = provider.registeredTypeIdentifiers.first(where: {
            UTType($0)?.conforms(to: .image) == true || UTType($0)?.conforms(to: .movie) == true
          }) else { message = "部分所选文件无法导入"; continue }
          do {
            let value: NativeRecordPickedFile = try await withCheckedThrowingContinuation { continuation in
              provider.loadFileRepresentation(forTypeIdentifier: identifier) { url, error in
                do {
                  guard let url else { throw error ?? NativeRecordMediaError.unavailable }
                  let size = try url.resourceValues(forKeys:[.fileSizeKey]).fileSize ?? 0
                  guard size > 0, size <= NativeRecordMediaStore.maximumFile else { throw NativeRecordMediaError.limit("单个附件不能超过 32 MiB") }
                  let dir = FileManager.default.temporaryDirectory.appendingPathComponent("RecordImport/" + UUID().uuidString,isDirectory:true)
                  try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:true)
                  let copy = dir.appendingPathComponent(url.lastPathComponent)
                  try FileManager.default.copyItem(at:url,to:copy)
                  continuation.resume(returning: .init(url:copy,name:url.lastPathComponent,mime:UTType(filenameExtension:url.pathExtension)?.preferredMIMEType ?? UTType(identifier)?.preferredMIMEType ?? "application/octet-stream"))
                } catch { continuation.resume(throwing:error) }
              }
            }
            files.append(value)
          } catch { message = error.localizedDescription }
        }
        await MainActor.run { self.completed(files,message) }
      }
    }
  }
}
struct NativeRecordCameraPicker: UIViewControllerRepresentable {
  let completed: (NativeRecordPickedFile?, String?) -> Void
  func makeCoordinator() -> Coordinator { Coordinator(completed) }
  func makeUIViewController(context: Context) -> UIImagePickerController {
    let view = UIImagePickerController();view.sourceType = .camera;view.mediaTypes = [UTType.image.identifier]
    view.delegate = context.coordinator;return view
  }
  func updateUIViewController(_ view:UIImagePickerController,context:Context) {}
  final class Coordinator:NSObject,UIImagePickerControllerDelegate,UINavigationControllerDelegate {
    let completed:(NativeRecordPickedFile?,String?) -> Void
    init(_ completed:@escaping(NativeRecordPickedFile?,String?) -> Void) { self.completed=completed }
    func imagePickerControllerDidCancel(_ picker:UIImagePickerController) { completed(nil,nil) }
    func imagePickerController(_ picker:UIImagePickerController,didFinishPickingMediaWithInfo info:[UIImagePickerController.InfoKey:Any]) {
      do {
        if let source=info[.imageURL] as? URL {
          let copy=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString+"."+source.pathExtension)
          try FileManager.default.copyItem(at:source,to:copy)
          completed(.init(url:copy,name:"照片."+source.pathExtension,mime:UTType(filenameExtension:source.pathExtension)?.preferredMIMEType ?? "image/jpeg"),nil)
        } else if let image=info[.originalImage] as? UIImage,let data=NativeRecordImage.cameraJPEG(image,metadata:info[.mediaMetadata] as? [String:Any]) {
          let url=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString+".jpg")
          try data.write(to:url,options:.atomic);completed(.init(url:url,name:"照片.jpg",mime:"image/jpeg"),nil)
        } else { throw NativeRecordMediaError.unavailable }
      } catch { completed(nil,error.localizedDescription) }
    }
  }
}
struct NativeRecordActivity: UIViewControllerRepresentable {
  let items:[Any]
  func makeUIViewController(context:Context) -> UIActivityViewController { UIActivityViewController(activityItems:items,applicationActivities:nil) }
  func updateUIViewController(_ view:UIActivityViewController,context:Context) {}
}
