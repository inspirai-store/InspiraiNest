import AVFoundation
import SwiftUI

struct NativeRecordRecordingSession: Codable, Equatable {
  var id: String
  var draftID: String
  var scope: String
  var createdAt: String
  var name: String
  var note: String = ""
  var segments: [String] = []
  var active: String?
  var duration: Double = 0
  var state: String = "paused"
}
/// Audio buffers continue through one engine tap. Closing a two-second CAF segment
/// never stops the input device, so checkpoints do not introduce recording gaps.
final class NativeRecordAudioSink: @unchecked Sendable {
  private let lock=NSLock()
  private let directory:URL
  private var value:NativeRecordRecordingSession
  private var file:AVAudioFile?
  private var currentDuration:Double=0
  private var levels:[CGFloat]=[]
  private var issue:String?
  init(directory:URL,session:NativeRecordRecordingSession) {self.directory=directory;value=session}
  private func persist() throws {
    try JSONEncoder().encode(value).write(to:directory.appendingPathComponent("session.json"),options:[.atomic,.completeFileProtectionUntilFirstUserAuthentication])
  }
  func consume(_ buffer:AVAudioPCMBuffer) {
    lock.lock();defer {lock.unlock()}
    guard issue == nil else {return}
    do {try autoreleasepool {
      if file == nil {
        let name=UUID().uuidString+".caf";value.active=name;try persist()
        let url=directory.appendingPathComponent(name)
        file=try AVAudioFile(forWriting:url,settings:buffer.format.settings)
        try FileManager.default.setAttributes([.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication],ofItemAtPath:url.path)
      }
      try file?.write(from:buffer)
      currentDuration += Double(buffer.frameLength)/buffer.format.sampleRate
      if let channel=buffer.floatChannelData?[0],buffer.frameLength > 0 {
        var peak:Float=0
        for index in 0..<Int(buffer.frameLength) {peak=max(peak,abs(channel[index]))}
        levels.append(CGFloat(max(0.04,min(1,sqrt(peak)))))
        if levels.count > 140 {levels.removeFirst(levels.count-140)}
      }
      if currentDuration >= 2 {try sealLocked()}
    }} catch {issue=error.localizedDescription}
  }
  private func sealLocked() throws {
    file=nil
    if let active=value.active,currentDuration > 0 {value.segments.append(active);value.duration += currentDuration}
    value.active=nil;currentDuration=0;try persist()
  }
  func seal(state:String) throws -> NativeRecordRecordingSession {
    lock.lock();defer {lock.unlock()};value.state=state;try sealLocked();return value
  }
  func updateNote(_ note:String) throws {lock.lock();defer {lock.unlock()};value.note=note;try persist()}
  func snapshot()->(NativeRecordRecordingSession,Double,[CGFloat],String?) {
    lock.lock();defer {lock.unlock()};return(value,value.duration+currentDuration,levels,issue)
  }
}

protocol NativeRecordAudioInput:Sendable {
  var requiresMicrophone:Bool {get}
  func start(sink:NativeRecordAudioSink) async throws
  func stop() async
}
actor NativeRecordAudioDriver:NativeRecordAudioInput {
  nonisolated let requiresMicrophone=true
  private var engine:AVAudioEngine?
  func start(sink:NativeRecordAudioSink) throws {
    let audio=AVAudioSession.sharedInstance()
    try audio.setCategory(.playAndRecord,mode:.default,options:[.defaultToSpeaker,.allowBluetooth]);try audio.setActive(true)
    let engine=AVAudioEngine(),input=engine.inputNode,format=input.outputFormat(forBus:0)
    guard format.sampleRate > 0,format.channelCount > 0 else {throw NativeRecordMediaError.unavailable}
    input.installTap(onBus:0,bufferSize:1024,format:format) {buffer,_ in sink.consume(buffer)}
    self.engine=engine;engine.prepare();try engine.start()
  }
  func stop() {engine?.stop();engine?.inputNode.removeTap(onBus:0);engine=nil}
}

