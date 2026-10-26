import Foundation
import SwiftUI

enum NativeRecordListPhase: Equatable {
  case loading, content, offline, unpaired, expired, failure, unavailable
}
enum NativeRecordFilter: String, CaseIterable, Identifiable {
  case all = "全部"
  case unprocessed = "未加工"
  case review = "待确认"
  case pending = "待同步"
  var id: String { rawValue }
}
struct NativeRecordDay: Identifiable {
  let id: String
  let title: String
  let records: [NativeRecord]
}
@MainActor
final class NativeRecordListModel: ObservableObject {
  @Published var query = ""
  @Published var filter: NativeRecordFilter = .all
  @Published var selectedID: String?
  @Published var path: [String] = []
  @Published private(set) var snapshot: NativeRecordListSnapshot {
    didSet { updateDates() }
  }
  @Published private(set) var phase: NativeRecordListPhase
  @Published private(set) var cacheFailed = false
  @Published private(set) var origin = ""
  private var service: (any NativeRecordListService)?
  private var storage: (any NativeRecordListStorage)?
  private var scope = ""
  private var generation = UUID()
  private var createdDates: [String: Date] = [:]
  private var persistentCacheRequired = false
  private var localRecordIDs: Set<String> = []
  let now: () -> Date
  var calendar: Calendar {
    var value = Calendar(identifier: .gregorian)
    value.timeZone = TimeZone(identifier: "Asia/Shanghai")!
    return value
  }
  init(
    snapshot: NativeRecordListSnapshot = .init(), phase: NativeRecordListPhase = .unpaired,
    service: (any NativeRecordListService)? = nil, storage: (any NativeRecordListStorage)? = nil,
    origin: String = "", now: @escaping () -> Date = Date.init
  ) {
    self.snapshot = snapshot
    self.phase = phase
    self.service = service
    self.storage = storage
    self.origin = origin
    self.now = now
    updateDates()
  }
  func clearForSessionChange() {
    generation=UUID();service=nil;storage=nil;snapshot = .init();localRecordIDs=[];selectedID=nil;path=[];phase = .loading
  }
  func configure(
    service: (any NativeRecordListService)?, storage: (any NativeRecordListStorage)?,
    origin: String, deviceID: String, expired: Bool, persistentCacheRequired: Bool = false,loadRemote:Bool=true
  ) async {
    generation = UUID()
    let current = generation
    self.service = service
    self.storage = storage
    self.origin = origin
    self.persistentCacheRequired = persistentCacheRequired
    scope = NativeRecordListStore.scope(origin: origin, deviceID: deviceID)
    snapshot = .init()
    localRecordIDs = []
    query = ""
    filter = .all
    selectedID = nil
    path = []
    cacheFailed = persistentCacheRequired && service != nil && storage == nil
    phase = expired ? .expired : service == nil ? .unpaired : .loading
    guard service != nil else { return }
    do {
      let cached = try await storage?.load(scope: scope)
      guard current == generation, !Task.isCancelled else { return }
      if let cached { snapshot = cached }
    } catch {
      guard current == generation else { return }
      cacheFailed = true
    }
    if loadRemote {await reload()} else if phase == .loading {phase = .content}
  }
  func setSyncPhase(_ value:NativeRecordListPhase) {phase=value}
  func reload() async {
    guard let service else { return }
    let current = UUID()
    generation = current
    let accountScope = scope
    if snapshot.records.isEmpty { phase = .loading }
    do {
      let remote = try await service.listRecords()
      try Task.checkCancellation()
      guard current == generation else { return }
      // Keep local unsent versions if a later stage has added them to this store.
      let local = snapshot.records.filter { $0.sync != .synced }
      let localIDs = Set(local.map(\.id))
      var seen = Set<String>()
      let combined = (local + remote.filter { !localIDs.contains($0.id) }).filter {
        seen.insert($0.id).inserted
      }
      let value = NativeRecordListSnapshot(records: combined, draft: snapshot.draft)
      var cacheError = persistentCacheRequired && storage == nil
      do { try await storage?.save(value, scope: accountScope) } catch { cacheError = true }
      guard current == generation, !Task.isCancelled else { return }
      snapshot = value
      phase = .content
      cacheFailed = cacheError
      path.removeAll { id in !combined.contains(where: { $0.id == id }) }
      if let selectedID, !combined.contains(where: { $0.id == selectedID }) {
        self.selectedID = nil
      }
    } catch {
      guard current == generation, !Task.isCancelled, !(error is CancellationError) else { return }
      if case CollectorError.http(let code) = error {
        if [401, 403].contains(code) {
          snapshot = .init()
          selectedID = nil
          path = []
          phase = .expired
          return
        }
        if [404, 405].contains(code) {
          phase = .unavailable
          return
        }
      }
      let code = (error as NSError).code
      phase = [-1009, -1005, -1004, -1001].contains(code) ? .offline : .failure
    }
  }
  var visible: [NativeRecord] {
    snapshot.records.filter { record in
      matches(record, filter: filter)
        && (query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
          || (record.text + " " + record.attachments.map(\.name).joined(separator: " "))
            .localizedStandardContains(query.trimmingCharacters(in: .whitespacesAndNewlines)))
    }.sorted { a, b in
      let l = createdDates[a.id] ?? .distantPast
      let r = createdDates[b.id] ?? .distantPast
      return l == r ? a.id < b.id : l > r
    }
  }
  func installLocal(_ records: [NativeRecord], draft: NativeRecordDraftIndex?) {
    let remote = snapshot.records.filter { !localRecordIDs.contains($0.id) }
    localRecordIDs = Set(records.map(\.id))
    snapshot = .init(records: records + remote.filter { !localRecordIDs.contains($0.id) }, draft: draft)
  }
  func count(_ filter: NativeRecordFilter) -> Int {
    snapshot.records.filter { matches($0, filter: filter) }.count
  }
  private func matches(_ record: NativeRecord, filter: NativeRecordFilter) -> Bool {
    switch filter {
    case .all: return true
    case .unprocessed: return record.processingTitle == "未加工"
    case .review: return record.processingTitle == "待确认"
    case .pending: return record.sync != .synced
    }
  }
  var selected: NativeRecord? { visible.first(where: { $0.id == selectedID }) ?? visible.first }
  var isSearching: Bool { !query.isEmpty || filter != .all }
  var groups: [NativeRecordDay] {
    let grouped = Dictionary(grouping: visible) { record -> Date in
      calendar.startOfDay(for: createdDates[record.id] ?? .distantPast)
    }
    return grouped.keys.sorted(by: >).map { date in
      let label: String
      if calendar.isDate(date, inSameDayAs: now()) {
        label = "今天"
      } else if calendar.isDate(
        date, inSameDayAs: calendar.date(byAdding: .day, value: -1, to: now())!)
      {
        label = "昨天"
      } else {
        let f = DateFormatter()
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        f.dateFormat = "yyyy-MM-dd"
        label = f.string(from: date)
      }
      return .init(id: String(date.timeIntervalSince1970), title: label, records: grouped[date]!)
    }
  }
  func time(_ value: String) -> String {
    guard let date = Self.date(value) else { return "时间未知" }
    let f = DateFormatter()
    f.timeZone = calendar.timeZone
    f.dateFormat = "HH:mm"
    return f.string(from: date)
  }
  private func updateDates() {
    createdDates = snapshot.records.reduce(into: [:]) {
      $0[$1.id] = Self.date($1.createdAt) ?? .distantPast
    }
  }
  private static let fractionalDate: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
  }()
  private static let internetDate = ISO8601DateFormatter()
  static func date(_ value: String) -> Date? {
    fractionalDate.date(from: value) ?? internetDate.date(from: value)
  }
}
