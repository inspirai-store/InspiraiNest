import CryptoKit
import SwiftUI

/// Local collection only; scoped by server origin. Contains IDs, never credentials or content.
struct NativeFavoritesStore {
  let defaults: UserDefaults
  let origin: String
  private var key: String {
    "native.library.favorites."
      + SHA256.hash(data: Data(origin.utf8)).map { String(format: "%02x", $0) }.joined()
  }
  func load() -> Set<String> { Set(defaults.stringArray(forKey: key) ?? []) }
  func save(_ ids: Set<String>) { defaults.set(ids.sorted(), forKey: key) }
}
enum NativeLibraryPhase: Equatable {
  case loading, content, empty, noResults, failure, offline, unpaired, expired
}
@MainActor
final class NativeLibraryModel: ObservableObject {
  @Published var selectedID: String?
  @Published var query = ReadQuery()
  @Published var favoritesOnly = false
  @Published private(set) var favorites: Set<String> = []
  @Published private(set) var entries: [ReadEntry] = []
  @Published private(set) var categories = ReadCategories.empty
  @Published private(set) var phase: NativeLibraryPhase = .loading
  @Published private(set) var index = ReadIndex(complete: true, pending: 0, failed: 0)
  @Published private(set) var total = 0
  @Published private(set) var loadingMore = false
  @Published private(set) var nextPageFailed = false
  private var service: (any LibraryReadService)?
  private var favoriteStore: NativeFavoritesStore?
  private var generation = UUID()
  private var extensions: Bool?
  private var nextOffset = 0
  private var sessionAvailable = false
  init(
    service: (any LibraryReadService)? = nil, favorites: Set<String> = [],
    phase: NativeLibraryPhase = .loading, categories: ReadCategories = .empty
  ) {
    self.service = service
    self.categories = categories
    self.favorites = favorites
    self.phase = phase
    sessionAvailable = service != nil
  }
  func configure(
    service: (any LibraryReadService)?, origin: String, expired: Bool = false,
    defaults: UserDefaults = .standard
  ) {
    generation = UUID()
    self.service = service
    extensions = nil
    sessionAvailable = service != nil
    favoriteStore = origin.isEmpty ? nil : .init(defaults: defaults, origin: origin)
    favorites = favoriteStore?.load() ?? []
    entries = []
    selectedID = nil
    categories = .empty
    total = 0
    phase = expired ? .expired : service == nil ? .unpaired : .loading
  }
  var canLoadMore: Bool { nextOffset < total && !loadingMore && phase == .content }
  var isStatePage: Bool { entries.isEmpty && phase != .content }
  func toggleFavorite(_ id: String) {
    if favorites.contains(id) { favorites.remove(id) } else { favorites.insert(id) }
    favoriteStore?.save(favorites)
  }
  func resetFilters() {
    query.type = nil
    query.tag = nil
    query.status = nil
    query.sort = nil
  }
  func selectCategory(_ type: String?) {
    favoritesOnly = false
    query.type = type
    query.status = nil
  }
  func selectFavorites() {
    favoritesOnly = true
    query.type = nil
    query.status = nil
  }
  func reload() async {
    guard sessionAvailable, let service else { return }
    let current = UUID()
    generation = current
    nextPageFailed = false
    loadingMore = false
    if entries.isEmpty { phase = .loading }
    var requested = query
    requested.offset = 0
    let collection = favoritesOnly ? favorites : nil
    do {
      if extensions == nil {
        do {
          let facets = try await service.readCategories()
          try Task.checkCancellation()
          guard current == generation else { return }
          categories = facets
          extensions = true
        } catch CollectorError.http(let status) where status == 404 || status == 405 {
          var base = ReadQuery()
          base.limit = 100
          var page = try await service.readEntries(base)
          var all = page.items
          while page.offset + page.items.count < page.total {
            try Task.checkCancellation()
            guard !page.items.isEmpty else { throw CollectorError.message("资料分页不完整。") }
            base.offset += page.items.count
            page = try await service.readEntries(base)
            all.append(contentsOf: page.items)
          }
          try Task.checkCancellation()
          guard current == generation else { return }
          let facets = ReadCategories.from(all)
          categories = .init(
            total: facets.total, types: facets.types, tags: facets.tags, statuses: facets.statuses,
            index: page.index)
          extensions = false
        }
      }
      try Task.checkCancellation()
      guard current == generation else { return }
      // Older servers ignore optional extension parameters. Fetch all matching
      // rows to apply sort/collection locally. Large collections avoid oversized GET URLs.
      let localCollection = extensions == false || (collection?.count ?? 0) > 100
      requested.ids = localCollection ? nil : collection.map { $0.sorted() }
      requested.sort = extensions == false ? nil : requested.sort
      var result = try await service.readEntries(requested)
      var values = result.items
      if localCollection {
        while result.offset + result.items.count < result.total {
          try Task.checkCancellation()
          requested.offset += result.items.count
          guard !result.items.isEmpty else { throw CollectorError.message("资料分页不完整。") }
          result = try await service.readEntries(requested)
          values.append(contentsOf: result.items)
        }
        if let collection { values = values.filter { collection.contains($0.id) } }
        if let sort = query.sort {
          values.sort { lhs, rhs in
            switch sort {
            case .title:
              let l = lhs.title.precomposedStringWithCompatibilityMapping.lowercased()
              let r = rhs.title.precomposedStringWithCompatibilityMapping.lowercased()
              return l == r ? lhs.id < rhs.id : l < r
            case .recent, .earliest:
              let l = lhs.collectedDate?.timeIntervalSince1970
              let r = rhs.collectedDate?.timeIntervalSince1970
              if l == r { return lhs.id < rhs.id }
              if l == nil { return false }
              if r == nil { return true }
              return sort == .recent ? l! > r! : l! < r!
            }
          }
        }
      }
      try Task.checkCancellation()
      guard current == generation else { return }
      entries = unique(values)
      total = localCollection ? entries.count : result.total
      nextOffset = localCollection ? total : result.offset + result.items.count
      index = result.index
      phase =
        entries.isEmpty
        ? (query.text.isEmpty && query.type == nil && query.tag == nil && query.status == nil
          && !favoritesOnly ? .empty : .noResults) : .content
    } catch {
      guard current == generation, !Task.isCancelled, !(error is CancellationError) else { return }
      apply(error)
    }
  }
  func loadMore() async {
    guard canLoadMore, let service else { return }
    let current = generation
    loadingMore = true
    nextPageFailed = false
    var request = query
    request.offset = nextOffset
    request.ids = favoritesOnly ? favorites.sorted() : nil
    defer { if current == generation { loadingMore = false } }
    do {
      let result = try await service.readEntries(request)
      try Task.checkCancellation()
      guard current == generation else { return }
      guard !result.items.isEmpty || request.offset >= result.total else {
        throw CollectorError.message("资料分页不完整。")
      }
      entries = unique(entries + result.items)
      nextOffset = result.offset + result.items.count
      total = result.total
      index = result.index
    } catch {
      guard current == generation, !Task.isCancelled else { return }
      if case CollectorError.http(let code) = error, [401, 403].contains(code) {
        apply(error)
      } else {
        nextPageFailed = true
      }
    }
  }
  private func unique(_ entries: [ReadEntry]) -> [ReadEntry] {
    var seen = Set<String>()
    return entries.filter { seen.insert($0.id).inserted }
  }
  private func apply(_ error: Error) {
    if case CollectorError.http(let code) = error, [401, 403].contains(code) {
      entries = []
      categories = .empty
      total = 0
      phase = .expired
      return
    }
    let code = (error as NSError).code
    phase = [-1009, -1005, -1004, -1001].contains(code) ? .offline : .failure
  }
}