@MainActor final class NativeRecordRecorder: NSObject, ObservableObject, AVAudioPlayerDelegate {
  enum State: String { case ready, recording, paused, interrupted, preview, denied, failure }
  @Published private(set) var state: State = .ready
  @Published private(set) var elapsed: Double = 0
  @Published private(set) var durable: Double = 0
  @Published private(set) var bytes: Int = 0
  @Published private(set) var samples: [CGFloat] = []
  @Published private(set) var error: String?
  @Published private(set) var busy = false
  @Published private(set) var playing = false
  @Published var note = "" { didSet {if note != oldValue {saveNote()}} }
  @Published var discardConfirmation = false
  @Published var playback: Double = 0
  let directory: URL
  let draftID: String
  let scope: String
  private(set) var session: NativeRecordRecordingSession?
  private let driver:any NativeRecordAudioInput
  private var startup=UUID()
  private var sink:NativeRecordAudioSink?
  private var player:AVAudioPlayer?
  private var timer:Timer?
  private var observers:[NSObjectProtocol]=[]
  var output:URL {directory.appendingPathComponent("recording.m4a")}
  var name:String {session?.name ?? "录音.m4a"}
  var id:String {session?.id ?? ""}
  var hasAudio:Bool {elapsed > 0 || (sink?.snapshot().1 ?? 0) > 0}
  var sizeDescription:String {
    let estimate=state != .preview && (session?.segments.contains(where:{$0.hasSuffix(".caf")}) == true || sink != nil)
    return (estimate ? "约 " : "")+ByteCountFormatter.string(fromByteCount:Int64(bytes),countStyle:.file)
  }
  init(directory:URL,draftID:String,scope:String,driver:any NativeRecordAudioInput=NativeRecordAudioDriver()) {
    self.directory=directory;self.draftID=draftID;self.scope=scope;self.driver=driver;super.init()
    do {
      try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true,attributes:[.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication]);try restore()
    } catch {self.error=error.localizedDescription;state = .failure}
    for name in [AVAudioSession.interruptionNotification,AVAudioSession.routeChangeNotification,AVAudioSession.mediaServicesWereResetNotification] {
      observers.append(NotificationCenter.default.addObserver(forName:name,object:nil,queue:.main) { [weak self] notification in
        let began=(notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.began.rawValue
        let removed=(notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt) == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue
        let interrupt=began || removed || notification.name == AVAudioSession.mediaServicesWereResetNotification
        Task {@MainActor in if interrupt {await self?.interrupt()}}
      })
    }
  }
  deinit {timer?.invalidate();let driver=driver;Task {await driver.stop()};observers.forEach(NotificationCenter.default.removeObserver)}
  private var manifest:URL {directory.appendingPathComponent("session.json")}
  private func persist() throws {
    guard var value=session else{return};value.note=note;value.state=state.rawValue;session=value
    try JSONEncoder().encode(value).write(to:manifest,options:[.atomic,.completeFileProtectionUntilFirstUserAuthentication])
  }
  private func saveNote() {
    do {if let sink {try sink.updateNote(note)} else {try persist()}} catch {self.error="录音备注保存失败"}
  }
  private func restore() throws {
    guard FileManager.default.fileExists(atPath:manifest.path) else{return}
    let value=try JSONDecoder().decode(NativeRecordRecordingSession.self,from:Data(contentsOf:manifest))
    guard value.draftID == draftID,value.scope == scope else {throw NativeRecordLocalError.stale}
    session=value;note=value.note;elapsed=value.duration;durable=value.duration
    if let active=value.active {
      if let file=try? AVAudioFile(forReading:directory.appendingPathComponent(active)),file.length > 0 {
        session?.segments.append(active);let duration=Double(file.length)/file.fileFormat.sampleRate
        session?.duration += duration;elapsed += duration;durable=elapsed
      }
      session?.active=nil
    }
    let completed=FileManager.default.fileExists(atPath:output.path)
    bytes=completed ? ((try? output.resourceValues(forKeys:[.fileSizeKey]).fileSize) ?? 0) : Int(elapsed*16_000)
    state=completed ? .preview : .interrupted;try persist()
  }
  private func segmentBytes()->Int {
    (session?.segments ?? []).reduce(0) {$0+((try? directory.appendingPathComponent($1).resourceValues(forKeys:[.fileSizeKey]).fileSize) ?? 0)}
  }
  func start() async {
    guard !busy,state != .recording else{return}
    busy=true;defer {busy=false}
    let operation=UUID();startup=operation
    let permitted:Bool
    if driver.requiresMicrophone {permitted=await withCheckedContinuation {continuation in AVAudioSession.sharedInstance().requestRecordPermission {continuation.resume(returning:$0)}}}
    else {permitted=true}
    guard permitted else{state = .denied;return}
    do {
      if session == nil {
        let now=Date(),formatter=DateFormatter();formatter.dateFormat="M月d日"
        session = .init(id:UUID().uuidString.lowercased(),draftID:draftID,scope:scope,createdAt:ISO8601DateFormatter().string(from:now),name:"录音-"+formatter.string(from:now)+".m4a",note:note)
      }
      guard let session else{throw NativeRecordMediaError.unavailable}
      guard elapsed*16_000 < Double(NativeRecordMediaStore.maximumFile-512*1024) else{throw NativeRecordMediaError.limit("录音已达附件容量限制")}
      player?.stop();playing=false;error=nil;try persist()
      let sink=NativeRecordAudioSink(directory:directory,session:session);self.sink=sink
      try await driver.start(sink:sink)
      guard startup == operation,!Task.isCancelled else {try await checkpoint(state == .interrupted ? .interrupted : .paused);return}
      state = .recording;try persist();startTimer()
    } catch {self.error=error.localizedDescription;state = .failure;await driver.stop();try? persist()}
  }
  private func startTimer() {
    timer?.invalidate();timer=Timer.scheduledTimer(withTimeInterval:0.1,repeats:true) { [weak self] _ in Task {@MainActor in self?.tick()}}
  }
  private func tick() {
    if let sink,state == .recording {
      let value=sink.snapshot();session=value.0;elapsed=value.1;durable=value.0.duration;samples=value.2
      bytes=Int(elapsed*16_000)
      if let issue=value.3 {Task {await interrupt();error=issue}}
      else if elapsed*16_000 >= Double(NativeRecordMediaStore.maximumFile-512*1024) {Task {await interrupt();error="录音已达附件容量限制 · 已保留本机录音"}}
    }
    if let player,playing {playback=player.currentTime}
  }
  private func checkpoint(_ next:State) async throws {
    await driver.stop()
    if let sink {session=try sink.seal(state:next.rawValue);self.sink=nil}
    elapsed=session?.duration ?? 0;durable=elapsed;state=next;try persist()
  }
  func pause() async {
    startup=UUID()
    guard state == .recording || busy else{return}
    state = .paused
    do {try await checkpoint(.paused)} catch {self.error=error.localizedDescription;state = .interrupted};timer?.invalidate()
  }
  func interrupt() async {
    startup=UUID()
    guard state == .recording || busy else{return}
    state = .interrupted
    do {try await checkpoint(.interrupted)} catch {self.error=error.localizedDescription};timer?.invalidate()
  }
  func finish() async {
    guard !busy else{return};busy=true;defer{busy=false}
    do {
      if sink != nil {try await checkpoint(.paused)};timer?.invalidate()
      guard let names=session?.segments,!names.isEmpty else{throw NativeRecordMediaError.missing}
      let composition=AVMutableComposition()
      guard let target=composition.addMutableTrack(withMediaType:.audio,preferredTrackID:kCMPersistentTrackID_Invalid) else{throw NativeRecordMediaError.unsupported}
      var cursor=CMTime.zero
      for name in names {
        let asset=AVURLAsset(url:directory.appendingPathComponent(name))
        guard let source=try await asset.loadTracks(withMediaType:.audio).first else{throw NativeRecordMediaError.corrupt}
        let duration=try await asset.load(.duration);try target.insertTimeRange(.init(start:.zero,duration:duration),of:source,at:cursor);cursor=CMTimeAdd(cursor,duration)
      }
      let staging=directory.appendingPathComponent(UUID().uuidString+"-output.m4a")
      guard let exporter=AVAssetExportSession(asset:composition,presetName:AVAssetExportPresetAppleM4A) else{throw NativeRecordMediaError.unsupported}
      exporter.outputURL=staging;exporter.outputFileType = .m4a
      await withCheckedContinuation {(c:CheckedContinuation<Void,Never>) in exporter.exportAsynchronously {c.resume()}}
      guard exporter.status == .completed else{throw exporter.error ?? NativeRecordMediaError.unavailable}
      let size=try staging.resourceValues(forKeys:[.fileSizeKey]).fileSize ?? 0
      guard size > 0,size <= NativeRecordMediaStore.maximumFile else{throw NativeRecordMediaError.limit("录音超过 32 MiB，原始分段已保留")}
      if FileManager.default.fileExists(atPath:output.path) {_ = try FileManager.default.replaceItemAt(output,withItemAt:staging)} else {try FileManager.default.moveItem(at:staging,to:output)}
      state = .preview;error=nil;bytes=size;try persist();try? AVAudioSession.sharedInstance().setActive(false,options:.notifyOthersOnDeactivation)
    } catch {self.error=error.localizedDescription;state = .interrupted;try? persist()}
  }
  func play() {
    do {
      if playing {player?.pause();playing=false;return}
      try AVAudioSession.sharedInstance().setCategory(.playback);try AVAudioSession.sharedInstance().setActive(true)
      if player == nil {player=try AVAudioPlayer(contentsOf:output);player?.delegate=self;player?.currentTime=playback}
      guard player?.play() == true else{throw NativeRecordMediaError.unsupported};playing=true;startTimer()
    } catch {self.error=error.localizedDescription}
  }
  func seek(_ time:Double) {player?.currentTime=max(0,min(elapsed,time));playback=time}
  nonisolated func audioPlayerDidFinishPlaying(_ player:AVAudioPlayer,successfully flag:Bool) {Task {@MainActor [weak self] in self?.playing=false;self?.playback=0}}
  func retire() async throws {
    guard !busy else {throw NativeRecordLocalError.unavailable}
    startup=UUID();await driver.stop();sink=nil;player?.stop();player=nil;timer?.invalidate();playing=false
    for url in try FileManager.default.contentsOfDirectory(at:directory,includingPropertiesForKeys:nil) {try FileManager.default.removeItem(at:url)}
    session=nil;state = .ready;elapsed=0;durable=0;bytes=0;try? AVAudioSession.sharedInstance().setActive(false,options:.notifyOthersOnDeactivation)
  }
#if DEBUG
  func review(state:State,duration:Double,bytes:Int,samples:[CGFloat],name:String="产品讨论-10月16日.m4a") {
    self.state=state;elapsed=duration;durable=state == .recording ? 16 : duration;self.bytes=bytes;self.samples=samples;playback=state == .preview ? 52 : 0
    session = .init(id:UUID().uuidString.lowercased(),draftID:draftID,scope:scope,createdAt:"2026-10-16T10:42:00+08:00",name:name,duration:duration,state:state.rawValue)
    note="入口调整、媒体导入与同步方式。"
  }
#endif
}
